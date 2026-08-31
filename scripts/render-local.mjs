// route.js /api/render 필터그래프를 로컬(시스템 ffmpeg, 타임아웃 없음)에서 그대로 재현.
// 이미지 샷 + 무음 전제. 결과 mp4 + 포스터를 Blob 업로드하고 URL 출력.
//
// 사용:  node scripts/render-local.mjs <payload.json> [출력디렉터리]
//   payload.json — /api/render 와 동일한 바디(shots/captions/annotations/totalDuration/colorGrade/bgmKey/bgmVolume)
//   출력디렉터리 — 지정 시 payload 파일명(.json→.mp4)으로 로컬 사본 저장. 미지정 시 Blob 만.
// Vercel /api/render 의 maxDuration 120s 제한에 걸리는 긴 영상을 로컬에서 뽑을 때 사용.
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { put } from '@vercel/blob'
import { renderAnnotationPNG, measureCaptionWidth } from '../lib/handwriting.js'

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg'
const FPS = 30
const BASE_W = 1080, BASE_H = 1920
const FADE_DUR = 0.3
const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-Bold.ttf')
const BGM_LIBRARY = {
  'calm-piano': path.join(process.cwd(), 'assets', 'bgm', 'calm-piano.mp3'),
  'upbeat-reel': path.join(process.cwd(), 'assets', 'bgm', 'upbeat-reel.mp3'),
  'trust-corporate': path.join(process.cwd(), 'assets', 'bgm', 'trust-corporate.mp3'),
}
const COLOR_GRADES = {
  warm: 'eq=contrast=1.05:saturation=1.12:brightness=0.02:gamma_r=1.03',
  cool: 'eq=contrast=1.04:saturation=1.05:brightness=0.0:gamma_b=1.03',
  moody: 'eq=contrast=1.1:saturation=0.92:brightness=-0.02',
  vivid: 'eq=contrast=1.08:saturation=1.25:brightness=0.01',
  neutral: 'eq=contrast=1.04:saturation=1.08:brightness=0.01',
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('error', reject)
    p.on('close', (c) => c === 0 ? resolve(err) : reject(new Error(err.slice(-3000))))
  })
}
async function dl(url, dest) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`dl ${r.status} ${url}`)
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()))
}

const payloadPath = process.argv[2]
if (!payloadPath) { console.error('사용: node scripts/render-local.mjs <payload.json> [출력디렉터리]'); process.exit(1) }
const outName = path.basename(payloadPath).replace(/\.json$/i, '') + '.mp4'
const { shots, captions = [], annotations = [], totalDuration, colorGrade, bgmKey, bgmVolume } =
  JSON.parse(await fs.readFile(payloadPath, 'utf8'))

const anns = annotations.filter((a) => a && String(a.text || '').trim()).slice(0, 8)
const bgmVol = Math.max(0, Math.min(1, Number(bgmVolume) > 0 ? Number(bgmVolume) : 0.18))
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'yubi-local-'))

try {
  const inputArgs = []
  const filterParts = []
  const concatLabels = []

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const dest = path.join(work, `src${i}${path.extname(shot.url.split('?')[0]) || '.jpg'}`)
    await dl(shot.url, dest)
    const duration = Math.max(0.3, Number(shot.duration) || 3)
    const effect = shot.effect || 'static'
    const isZoom = effect === 'zoom-in' || effect === 'zoom-out'

    inputArgs.push('-loop', '1', '-t', String(duration), '-framerate', String(FPS), '-i', dest)

    const fd = Math.max(0.1, Math.min(FADE_DUR, duration / 3))
    const vFades = []
    if (i > 0) vFades.push(`fade=t=in:st=0:d=${fd.toFixed(2)}`)
    if (i < shots.length - 1) vFades.push(`fade=t=out:st=${Math.max(0, duration - fd).toFixed(2)}:d=${fd.toFixed(2)}`)
    const vFadeStr = vFades.length ? ',' + vFades.join(',') : ''

    let v = `[${i}:v]scale=${BASE_W}:${BASE_H}:force_original_aspect_ratio=increase,crop=${BASE_W}:${BASE_H},setsar=1`
    if (isZoom) {
      const z0 = effect === 'zoom-in' ? 1.0 : 1.15
      const z1 = effect === 'zoom-in' ? 1.15 : 1.0
      const tf = Math.max(Math.round(duration * FPS) - 1, 1)
      v += `,scale=${BASE_W * 2}:${BASE_H * 2}`
      v += `,zoompan=z='${z0}+(${z1 - z0})*on/${tf}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${BASE_W}x${BASE_H}:fps=${FPS}`
    }
    v += vFadeStr + `[v${i}]`
    filterParts.push(v)
    filterParts.push(`anullsrc=r=44100:cl=stereo,atrim=0:${duration}[a${i}]`)
    concatLabels.push(`[v${i}][a${i}]`)
  }

  filterParts.push(`${concatLabels.join('')}concat=n=${shots.length}:v=1:a=1[vraw0][araw0]`)
  filterParts.push(`[vraw0]${COLOR_GRADES[colorGrade] || COLOR_GRADES.neutral}[vgraded]`)

  let videoLabel = 'vgraded'
  if (captions.length) {
    let chain = `[vgraded]`
    for (let idx = 0; idx < captions.length; idx++) {
      const cap = captions[idx]
      const capFile = path.join(work, `cap${idx}.txt`)
      const line = String(cap.text || '').replace(/\s*\r?\n\s*/g, ' ').trim()
      await fs.writeFile(capFile, line, 'utf-8')
      const isLast = idx === captions.length - 1
      const sf = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:')
      const cf = capFile.replace(/\\/g, '/').replace(/:/g, '\\:')
      let rw = 58
      try { rw = measureCaptionWidth(line, 58) } catch { rw = line.length * 58 * 0.95 }
      const fontsize = rw > 900 ? Math.max(32, Math.floor(58 * 900 / rw)) : 58
      chain += `drawtext=fontfile='${sf}':textfile='${cf}':enable='between(t\\,${cap.start}\\,${cap.end})':x=(w-text_w)/2:y=h-320:fontsize=${fontsize}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=24`
      chain += isLast ? `[vout]` : `,`
    }
    filterParts.push(chain)
    videoLabel = 'vout'
  }

  // BGM
  let audioLabel = 'araw0'
  const bgmPath = bgmKey && BGM_LIBRARY[bgmKey]
  if (bgmPath) {
    const bi = shots.length
    inputArgs.push('-stream_loop', '-1', '-i', bgmPath)
    filterParts.push(`[${bi}:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,volume=${bgmVol}[bgmtrim]`)
    filterParts.push(`[araw0][bgmtrim]amix=inputs=2:duration=first:dropout_transition=0[amixed]`)
    audioLabel = 'amixed'
  }

  // 손글씨 오버레이
  if (anns.length) {
    let base = shots.length + (bgmPath ? 1 : 0)
    let prev = videoLabel
    for (let k = 0; k < anns.length; k++) {
      const a = anns[k]
      const png = path.join(work, `ann${k}.png`)
      await fs.writeFile(png, renderAnnotationPNG({
        text: a.text, position: a.position, bubble: a.bubble, color: a.color,
        deco: Array.isArray(a.deco) ? a.deco : String(a.deco || '').split(',').map((s) => s.trim()).filter(Boolean),
        arrow: !!a.arrow, arrowDir: a.arrowDir, backing: a.backing !== false,
        x: a.x, y: a.y, fontSize: a.fontSize,
      }))
      inputArgs.push('-loop', '1', '-t', String(Math.max(1, Number(totalDuration) || 30)), '-i', png)
      const s = Math.max(0, Number(a.start) || 0)
      const e = Math.max(s + 0.1, Number(a.end) || (s + 3))
      const out = k === anns.length - 1 ? 'vfinal' : `vann${k}`
      filterParts.push(`[${prev}][${base + k}:v]overlay=0:0:enable='between(t\\,${s}\\,${e})'[${out}]`)
      prev = out
    }
    videoLabel = 'vfinal'
  }

  const outPath = path.join(work, 'output.mp4')
  const args = [
    '-y', ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', `[${videoLabel}]`, '-map', `[${audioLabel}]`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k',
    '-r', String(FPS), '-g', '60', '-movflags', '+faststart', outPath,
  ]
  console.error('ffmpeg 시작…')
  const t0 = Date.now()
  await run(FFMPEG, args)
  console.error(`ffmpeg 완료 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const stamp = Date.now()
  const token = (await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8'))
    .split('\n').find((l) => l.startsWith('BLOB_READ_WRITE_TOKEN=')).split('=')[1].trim().replace(/^["']|["']$/g, '')
  const outBuf = await fs.readFile(outPath)
  const blob = await put(`renders/${stamp}.mp4`, outBuf, { access: 'public', contentType: 'video/mp4', token })

  const posterPath = path.join(work, 'poster.jpg')
  await run(FFMPEG, ['-y', '-ss', String((Number(totalDuration) || 4) * 0.2), '-i', outPath, '-frames:v', '1', '-q:v', '4', posterPath])
  const pblob = await put(`renders/${stamp}.jpg`, await fs.readFile(posterPath), { access: 'public', contentType: 'image/jpeg', token })

  // 출력디렉터리 지정 시 로컬에도 저장
  const localOut = process.argv[3] ? path.join(process.argv[3], outName) : null
  if (localOut) await fs.copyFile(outPath, localOut).catch(() => {})
  console.log(JSON.stringify({ url: blob.url, posterUrl: pblob.url, local: localOut, sizeKB: Math.round(outBuf.length / 1024) }, null, 2))
} finally {
  await fs.rm(work, { recursive: true, force: true }).catch(() => {})
}
