import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { put } from '@vercel/blob'
import { FFMPEG, FFPROBE, run } from '../../../lib/media'
import { renderAnnotationPNG, measureCaptionWidth } from '../../../lib/handwriting'

export const maxDuration = 120

const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-Bold.ttf')
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'])
const FPS = 30
const BASE_W = 1080
const BASE_H = 1920
const FADE_DUR = 0.3 // 컷 경계 페이드 길이(초) — xfade 필터는 번들 ffmpeg 버전에 없어
                      // 클립별 fade in/out(디졸브 느낌의 블랙 페이드)으로 대체

// 내장 무료 라이선스 BGM 라이브러리 (Pixabay Content License, 별도 업로드 없이 기본 제공)
const BGM_LIBRARY = {
  'calm-piano': path.join(process.cwd(), 'assets', 'bgm', 'calm-piano.mp3'),
  'upbeat-reel': path.join(process.cwd(), 'assets', 'bgm', 'upbeat-reel.mp3'),
  'trust-corporate': path.join(process.cwd(), 'assets', 'bgm', 'trust-corporate.mp3'),
}

// 무드별 색보정 프리셋 — eq 필터 하나로 적용, 부담 없는 수준으로 은은하게
const COLOR_GRADES = {
  warm:    'eq=contrast=1.05:saturation=1.12:brightness=0.02:gamma_r=1.03',
  cool:    'eq=contrast=1.04:saturation=1.05:brightness=0.0:gamma_b=1.03',
  moody:   'eq=contrast=1.1:saturation=0.92:brightness=-0.02',
  vivid:   'eq=contrast=1.08:saturation=1.25:brightness=0.01',
  neutral: 'eq=contrast=1.04:saturation=1.08:brightness=0.01',
}

function extOf(url) {
  const clean = url.split('?')[0]
  const ext = path.extname(clean).toLowerCase()
  return ext || '.mp4'
}

async function downloadTo(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(destPath, buf)
}

// 업로드된 파일이나 스톡 B-roll(Pexels 등)은 오디오 트랙이 아예 없는 경우가 실제로
// 있다(예: 무음으로 촬영된 폰 영상, 무음 스톡 클립) — 이때 [i:a]로 없는 스트림을
// 참조하면 ffmpeg가 "Stream specifier ':a' ... matches no streams"로 전체 렌더가
// 실패한다(2026-08-28 실측: 카메라로 찍은 무음 테스트 클립에서 확인). 다운로드 직후
// 파일별로 한 번만 확인해서, 없으면 이미지와 동일하게 무음 오디오(anullsrc)로 대체한다.
function probeHasAudio(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      filePath,
    ])
    let out = ''
    proc.stdout.on('data', (d) => { out += d.toString() })
    proc.on('error', () => resolve(false))
    proc.on('close', () => resolve(out.trim().length > 0))
  })
}

export async function POST(request) {
  const {
    shots, captions = [], bgmUrl, bgmKey, totalDuration, colorGrade,
    annotations = [], bgmVolume,
  } = await request.json()

  // 손글씨 주석: { text, start, end, position, bubble, color, deco, arrow, arrowDir }
  const anns = (Array.isArray(annotations) ? annotations : [])
    .filter((a) => a && String(a.text || '').trim())
    .slice(0, 8)
  const bgmVol = Math.max(0, Math.min(1, Number(bgmVolume) > 0 ? Number(bgmVolume) : 0.18))

  if (!Array.isArray(shots) || shots.length === 0) {
    return Response.json({ error: '샷이 없습니다.' }, { status: 400 })
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yubi-'))

  try {
    // 1) 소스 파일 다운로드 — 같은 url이 여러 샷에서 재사용될 수 있으므로 캐시
    const downloaded = new Map()
    for (const shot of shots) {
      if (downloaded.has(shot.url)) continue
      const ext = extOf(shot.url)
      const dest = path.join(workDir, `src${downloaded.size}${ext}`)
      await downloadTo(shot.url, dest)
      const isImage = IMAGE_EXT.has(ext)
      const hasAudio = isImage ? false : await probeHasAudio(dest)
      downloaded.set(shot.url, { path: dest, isImage, hasAudio })
    }

    // 2) BGM 준비: 사용자가 직접 올린 파일이 있으면 그걸 쓰고,
    //    없으면 내장 라이브러리(bgmKey)에서 기본 제공
    let bgmPath = null
    if (bgmUrl) {
      bgmPath = path.join(workDir, `bgm${extOf(bgmUrl)}`)
      await downloadTo(bgmUrl, bgmPath)
    } else if (bgmKey && BGM_LIBRARY[bgmKey]) {
      bgmPath = BGM_LIBRARY[bgmKey]
    }

    // 3) 샷별 필터 체인 구성
    // 효과: static(기본) / zoom-in / zoom-out / slow-mo
    // - zoom-in/out은 zoompan으로 구현(이 ffmpeg 빌드에서 crop의 t 기반 표현식이
    //   동작하지 않아 zoompan으로 대체함 — 2026-08-28 확인)
    // - slow-mo는 setpts(영상)/atempo(오디오)로 절반 속도 재생. 이때 fps 필터를
    //   함께 걸면(왜곡된 타임스탬프 위에서 재샘플링하며) 길이가 몇 배로 부풀어나는
    //   버그를 실측으로 확인해서, static/slow-mo 샷에는 fps 필터를 걸지 않는다
    //   (zoompan 내부의 fps= 옵션은 별개 경로라 영향 없음, concat이 다른 프레임레이트
    //   입력도 정상 처리하는 것도 함께 확인함).
    const inputArgs = []
    const filterParts = []
    const concatLabels = []
    const urlToInputIndex = new Map()

    shots.forEach((shot, i) => {
      const src = downloaded.get(shot.url)
      const duration = Math.max(0.3, Number(shot.duration) || 3)
      const trimStart = Math.max(0, Number(shot.trimStart) || 0)
      const effect = shot.effect || 'static'
      const isSlowMo = effect === 'slow-mo' && !src.isImage
      const isZoom = (effect === 'zoom-in' || effect === 'zoom-out') && true
      const sourceDur = isSlowMo ? duration / 2 : duration

      if (src.isImage) {
        inputArgs.push('-loop', '1', '-t', String(duration), '-framerate', String(FPS), '-i', src.path)
      } else {
        inputArgs.push('-i', src.path)
      }
      const inputIdx = i // 입력을 샷별로 하나씩 새로 열므로(캐시 파일 재사용) 인덱스는 순번과 동일

      // 컷 경계 페이드(첫/마지막 샷은 제외)
      const fd = Math.max(0.1, Math.min(FADE_DUR, duration / 3))
      const vFades = []
      const aFades = []
      if (i > 0) {
        vFades.push(`fade=t=in:st=0:d=${fd.toFixed(2)}`)
        aFades.push(`afade=t=in:st=0:d=${fd.toFixed(2)}`)
      }
      if (i < shots.length - 1) {
        const st = Math.max(0, duration - fd)
        vFades.push(`fade=t=out:st=${st.toFixed(2)}:d=${fd.toFixed(2)}`)
        aFades.push(`afade=t=out:st=${st.toFixed(2)}:d=${fd.toFixed(2)}`)
      }
      const vFadeStr = vFades.length ? ',' + vFades.join(',') : ''
      const aFadeStr = aFades.length ? ',' + aFades.join(',') : ''

      let vChain = `[${inputIdx}:v]`
      if (src.isImage) {
        vChain += `scale=${BASE_W}:${BASE_H}:force_original_aspect_ratio=increase,crop=${BASE_W}:${BASE_H},setsar=1`
      } else {
        vChain += `trim=start=${trimStart}:duration=${sourceDur},setpts=PTS-STARTPTS`
        if (isSlowMo) vChain += `,setpts=2.0*PTS`
        vChain += `,scale=${BASE_W}:${BASE_H}:force_original_aspect_ratio=increase,crop=${BASE_W}:${BASE_H},setsar=1`
      }
      if (isZoom) {
        const z0 = effect === 'zoom-in' ? 1.0 : 1.15
        const z1 = effect === 'zoom-in' ? 1.15 : 1.0
        const totalFrames = Math.max(Math.round(duration * FPS) - 1, 1)
        vChain += `,scale=${BASE_W * 2}:${BASE_H * 2}`
        vChain += `,zoompan=z='${z0}+(${z1 - z0})*on/${totalFrames}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${BASE_W}x${BASE_H}:fps=${FPS}`
      }
      vChain += vFadeStr
      vChain += `[v${i}]`
      filterParts.push(vChain)

      if (src.isImage || !src.hasAudio) {
        filterParts.push(`anullsrc=r=44100:cl=stereo,atrim=0:${duration}${aFadeStr}[a${i}]`)
      } else {
        let aChain = `[${inputIdx}:a]atrim=start=${trimStart}:duration=${sourceDur},asetpts=PTS-STARTPTS`
        if (isSlowMo) aChain += `,atempo=0.5`
        aChain += `,aformat=sample_rates=44100:channel_layouts=stereo${aFadeStr}[a${i}]`
        filterParts.push(aChain)
      }
      concatLabels.push(`[v${i}][a${i}]`)
    })

    filterParts.push(`${concatLabels.join('')}concat=n=${shots.length}:v=1:a=1[vraw0][araw0]`)
    const joinedVideo = 'vraw0'
    const joinedAudio = 'araw0'

    // 4) 색보정 (전체에 한 번)
    let gradedVideo = joinedVideo
    const gradeFilter = COLOR_GRADES[colorGrade] || COLOR_GRADES.neutral
    filterParts.push(`[${joinedVideo}]${gradeFilter}[vgraded]`)
    gradedVideo = 'vgraded'

    // 5) 자막 drawtext 체인
    // 자막 텍스트는 명령줄 인자로 넘기면 Windows 콘솔 코드페이지 문제로
    // 한글이 깨지는 경우가 있어(spawn 인자 인코딩 이슈), UTF-8 파일에 써서
    // drawtext의 textfile= 옵션으로 읽게 한다 — 인코딩 문제와 특수문자
    // 이스케이핑 문제를 동시에 회피한다.
    //
    // 줄바꿈 문자가 텍스트에 섞여 들어오면(예: Claude가 긴 문장을 두 줄로
    // 나눠 보낼 때, maxTokens를 늘린 뒤 실제로 발생 확인 - 2026-08-28) drawtext가
    // 이걸 진짜 줄바꿈으로 해석해 두 줄을 렌더링하는데, 이 ffmpeg 빌드는 줄마다
    // box 배경을 따로 그리면서 두 줄의 위치가 어긋나 서로 겹쳐 보이는 버그가
    // 있다("자막이 겹쳐 보인다"는 증상의 실제 원인 — 자막 두 개가 겹치는 게
    // 아니라 자막 하나가 줄바꿈으로 깨지는 것이었음). 자막은 항상 한 줄이어야
    // 하므로 줄바꿈을 공백으로 치환해 원천 차단한다.
    let videoLabel = gradedVideo
    if (captions.length > 0) {
      let chain = `[${gradedVideo}]`
      for (let idx = 0; idx < captions.length; idx++) {
        const cap = captions[idx]
        const capFile = path.join(workDir, `cap${idx}.txt`)
        const singleLineText = String(cap.text || '').replace(/\s*\r?\n\s*/g, ' ').trim()
        await fs.writeFile(capFile, singleLineText, 'utf-8')
        const isLast = idx === captions.length - 1
        const safeFontPath = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:')
        const safeCapPath = capFile.replace(/\\/g, '/').replace(/:/g, '\\:')
        // 줄바꿈을 막았으니 문장이 길면 한 줄로 화면 폭(1080px, 여백 감안 900px)을
        // 넘어갈 수 있다 — canvas로 실제 폭을 재서 fontsize를 줄여 한 줄 안에 들어오게 한다
        // (기존엔 글자 수 * 상수로 추정했는데 영문/숫자/공백이 섞이면 오차가 컸음).
        const CAPTION_SAFE_WIDTH = 900
        const BASE_FS = 58
        let realWidth = BASE_FS
        try { realWidth = measureCaptionWidth(singleLineText, BASE_FS) } catch { realWidth = singleLineText.length * BASE_FS * 0.95 }
        const fontsize = realWidth > CAPTION_SAFE_WIDTH
          ? Math.max(32, Math.floor(BASE_FS * CAPTION_SAFE_WIDTH / realWidth))
          : BASE_FS
        chain += `drawtext=fontfile='${safeFontPath}':textfile='${safeCapPath}':enable='between(t\\,${cap.start}\\,${cap.end})':x=(w-text_w)/2:y=h-320:fontsize=${fontsize}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=24`
        chain += isLast ? `[vout]` : `,`
      }
      filterParts.push(chain)
      videoLabel = 'vout'
    }

    // 6) BGM 믹싱
    let audioLabel = joinedAudio
    if (bgmPath) {
      const bgmIndex = shots.length
      inputArgs.push('-stream_loop', '-1', '-i', bgmPath)
      filterParts.push(
        `[${bgmIndex}:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,volume=${bgmVol}[bgmtrim]`,
        `[${joinedAudio}][bgmtrim]amix=inputs=2:duration=first:dropout_transition=0[amixed]`
      )
      audioLabel = 'amixed'
    }

    // 6-b) 손글씨 주석 오버레이 — 각 씬을 투명 PNG로 그려(@napi-rs/canvas) 입력으로 넣고
    //      해당 시간대에만 overlay한다. BGM 다음 인덱스부터.
    if (anns.length > 0) {
      let annBase = shots.length + (bgmPath ? 1 : 0)
      let prev = videoLabel
      for (let k = 0; k < anns.length; k++) {
        const a = anns[k]
        const png = path.join(workDir, `ann${k}.png`)
        await fs.writeFile(png, renderAnnotationPNG({
          text: a.text, position: a.position, bubble: a.bubble, color: a.color,
          deco: Array.isArray(a.deco) ? a.deco : String(a.deco || '').split(',').map((s) => s.trim()).filter(Boolean),
          arrow: !!a.arrow, arrowDir: a.arrowDir || a.arrow_direction,
        }))
        // -loop 1 이미지는 무한 입력이라 -t로 바운드하지 않으면 filtergraph가 끝나지 않는다.
        inputArgs.push('-loop', '1', '-t', String(Math.max(1, Number(totalDuration) || 30)), '-i', png)
        const s = Math.max(0, Number(a.start) || 0)
        const e = Math.max(s + 0.1, Number(a.end) || (s + 3))
        const out = k === anns.length - 1 ? 'vfinal' : `vann${k}`
        filterParts.push(
          `[${prev}][${annBase + k}:v]overlay=0:0:enable='between(t\\,${s}\\,${e})'[${out}]`
        )
        prev = out
      }
      videoLabel = 'vfinal'
    }

    const outPath = path.join(workDir, 'output.mp4')
    const ffArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterParts.join(';'),
      '-map', `[${videoLabel}]`,
      '-map', `[${audioLabel}]`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', String(FPS), '-g', '60', '-movflags', '+faststart',
      outPath,
    ]

    await run(FFMPEG, ffArgs)

    // 7) 결과 업로드
    const outBuf = await fs.readFile(outPath)
    const blob = await put(`renders/${Date.now()}.mp4`, outBuf, {
      access: 'public',
      contentType: 'video/mp4',
    })

    return Response.json({ url: blob.url })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
