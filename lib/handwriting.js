// 손글씨 주석 오버레이 — 여리 스튜디오의 handwriting_overlay.py(Pillow)를 Vercel
// 서버리스에서 쓸 수 있게 @napi-rs/canvas로 포팅한 버전.
// renderAnnotationPNG(scene) → 1080x1920 투명 PNG Buffer.
//   scene: { text, position, bubble, color, deco, arrow, arrowDir }
//     position: top_center | top_left | top_right | center | bottom_center | bottom_left | bottom_right
//     bubble:   none | cloud | oval | arrow_box
//     color:    white | pink | lavender
//     deco:     문자열 배열 (♡ ✦ ! 등 — 컬러 이모지는 서버리스 canvas가 못 그려서 스킵)
//     arrow:    boolean, arrowDir: up | down | left | right
import path from 'path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'

const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-Bold.ttf')
let FONT_FAMILY = 'sans-serif'
try {
  GlobalFonts.registerFromPath(FONT_PATH, 'YubiHand')
  FONT_FAMILY = 'YubiHand'
} catch { /* 폰트 등록 실패 시 기본 sans-serif */ }

const W = 1080
const H = 1920
const FONT_SIZE = 64
const PEN_WIDTH = 5

const COLORS = { white: '#ffffff', pink: '#f472b6', lavender: '#c4b5fd' }
const ANCHORS = {
  center: [0.5, 0.5],
  top_left: [0.12, 0.16], top_right: [0.88, 0.16], top_center: [0.5, 0.13],
  bottom_left: [0.12, 0.84], bottom_right: [0.88, 0.84], bottom_center: [0.5, 0.87],
}
const ARROW_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

const rnd = (a, b) => a + Math.random() * (b - a)
const jitter = (x, y, amt) => [x + rnd(-amt, amt), y + rnd(-amt, amt)]

function strokePath(ctx, pts, color, width = PEN_WIDTH, close = false) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  if (close) ctx.closePath()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

// 점들을 부드러운 곡선(중점 이차 베지어)으로 이어 닫힌 외곽선을 그린다.
function strokeSmoothClosed(ctx, pts, color, width = PEN_WIDTH) {
  if (pts.length < 3) return strokePath(ctx, pts, color, width, true)
  ctx.beginPath()
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let prev = mid(pts[pts.length - 1], pts[0])
  ctx.moveTo(prev[0], prev[1])
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    const next = mid(cur, pts[(i + 1) % pts.length])
    ctx.quadraticCurveTo(cur[0], cur[1], next[0], next[1])
  }
  ctx.closePath()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

// ── 손그림 도형 ────────────────────────────────────────────────────────
function drawCloud(ctx, box, color) {
  const [x0, y0, x1, y1] = box
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
  const bumps = 9, steps = bumps * 4
  const amt = Math.min(rx, ry) * 0.022 + 1.2
  const pts = []
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps
    const bulge = 1.1 + 0.17 * (Math.sin(bumps * a) * 0.5 + 0.5)
    pts.push(jitter(cx + rx * bulge * Math.cos(a), cy + ry * bulge * Math.sin(a), amt))
  }
  strokeSmoothClosed(ctx, pts, color, PEN_WIDTH)
}

function drawWobblyEllipse(ctx, cx, cy, rx, ry, color, n = 22) {
  const amt = Math.min(rx, ry) * 0.03 + 1.5
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push(jitter(cx + rx * Math.cos(a), cy + ry * Math.sin(a), amt))
  }
  strokeSmoothClosed(ctx, pts, color, PEN_WIDTH)
}

function drawWobblyRoundRect(ctx, box, color, radius = 34) {
  let [x0, y0, x1, y1] = box
  const r = Math.max(4, Math.min(radius, (x1 - x0) / 2 - 2, (y1 - y0) / 2 - 2))
  const arc = (cx, cy, a0, a1, k = 6) =>
    Array.from({ length: k }, (_, i) => {
      const a = a0 + (a1 - a0) * (i / (k - 1))
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
  const seg = (ax, ay, bx, by, k = 11) =>
    Array.from({ length: k }, (_, i) => [ax + (bx - ax) * (i / (k - 1)), ay + (by - ay) * (i / (k - 1))])
  const pts = [
    ...seg(x0 + r, y0, x1 - r, y0),
    ...arc(x1 - r, y0 + r, -Math.PI / 2, 0),
    ...seg(x1, y0 + r, x1, y1 - r),
    ...arc(x1 - r, y1 - r, 0, Math.PI / 2),
    ...seg(x1 - r, y1, x0 + r, y1),
    ...arc(x0 + r, y1 - r, Math.PI / 2, Math.PI),
    ...seg(x0, y1 - r, x0, y0 + r),
    ...arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5),
  ].map(([x, y]) => jitter(x, y, 2.5))
  strokeSmoothClosed(ctx, pts, color, PEN_WIDTH)
}

function drawSoftBacking(ctx, box, radius = 40, alpha = 0.45) {
  const [x0, y0, x1, y1] = box
  const r = Math.max(4, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
  ctx.save()
  ctx.fillStyle = `rgba(0,0,0,${alpha})`
  ctx.beginPath()
  ctx.moveTo(x0 + r, y0)
  ctx.arcTo(x1, y0, x1, y1, r)
  ctx.arcTo(x1, y1, x0, y1, r)
  ctx.arcTo(x0, y1, x0, y0, r)
  ctx.arcTo(x0, y0, x1, y0, r)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawDottedArrow(ctx, start, end, color) {
  const [x0, y0] = start, [x1, y1] = end
  const mx = (x0 + x1) / 2 + rnd(-20, 20)
  const my = (y0 + y1) / 2 + rnd(-20, 20)
  const n = 24
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([
      (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1,
      (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1,
    ])
  }
  for (let i = 0; i < pts.length - 1; i += 2) {
    strokePath(ctx, [pts[i], pts[Math.min(i + 1, pts.length - 1)]], color, PEN_WIDTH)
  }
  const [ax, ay] = pts[pts.length - 1]
  const [bx, by] = pts[pts.length - 3] || pts[0]
  const ang = Math.atan2(ay - by, ax - bx)
  for (const da of [0.5, -0.5]) {
    strokePath(ctx, [[ax, ay], [ax - 24 * Math.cos(ang + da), ay - 24 * Math.sin(ang + da)]], color, PEN_WIDTH)
  }
}

function drawDeco(ctx, x, y, ch, size, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(2, size * 0.12)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const s = size / 2
  if (ch === '♡' || ch === '♥' || ch === '❤') {
    ctx.beginPath()
    ctx.moveTo(x, y + s * 0.6)
    ctx.bezierCurveTo(x - s * 1.3, y - s * 0.5, x - s * 0.2, y - s * 1.1, x, y - s * 0.35)
    ctx.bezierCurveTo(x + s * 0.2, y - s * 1.1, x + s * 1.3, y - s * 0.5, x, y + s * 0.6)
    ctx.stroke()
  } else if (ch === '✦' || ch === '✧' || ch === '✨' || ch === '⭐' || ch === '★' || ch === '*') {
    // 4갈래 반짝이 — 긴 축/짧은 축을 번갈아 그려 별 모양
    ctx.beginPath()
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI / 4) * k - Math.PI / 2
      const r = k % 2 === 0 ? s : s * 0.32
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a)
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  } else if (ch === '!' || ch === '?' || ch === '·') {
    ctx.font = `700 ${size}px "${FONT_FAMILY}"`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(ch, x, y)
  }
  // 그 외(컬러 이모지 등)는 조용히 스킵 — 서버리스 canvas가 못 그림
  ctx.restore()
}

// ── 씬 렌더 ────────────────────────────────────────────────────────────
export function renderAnnotationPNG(scene) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const color = COLORS[scene.color] || COLORS.white
  const lines = String(scene.text || '').split('\n')
  ctx.font = `700 ${FONT_SIZE}px "${FONT_FAMILY}"`
  ctx.textBaseline = 'alphabetic'

  const lineWidths = lines.map((l) => ctx.measureText(l).width || 1)
  const blockW = Math.max(...lineWidths, 1)
  const blockH = FONT_SIZE * 1.5 * lines.length

  const [ax, ay] = ANCHORS[scene.position] || ANCHORS.center
  const cx = W * ax, cy = H * ay
  const padX = 52, padY = 40
  const boxW = blockW + padX * 2
  const boxH = blockH + padY * 2

  let left = cx - boxW / 2
  let top = cy - boxH / 2
  if (ax < 0.3) left = cx
  else if (ax > 0.7) left = cx - boxW
  if (ay < 0.3) top = cy
  else if (ay > 0.7) top = cy - boxH

  const bubble = scene.bubble || 'none'
  const inflMap = {
    cloud: [boxW * 0.10 + 20, boxH * 0.42 + 24],
    oval: [boxW * 0.16 + 16, boxH * 0.30 + 18],
    arrow_box: [26, 20],
  }
  const [ix, iy] = inflMap[bubble] || [0, 0]
  const margin = 24 + Math.max(ix, iy)
  left = Math.max(margin, Math.min(left, W - boxW - margin))
  top = Math.max(margin, Math.min(top, H - boxH - margin))
  const textBox = [left, top, left + boxW, top + boxH]
  const bubbleBox = [textBox[0] - ix, textBox[1] - iy, textBox[2] + ix, textBox[3] + iy]

  // 텍스트 뒤 반투명 판 (가독성) — 말풍선 종류와 무관하게 항상
  drawSoftBacking(ctx, [textBox[0] - 10, textBox[1] - 6, textBox[2] + 10, textBox[3] + 6],
    Math.min(boxW, boxH) * 0.35)

  if (bubble === 'cloud') drawCloud(ctx, bubbleBox, color)
  else if (bubble === 'oval') {
    drawWobblyEllipse(ctx, (bubbleBox[0] + bubbleBox[2]) / 2, (bubbleBox[1] + bubbleBox[3]) / 2,
      (bubbleBox[2] - bubbleBox[0]) / 2, (bubbleBox[3] - bubbleBox[1]) / 2, color)
  } else if (bubble === 'arrow_box') drawWobblyRoundRect(ctx, bubbleBox, color)

  // 텍스트 (줄마다 살짝 회전)
  ctx.font = `700 ${FONT_SIZE}px "${FONT_FAMILY}"`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let ty = top + padY + FONT_SIZE * 0.75
  for (const line of lines) {
    const tx = left + boxW / 2
    const angle = rnd(-3, 3) * (Math.PI / 180)
    ctx.save()
    ctx.translate(tx, ty)
    ctx.rotate(angle)
    ctx.fillText(line, 0, 0)
    ctx.restore()
    ty += FONT_SIZE * 1.5
  }

  // 데코
  const decoSize = Math.round(FONT_SIZE * 0.6)
  const decoPos = [
    [bubbleBox[0] - 10, bubbleBox[1] - 6], [bubbleBox[2] + 10, bubbleBox[1] - 2],
    [bubbleBox[0] - 6, bubbleBox[3] + 4], [bubbleBox[2] + 12, bubbleBox[3] + 8],
  ]
  ;(scene.deco || []).slice(0, 4).forEach((d, i) => {
    const [dx, dy] = decoPos[i % decoPos.length]
    drawDeco(ctx, dx, dy, d, decoSize, color)
  })

  // 화살표
  if (scene.arrow) {
    const [vx, vy] = ARROW_VEC[scene.arrowDir] || ARROW_VEC.right
    const bcx = (bubbleBox[0] + bubbleBox[2]) / 2
    const bcy = (bubbleBox[1] + bubbleBox[3]) / 2
    const bw = bubbleBox[2] - bubbleBox[0], bh = bubbleBox[3] - bubbleBox[1]
    const start = [bcx + vx * (bw / 2 + 20), bcy + vy * (bh / 2 + 20)]
    const end = [start[0] + vx * 150, start[1] + vy * 150]
    drawDottedArrow(ctx, start, end, color)
  }

  return canvas.toBuffer('image/png')
}

// 자막 폭 실측용 — render 라우트가 글자수 추정 대신 실제 폭으로 fontsize를 정할 때 사용.
export function measureCaptionWidth(text, fontSize) {
  const canvas = createCanvas(10, 10)
  const ctx = canvas.getContext('2d')
  ctx.font = `700 ${fontSize}px "${FONT_FAMILY}"`
  return ctx.measureText(String(text || '')).width || 0
}
