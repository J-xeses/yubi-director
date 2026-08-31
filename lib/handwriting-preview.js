// 브라우저 canvas로 손글씨 주석을 즉시 미리 그린다.
// lib/handwriting.js(@napi-rs/canvas, 서버 렌더)의 축약 포팅 — 서버 결과와
// 픽셀 단위로 같지는 않지만 말풍선/색/위치/장식/화살표의 "느낌"을 실시간으로
// 확인할 수 있게 한다. 폰트는 페이지에 로드된 'Nanum Pen Script'(손글씨) → 'Noto Sans KR' 순.

const W = 1080
const H = 1920
const FONT_SIZE = 64
const PEN_WIDTH = 5
const FONT_STACK = '"Nanum Pen Script", "Noto Sans KR", system-ui, sans-serif'
const fontStr = (px) => `${px}px ${FONT_STACK}`
const FONT = fontStr(FONT_SIZE)

const COLORS = { white: '#ffffff', pink: '#f472b6', lavender: '#c4b5fd' }
const ANCHORS = {
  center: [0.5, 0.5],
  top_left: [0.12, 0.16], top_right: [0.88, 0.16], top_center: [0.5, 0.13],
  bottom_left: [0.12, 0.84], bottom_right: [0.88, 0.84], bottom_center: [0.5, 0.87],
}
const ARROW_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

// 시드 기반 난수 — 같은 설정이면 늘 같은 손그림(타이핑마다 흔들리지 않게)
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

export function drawAnnotationPreview(canvas, scene) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const cw = canvas.width
  const chh = canvas.height
  ctx.clearRect(0, 0, cw, chh)

  // 화면 대용 배경 — 실제 영상 위에 얹히므로 중간 톤으로
  const g = ctx.createLinearGradient(0, 0, 0, chh)
  g.addColorStop(0, '#8b8987')
  g.addColorStop(1, '#6f6d6b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, cw, chh)

  ctx.save()
  ctx.scale(cw / W, chh / H)

  const color = COLORS[scene.color] || COLORS.white
  const deco = Array.isArray(scene.deco)
    ? scene.deco
    : String(scene.deco || '').split(',').map((s) => s.trim()).filter(Boolean)
  const bubble = scene.bubble || 'none'

  const seed = mulberry32(hashStr(
    (scene.text || '') + '|' + bubble + '|' + scene.color + '|' + deco.join('') +
    '|' + scene.position + '|' + scene.arrow + '|' + scene.arrowDir
  ))
  const rnd = (a, b) => a + seed() * (b - a)
  const jitter = (x, y, amt) => [x + rnd(-amt, amt), y + rnd(-amt, amt)]

  const strokePath = (pts, col, width = PEN_WIDTH, close = false) => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    if (close) ctx.closePath()
    ctx.strokeStyle = col; ctx.lineWidth = width
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.stroke()
  }
  const strokeSmoothClosed = (pts, col, width = PEN_WIDTH) => {
    if (pts.length < 3) return strokePath(pts, col, width, true)
    ctx.beginPath()
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const p0 = mid(pts[pts.length - 1], pts[0])
    ctx.moveTo(p0[0], p0[1])
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]
      const next = mid(cur, pts[(i + 1) % pts.length])
      ctx.quadraticCurveTo(cur[0], cur[1], next[0], next[1])
    }
    ctx.closePath()
    ctx.strokeStyle = col; ctx.lineWidth = width
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.stroke()
  }
  const drawCloud = (box, col) => {
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
    strokeSmoothClosed(pts, col)
  }
  const drawWobblyEllipse = (cx, cy, rx, ry, col, n = 22) => {
    const amt = Math.min(rx, ry) * 0.03 + 1.5
    const pts = []
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      pts.push(jitter(cx + rx * Math.cos(a), cy + ry * Math.sin(a), amt))
    }
    strokeSmoothClosed(pts, col)
  }
  const drawWobblyRoundRect = (box, col, radius = 34) => {
    const [x0, y0, x1, y1] = box
    const r = Math.max(4, Math.min(radius, (x1 - x0) / 2 - 2, (y1 - y0) / 2 - 2))
    const arc = (cx, cy, a0, a1, k = 6) => Array.from({ length: k }, (_, i) => {
      const a = a0 + (a1 - a0) * (i / (k - 1))
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    const seg = (ax, ay, bx, by, k = 11) => Array.from({ length: k }, (_, i) =>
      [ax + (bx - ax) * (i / (k - 1)), ay + (by - ay) * (i / (k - 1))])
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
    strokeSmoothClosed(pts, col)
  }
  const drawSoftBacking = (box, radius = 40, alpha = 0.45) => {
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
  const drawDottedArrow = (start, end, col) => {
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
      strokePath([pts[i], pts[Math.min(i + 1, pts.length - 1)]], col)
    }
    const [ax, ay] = pts[pts.length - 1]
    const [bx, by] = pts[pts.length - 3] || pts[0]
    const ang = Math.atan2(ay - by, ax - bx)
    for (const da of [0.5, -0.5]) {
      strokePath([[ax, ay], [ax - 24 * Math.cos(ang + da), ay - 24 * Math.sin(ang + da)]], col)
    }
  }
  const drawDeco = (x, y, ch, size, col) => {
    ctx.save()
    ctx.strokeStyle = col; ctx.fillStyle = col
    ctx.lineWidth = Math.max(2, size * 0.12)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    const s = size / 2
    if (ch === '♡' || ch === '♥' || ch === '❤') {
      ctx.beginPath()
      ctx.moveTo(x, y + s * 0.6)
      ctx.bezierCurveTo(x - s * 1.3, y - s * 0.5, x - s * 0.2, y - s * 1.1, x, y - s * 0.35)
      ctx.bezierCurveTo(x + s * 0.2, y - s * 1.1, x + s * 1.3, y - s * 0.5, x, y + s * 0.6)
      ctx.stroke()
    } else if (ch === '✦' || ch === '✧' || ch === '✨' || ch === '⭐' || ch === '★' || ch === '*') {
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
      ctx.font = fontStr(size)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(ch, x, y)
    }
    ctx.restore()
  }

  // ── 씬 배치 (handwriting.js renderAnnotationPNG와 동일 로직) ──
  const lines = String(scene.text || ' ').split('\n')
  const fs = Math.max(20, Number(scene.fontSize) || FONT_SIZE)
  ctx.font = fontStr(fs)
  ctx.textBaseline = 'alphabetic'
  const lineWidths = lines.map((l) => ctx.measureText(l).width || 1)
  const blockW = Math.max(...lineWidths, 1)
  const blockH = fs * 1.5 * lines.length

  const padX = 52, padY = 40
  const boxW = blockW + padX * 2
  const boxH = blockH + padY * 2

  let left, top
  if (scene.x != null || scene.y != null) {
    left = W * (Number(scene.x) || 0.5) - boxW / 2
    top = H * (Number(scene.y) || 0.5) - boxH / 2
  } else {
    const [ax, ay] = ANCHORS[scene.position] || ANCHORS.center
    const cx = W * ax, cy = H * ay
    left = cx - boxW / 2
    top = cy - boxH / 2
    if (ax < 0.3) left = cx
    else if (ax > 0.7) left = cx - boxW
    if (ay < 0.3) top = cy
    else if (ay > 0.7) top = cy - boxH
  }

  const inflMap = {
    cloud: [boxW * 0.07 + 16, boxH * 0.34 + 18],
    oval: [boxW * 0.14 + 14, boxH * 0.26 + 16],
    arrow_box: [24, 18],
  }
  const [ix, iy] = inflMap[bubble] || [0, 0]
  const margin = 24 + Math.max(ix, iy)
  left = Math.max(margin, Math.min(left, W - boxW - margin))
  top = Math.max(margin, Math.min(top, H - boxH - margin))
  const textBox = [left, top, left + boxW, top + boxH]
  const bubbleBox = [textBox[0] - ix, textBox[1] - iy, textBox[2] + ix, textBox[3] + iy]

  // 말풍선이 있으면 판을 그리지 않는다(버블 안에 박스처럼 이중으로 보임) — 글자 외곽선만.
  const backing = scene.backing !== false
  const showPlate = bubble === 'none' && backing
  if (showPlate) {
    drawSoftBacking([textBox[0] - 10, textBox[1] - 6, textBox[2] + 10, textBox[3] + 6],
      Math.min(boxW, boxH) * 0.35)
  }
  const strokeW = showPlate ? 0 : Math.max(3, fs * 0.07)

  if (bubble === 'cloud') drawCloud(bubbleBox, color)
  else if (bubble === 'oval') {
    drawWobblyEllipse((bubbleBox[0] + bubbleBox[2]) / 2, (bubbleBox[1] + bubbleBox[3]) / 2,
      (bubbleBox[2] - bubbleBox[0]) / 2, (bubbleBox[3] - bubbleBox[1]) / 2, color)
  } else if (bubble === 'arrow_box') drawWobblyRoundRect(bubbleBox, color)

  ctx.font = fontStr(fs)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (strokeW) {
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    ctx.lineWidth = strokeW
    ctx.lineJoin = 'round'
  }
  let ty = top + padY + fs * 0.75
  for (const line of lines) {
    const tx = left + boxW / 2
    const angle = rnd(-3, 3) * (Math.PI / 180)
    ctx.save()
    ctx.translate(tx, ty)
    ctx.rotate(angle)
    if (strokeW) ctx.strokeText(line, 0, 0)
    ctx.fillText(line, 0, 0)
    ctx.restore()
    ty += fs * 1.5
  }

  const decoSize = Math.round(fs * 0.6)
  const decoPos = [
    [bubbleBox[0] - 10, bubbleBox[1] - 6], [bubbleBox[2] + 10, bubbleBox[1] - 2],
    [bubbleBox[0] - 6, bubbleBox[3] + 4], [bubbleBox[2] + 12, bubbleBox[3] + 8],
  ]
  deco.slice(0, 4).forEach((d, i) => {
    const [dx, dy] = decoPos[i % decoPos.length]
    drawDeco(dx, dy, d, decoSize, color)
  })

  if (scene.arrow) {
    const bcx = (bubbleBox[0] + bubbleBox[2]) / 2
    const bcy = (bubbleBox[1] + bubbleBox[3]) / 2
    const bw = bubbleBox[2] - bubbleBox[0], bh = bubbleBox[3] - bubbleBox[1]
    const tgt = scene.arrowTarget
    let start, end
    if (Array.isArray(tgt) && tgt.length === 2) {
      const ex = W * Number(tgt[0]), ey = H * Number(tgt[1])
      const dx = ex - bcx, dy = ey - bcy
      const d = Math.max(1, Math.hypot(dx, dy))
      start = [bcx + (dx / d) * (bw / 2 + 20), bcy + (dy / d) * (bh / 2 + 20)]
      end = [ex, ey]
    } else {
      const [vx, vy] = ARROW_VEC[scene.arrowDir] || ARROW_VEC.right
      start = [bcx + vx * (bw / 2 + 20), bcy + vy * (bh / 2 + 20)]
      end = [start[0] + vx * 150, start[1] + vy * 150]
    }
    drawDottedArrow(start, end, color)
  }

  ctx.restore()
}
