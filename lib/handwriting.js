// 손글씨 주석 오버레이 — 인스타 스토리풍 "허공에 떠 있는 손글씨".
// renderAnnotationPNG(scene) → 1080x1920 투명 PNG Buffer.
//
//   scene: { text, position|x|y, bubble, color, deco, arrow, arrowDir, arrowTarget,
//            backing, underline, fontSize }
//     bubble:    none | cloud | oval | arrow_box   (none = 판/테두리 없이 글씨만)
//     color:     white | pink | lavender
//     deco:      문자열 배열 (♡ ✦ ! ? ~ — 컬러 이모지는 서버리스 canvas가 못 그림)
//     backing:   true면 대비 보정을 더 강하게 (밝은 배경 가독성). 어두운 판은 안 씀.
//     underline: true면 텍스트 아래 점선 손그림 밑줄 (타이틀/강조용)
//
// 디자인 기준(레퍼런스 IMG_9616): 어두운 사각 판 금지. 손그림 형태를 따라가는
// 은은한 음영 + 얇은 다크 언더레이 + 글로우로만 가독성 확보. 삐뚤빼뚤·넉넉한
// 여백·흩뿌린 장식. 유비 촬영본은 밝고 하얀 배경이 많아 다크 언더레이가 필수.
import path from 'path'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'

const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts')
let FONT_FAMILY = 'sans-serif'
try {
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'NanumPenScript-Regular.ttf'), 'YubiHandScript')
  FONT_FAMILY = 'YubiHandScript'
} catch {
  try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'NotoSansKR-Bold.ttf'), 'YubiHand')
    FONT_FAMILY = 'YubiHand'
  } catch { /* 기본 sans-serif */ }
}

const W = 1080
const H = 1920
const FONT_SIZE = 64

const COLORS = { white: '#ffffff', pink: '#f45d9b', lavender: '#9d7cec' }
const DARK = 'rgba(0,0,0,0.55)'
const ANCHORS = {
  center: [0.5, 0.5],
  top_left: [0.22, 0.16], top_right: [0.78, 0.16], top_center: [0.5, 0.13],
  bottom_left: [0.22, 0.82], bottom_right: [0.78, 0.82], bottom_center: [0.5, 0.84],
}
const ARROW_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function setGlow(ctx, fs, strong) {
  ctx.shadowColor = strong ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = fs * (strong ? 0.26 : 0.18)
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
}
function clearGlow(ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0)'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

// ── 저수준 획 ─────────────────────────────────────────────────────────
function polyline(ctx, pts, color, width, close = false) {
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

// 닫힌 점열 → 부드러운 경로(중점 이차 베지어). stroke=true면 획, 아니면 현재 path만.
function smoothClosedPath(ctx, pts) {
  ctx.beginPath()
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const start = mid(pts[pts.length - 1], pts[0])
  ctx.moveTo(start[0], start[1])
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    const next = mid(cur, pts[(i + 1) % pts.length])
    ctx.quadraticCurveTo(cur[0], cur[1], next[0], next[1])
  }
  ctx.closePath()
}

// 손그림 도형 공통 페인트: 형태를 따르는 은은한 음영 → 다크 언더레이 → 컬러 획
function paintShape(ctx, pts, color, penW) {
  if (pts.length < 3) return polyline(ctx, pts, color, penW, true)
  smoothClosedPath(ctx, pts)
  const prevBlur = ctx.shadowBlur
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0)'
  ctx.fillStyle = 'rgba(0,0,0,0.24)'
  ctx.fill()
  ctx.restore()
  ctx.shadowBlur = prevBlur
  smoothClosedPath(ctx, pts)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = penW * 2.1
  ctx.lineJoin = 'round'
  ctx.stroke()
  smoothClosedPath(ctx, pts)
  ctx.strokeStyle = color
  ctx.lineWidth = penW
  ctx.stroke()
}

// ── 도형 점열 ─────────────────────────────────────────────────────────
function cloudPts(box, rnd, jitter) {
  const [x0, y0, x1, y1] = box
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
  const bumps = 6 + Math.round(rnd(0, 1))
  const steps = bumps * 8
  const amt = Math.min(rx, ry) * 0.02 + 1.6
  const phase = rnd(0, Math.PI * 2)
  const pts = []
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps
    // 완만한 물결 — 뾰족하지 않게 진폭 작게, sin을 부드럽게
    const wave = Math.sin(bumps * a + phase)
    const bulge = 1.0 + 0.085 * (wave * 0.5 + 0.5) + 0.02 * Math.sin(a * 2 + phase)
    pts.push(jitter(cx + rx * bulge * Math.cos(a), cy + ry * bulge * Math.sin(a), amt))
  }
  return pts
}
function ellipsePts(cx, cy, rx, ry, rnd, jitter, n = 24) {
  const amt = Math.min(rx, ry) * 0.04 + 2.5
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push(jitter(cx + rx * Math.cos(a), cy + ry * Math.sin(a), amt))
  }
  return pts
}
function roundRectPts(box, rnd, jitter, radius = 40) {
  const [x0, y0, x1, y1] = box
  const r = Math.max(6, Math.min(radius, (x1 - x0) / 2 - 2, (y1 - y0) / 2 - 2))
  const arc = (cx, cy, a0, a1, k = 7) =>
    Array.from({ length: k }, (_, i) => {
      const a = a0 + (a1 - a0) * (i / (k - 1))
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
  const seg = (ax, ay, bx, by, k = 12) =>
    Array.from({ length: k }, (_, i) => [ax + (bx - ax) * (i / (k - 1)), ay + (by - ay) * (i / (k - 1))])
  return [
    ...seg(x0 + r, y0, x1 - r, y0),
    ...arc(x1 - r, y0 + r, -Math.PI / 2, 0),
    ...seg(x1, y0 + r, x1, y1 - r),
    ...arc(x1 - r, y1 - r, 0, Math.PI / 2),
    ...seg(x1 - r, y1, x0 + r, y1),
    ...arc(x0 + r, y1 - r, Math.PI / 2, Math.PI),
    ...seg(x0, y1 - r, x0, y0 + r),
    ...arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5),
  ].map(([x, y]) => jitter(x, y, 3.5))
}

// 텍스트 아래 점선 손그림 밑줄
function drawDashedUnderline(ctx, x0, x1, y, color, penW, rnd) {
  const span = x1 - x0
  const unit = span / 13
  const dash = (yA, yB) => {
    let x = x0
    while (x < x1 - unit * 0.3) {
      const len = unit * rnd(0.5, 0.95)
      ctx.beginPath()
      ctx.moveTo(x, y + rnd(-3, 3))
      ctx.quadraticCurveTo(x + len / 2, y + rnd(-4, 4), Math.min(x + len, x1), y + rnd(-3, 3))
      ctx.stroke()
      x += len + unit * rnd(0.4, 0.7)
    }
  }
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = penW * 2.1; dash()
  ctx.strokeStyle = color; ctx.lineWidth = penW; dash()
}

function drawDottedArrow(ctx, start, end, color, penW, rnd) {
  const [x0, y0] = start, [x1, y1] = end
  const mx = (x0 + x1) / 2 + rnd(-40, 40)
  const my = (y0 + y1) / 2 + rnd(-30, 30)
  const n = 26
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([
      (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1,
      (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1,
    ])
  }
  const paint = (col, w) => {
    for (let i = 0; i < pts.length - 1; i += 2) {
      polyline(ctx, [pts[i], pts[Math.min(i + 1, pts.length - 1)]], col, w)
    }
    const [ax, ay] = pts[pts.length - 1]
    const [bx, by] = pts[pts.length - 3] || pts[0]
    const ang = Math.atan2(ay - by, ax - bx)
    for (const da of [0.45, -0.45]) {
      polyline(ctx, [[ax, ay], [ax - 26 * Math.cos(ang + da), ay - 26 * Math.sin(ang + da)]], col, w)
    }
  }
  paint('rgba(0,0,0,0.4)', penW * 2.1)
  paint(color, penW)
}

function drawDeco(ctx, x, y, ch, size, color, rnd) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rnd(-0.3, 0.3))
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const s = size / 2
  const heart = () => {
    ctx.beginPath()
    ctx.moveTo(0, s * 0.6)
    ctx.bezierCurveTo(-s * 1.3, -s * 0.5, -s * 0.2, -s * 1.1, 0, -s * 0.35)
    ctx.bezierCurveTo(s * 0.2, -s * 1.1, s * 1.3, -s * 0.5, 0, s * 0.6)
  }
  if (ch === '♡' || ch === '♥' || ch === '❤') {
    heart(); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(3, size * 0.2); ctx.stroke()
    heart(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, size * 0.11); ctx.stroke()
  } else if (ch === '✦' || ch === '✧' || ch === '✨' || ch === '⭐' || ch === '★' || ch === '*') {
    for (let k = 0; k < 4; k++) {
      const a = (Math.PI / 2) * k + rnd(-0.15, 0.15)
      const r = k % 2 === 0 ? s : s * 0.8
      const seg = [[-r * Math.cos(a), -r * Math.sin(a)], [r * Math.cos(a), r * Math.sin(a)]]
      polyline(ctx, seg, 'rgba(0,0,0,0.4)', Math.max(3, size * 0.19))
      polyline(ctx, seg, color, Math.max(2, size * 0.1))
    }
  } else if (ch === '!' || ch === '?' || ch === '·' || ch === '~') {
    ctx.font = `${size}px "${FONT_FAMILY}"`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = size * 0.16; ctx.strokeText(ch, 0, 0)
    ctx.fillStyle = color; ctx.fillText(ch, 0, 0)
  }
  ctx.restore()
}

function scatterDeco(ctx, bbox, decoArr, fs, color, rnd) {
  const [x0, y0, x1, y1] = bbox
  const w = x1 - x0, h = y1 - y0
  const spots = [
    [x0 + w * rnd(0.05, 0.28), y0 - rnd(8, 24)],        // 위쪽 살짝 왼쪽 (레퍼런스 ´´´)
    [x1 + rnd(0, 12), y0 + h * rnd(0.15, 0.5)],          // 오른쪽 끝 (하트)
    [x0 - rnd(2, 14), y0 + h * rnd(0.25, 0.65)],         // 왼쪽
    [x1 - w * rnd(0.05, 0.25), y1 + rnd(2, 14)],         // 아래 오른쪽
  ]
  decoArr.slice(0, 3).forEach((d, i) => {
    const [dx, dy] = spots[i % spots.length]
    drawDeco(ctx, dx, dy, d, Math.round(fs * rnd(0.36, 0.48)), color, rnd)
  })
}

// ── 씬 렌더 ────────────────────────────────────────────────────────────
export function renderAnnotationPNG(scene) {
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const color = COLORS[scene.color] || COLORS.white

  const seed = mulberry32(hashStr(JSON.stringify(scene)))
  const rnd = (a, b) => a + seed() * (b - a)
  const jitter = (x, y, amt) => [x + rnd(-amt, amt), y + rnd(-amt, amt)]

  const lines = String(scene.text || '').split('\n')
  const fs = Math.max(20, Number(scene.fontSize) || FONT_SIZE)
  const penW = Math.max(3, fs * 0.058)
  ctx.font = `${fs}px "${FONT_FAMILY}"`
  ctx.textBaseline = 'alphabetic'

  const lineWidths = lines.map((l) => ctx.measureText(l).width || 1)
  const blockW = Math.max(...lineWidths, 1)
  const lineH = fs * 1.34
  const blockH = lineH * lines.length

  const padX = 30, padY = 20
  const boxW = blockW + padX * 2
  const boxH = blockH + padY * 2

  let cx, cy
  if (scene.x != null || scene.y != null) {
    cx = W * (scene.x != null ? Number(scene.x) : 0.5)
    cy = H * (scene.y != null ? Number(scene.y) : 0.5)
  } else {
    const [ax, ay] = ANCHORS[scene.position] || ANCHORS.center
    cx = W * ax
    cy = H * ay
  }

  const bubble = scene.bubble || 'none'
  const inflMap = {
    cloud: [boxW * 0.13 + 26, boxH * 0.20 + 20],
    oval: [boxW * 0.18 + 16, boxH * 0.24 + 14],
    arrow_box: [24, 18],
  }
  const [ix, iy] = inflMap[bubble] || [0, 0]

  let left = cx - boxW / 2
  let top = cy - boxH / 2
  const marginX = 26 + ix
  const arrowPad = scene.arrow ? H * 0.09 : 0
  const capSafeTop = H * 0.72 - boxH - iy - arrowPad
  left = Math.max(marginX, Math.min(left, W - boxW - marginX))
  top = Math.max(46 + iy, Math.min(top, Math.min(H - boxH - 46 - iy, capSafeTop)))

  const textBox = [left, top, left + boxW, top + boxH]
  const bubbleBox = [textBox[0] - ix, textBox[1] - iy, textBox[2] + ix, textBox[3] + iy]

  const strong = scene.backing !== false
  setGlow(ctx, fs, strong)

  // 버블
  if (bubble === 'cloud') paintShape(ctx, cloudPts(bubbleBox, rnd, jitter), color, penW)
  else if (bubble === 'oval') {
    paintShape(ctx, ellipsePts((bubbleBox[0] + bubbleBox[2]) / 2, (bubbleBox[1] + bubbleBox[3]) / 2,
      (bubbleBox[2] - bubbleBox[0]) / 2, (bubbleBox[3] - bubbleBox[1]) / 2, rnd, jitter), color, penW)
  } else if (bubble === 'arrow_box') paintShape(ctx, roundRectPts(bubbleBox, rnd, jitter), color, penW)

  // 텍스트 — 다크 획 + 컬러 채움, 줄별 흔들, 전체 살짝 기울임
  ctx.font = `${fs}px "${FONT_FAMILY}"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const blockTilt = rnd(-2.0, 2.0) * (Math.PI / 180)
  const bcx = left + boxW / 2
  for (let i = 0; i < lines.length; i++) {
    const ty = top + padY + lineH * (i + 0.5)
    ctx.save()
    ctx.translate(bcx + rnd(-6, 6), ty)
    ctx.rotate(blockTilt + rnd(-1.2, 1.2) * (Math.PI / 180))
    ctx.strokeStyle = DARK
    ctx.lineWidth = fs * 0.22
    ctx.strokeText(lines[i], 0, 0)
    ctx.strokeStyle = DARK
    ctx.lineWidth = fs * 0.11
    ctx.strokeText(lines[i], 0, 0)
    ctx.fillStyle = color
    ctx.fillText(lines[i], 0, 0)
    ctx.restore()
  }

  if (scene.underline) {
    const uy = top + padY + lineH * (lines.length - 0.5) + fs * 0.5
    drawDashedUnderline(ctx, left + padX * 0.5, left + boxW - padX * 0.5, uy, color, penW * 0.8, rnd)
  }

  scatterDeco(ctx, bubble === 'none' ? textBox : bubbleBox, scene.deco || [], fs, color, rnd)

  if (scene.arrow) {
    const acx = (bubbleBox[0] + bubbleBox[2]) / 2
    const acy = (bubbleBox[1] + bubbleBox[3]) / 2
    const bw = bubbleBox[2] - bubbleBox[0], bh = bubbleBox[3] - bubbleBox[1]
    const tgt = scene.arrowTarget
    let start, end
    if (Array.isArray(tgt) && tgt.length === 2) {
      const ex = W * Number(tgt[0]), ey = H * Number(tgt[1])
      const dx = ex - acx, dy = ey - acy
      const d = Math.max(1, Math.hypot(dx, dy))
      start = [acx + (dx / d) * (bw / 2 + 18), acy + (dy / d) * (bh / 2 + 18)]
      end = [ex, ey]
    } else {
      const [vx, vy] = ARROW_VEC[scene.arrowDir] || ARROW_VEC.down
      start = [acx + vx * (bw / 2 + 18), acy + vy * (bh / 2 + 18)]
      end = [start[0] + vx * 155 + rnd(-30, 30), start[1] + vy * 155 + rnd(-20, 20)]
    }
    drawDottedArrow(ctx, start, end, color, penW * 0.95, rnd)
  }

  clearGlow(ctx)
  return canvas.toBuffer('image/png')
}

// 자막 폭 실측용 — render 라우트가 글자수 추정 대신 실제 폭으로 fontsize를 정할 때 사용.
export function measureCaptionWidth(text, fontSize) {
  const canvas = createCanvas(10, 10)
  const ctx = canvas.getContext('2d')
  ctx.font = `${fontSize}px "${FONT_FAMILY}"`
  return ctx.measureText(String(text || '')).width || 0
}
