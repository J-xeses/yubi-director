// 손글씨 주석 미리보기 — payload.json의 각 annotation을 대응 배경샷 위에 합성해
// jpg로 저장한다. 풀 렌더(1~2분) 없이 손글씨 룩만 빠르게 확인·반복할 때.
//
//   node scripts/hw-preview.mjs <payload.json> <출력디렉터리> [--map=0,3,4]
//     --map : 주석 i번을 shots[map[i]] 배경에 얹는다 (기본: 0,1,2,...)
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderAnnotationPNG } from '../lib/handwriting.js'

const FF = process.env.FFMPEG_BIN || 'ffmpeg'
const W = 1080, H = 1920
const args = process.argv.slice(2)
const payloadPath = args.find((a) => a.endsWith('.json'))
const outDir = args.find((a) => !a.startsWith('--') && !a.endsWith('.json')) || '.'
const mapArg = (args.find((a) => a.startsWith('--map=')) || '').slice(6)
if (!payloadPath) { console.error('사용: node scripts/hw-preview.mjs <payload.json> <출력디렉터리> [--map=0,3,4]'); process.exit(1) }

const pay = JSON.parse(await fs.readFile(payloadPath, 'utf8'))
const anns = pay.annotations || []
const map = mapArg ? mapArg.split(',').map(Number) : anns.map((_, i) => Math.min(i, (pay.shots || []).length - 1))

function run(cmd, a) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, a)
    let e = ''
    p.stderr.on('data', (d) => (e += d))
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(e.slice(-800)))))
  })
}

const GRADE = {
  warm: 'eq=contrast=1.05:saturation=1.12:brightness=0.02:gamma_r=1.03',
  cool: 'eq=contrast=1.04:saturation=1.05:brightness=0.0:gamma_b=1.03',
  moody: 'eq=contrast=1.1:saturation=0.92:brightness=-0.02',
  vivid: 'eq=contrast=1.08:saturation=1.25:brightness=0.01',
  neutral: 'eq=contrast=1.04:saturation=1.08:brightness=0.01',
}
const grade = GRADE[pay.colorGrade] || GRADE.neutral

const made = []
for (let i = 0; i < anns.length; i++) {
  const ann = anns[i]
  const shot = pay.shots[map[i]] || pay.shots[0]
  const tag = `hw_${i}`
  const raw = path.join(outDir, tag + '_src.jpg')
  await fs.writeFile(raw, Buffer.from(await (await fetch(shot.url)).arrayBuffer()))
  const norm = path.join(outDir, tag + '_bg.jpg')
  await run(FF, ['-y', '-i', raw, '-vf',
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,${grade}`,
    '-frames:v', '1', '-q:v', '2', norm])

  const cv = createCanvas(W, H)
  const cx = cv.getContext('2d')
  cx.drawImage(await loadImage(norm), 0, 0, W, H)
  cx.drawImage(await loadImage(renderAnnotationPNG(ann)), 0, 0, W, H)
  const out = path.join(outDir, tag + '.jpg')
  await fs.writeFile(out, cv.toBuffer('image/jpeg', 0.9))
  made.push(out)
  console.log('·', out, '—', JSON.stringify({ text: ann.text.replace(/\n/g, ' '), bubble: ann.bubble || 'none', color: ann.color }))
}

// 가로 스트립
if (made.length > 1) {
  const imgs = await Promise.all(made.map((p) => loadImage(p)))
  const sh = 920
  const sw = Math.round(sh * W / H)
  const gap = 12
  const strip = createCanvas(sw * made.length + gap * (made.length - 1), sh)
  const sc = strip.getContext('2d')
  sc.fillStyle = '#1a1a1a'; sc.fillRect(0, 0, strip.width, strip.height)
  imgs.forEach((im, i) => sc.drawImage(im, i * (sw + gap), 0, sw, sh))
  const stripPath = path.join(outDir, 'hw_strip.jpg')
  await fs.writeFile(stripPath, strip.toBuffer('image/jpeg', 0.86))
  console.log('→', stripPath)
}
