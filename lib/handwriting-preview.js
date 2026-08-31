// 브라우저 canvas로 손글씨 주석을 즉시 미리 그린다.
// lib/handwriting.js(@napi-rs/canvas, 서버 렌더)의 포팅 — 픽셀 단위로 같지는 않지만
// "손으로 그린" 느낌(얇은 획·다크 헤일로·물결 밑줄·스캘롭 구름·흩뿌린 장식·사물 라벨
// 화살표)을 실시간으로 확인할 수 있게 한다. 폰트: 'Gaegu'(도톰) → 'Nanum Pen Script'.

const W = 1080
const H = 1920
const FONT_SIZE = 64
const FONT_STACK = '"Gaegu", "Nanum Pen Script", "Noto Sans KR", system-ui, sans-serif'
const fontStr = (px) => `700 ${px}px ${FONT_STACK}`

const COLORS = { white: '#ffffff', pink: '#f9a8d0', lavender: '#c3b3f5' }
const CAPTION_FONT_STACK = '"Noto Sans KR", system-ui, sans-serif'

// 검토뷰용 자막 그리기 — 렌더 라우트의 drawtext(어두운 박스 + 흰 글씨)를 흉내낸다.
export function paintCaptionInto(ctx, text, cw, chh) {
  const t = String(text || '').replace(/\s*\r?\n\s*/g, ' ').trim()
  if (!t) return
  ctx.save()
  ctx.scale(cw / W, chh / H)
  let fs = 58
  ctx.font = `700 ${fs}px ${CAPTION_FONT_STACK}`
  let tw = ctx.measureText(t).width
  const maxW = W - 120
  if (tw > maxW) { fs = Math.max(34, Math.floor(fs * maxW / tw)); ctx.font = `700 ${fs}px ${CAPTION_FONT_STACK}`; tw = ctx.measureText(t).width }
  const padX = 22, padY = 12
  const cxc = W / 2
  const y = H * 0.855
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  const bx = cxc - tw / 2 - padX
  const bw = tw + padX * 2
  const bh = fs + padY * 2
  ctx.beginPath()
  const r = 8
  ctx.moveTo(bx + r, y - bh / 2)
  ctx.arcTo(bx + bw, y - bh / 2, bx + bw, y + bh / 2, r)
  ctx.arcTo(bx + bw, y + bh / 2, bx, y + bh / 2, r)
  ctx.arcTo(bx, y + bh / 2, bx, y - bh / 2, r)
  ctx.arcTo(bx, y - bh / 2, bx + bw, y - bh / 2, r)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(t, cxc, y)
  ctx.restore()
}

const ANCHORS = {
  center: [0.5, 0.5],
  top_left: [0.24, 0.16], top_right: [0.76, 0.16], top_center: [0.5, 0.13],
  bottom_left: [0.24, 0.82], bottom_right: [0.76, 0.82], bottom_center: [0.5, 0.84],
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

// 편집기 카드용 — 자체 배경(중간 톤) 위에 주석 하나 그림
export function drawAnnotationPreview(canvas, scene) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const cw = canvas.width
  const chh = canvas.height
  ctx.clearRect(0, 0, cw, chh)
  const g = ctx.createLinearGradient(0, 0, 0, chh)
  g.addColorStop(0, '#8b8987')
  g.addColorStop(1, '#6f6d6b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, cw, chh)
  ctx.save()
  ctx.scale(cw / W, chh / H)
  paintAnnotation(ctx, scene)
  ctx.restore()
}

// 검토뷰 합성용 — 이미 그려진 프레임 위에 주석을 얹는다 (배경 안 그림)
export function paintAnnotationInto(ctx, scene, cw, chh) {
  ctx.save()
  ctx.scale(cw / W, chh / H)
  paintAnnotation(ctx, scene)
  ctx.restore()
}

// 스케일된 ctx(1080×1920 좌표계)에 주석 하나를 그린다. handwriting.js renderAnnotationPNG 포팅.
function paintAnnotation(ctx, scene) {
  const color = COLORS[scene.color] || COLORS.white
  const bubble = scene.bubble || 'none'
  const lines = String(scene.text || ' ').split('\n')
  const fs = Math.max(20, Number(scene.fontSize) || FONT_SIZE)
  const penW = Math.max(2.2, fs * 0.042)

  const seed = mulberry32(hashStr(JSON.stringify(scene)))
  const rnd = (a, b) => a + seed() * (b - a)

  const stroke = (pts, col, width, close = false) => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    if (close) ctx.closePath()
    ctx.strokeStyle = col; ctx.lineWidth = width
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.stroke()
  }
  const smoothClosed = (pts) => {
    ctx.beginPath()
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const s = mid(pts[pts.length - 1], pts[0])
    ctx.moveTo(s[0], s[1])
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]
      const nxt = mid(cur, pts[(i + 1) % pts.length])
      ctx.quadraticCurveTo(cur[0], cur[1], nxt[0], nxt[1])
    }
    ctx.closePath()
  }
  const cloudPts = (box) => {
    const [x0, y0, x1, y1] = box
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
    const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    const scallops = Math.max(9, Math.round(per / (Math.min(rx, ry) * 0.62)))
    const steps = scallops * 6
    const depth = Math.min(rx, ry) * 0.11
    const phase = rnd(0, Math.PI * 2)
    const pts = []
    for (let i = 0; i < steps; i++) {
      const a = (2 * Math.PI * i) / steps
      const wob = 0.5 - 0.5 * Math.cos(scallops * a + phase)
      const r = 1 - (depth / Math.min(rx, ry)) * wob + rnd(-0.012, 0.012)
      pts.push([cx + rx * r * Math.cos(a) + rnd(-1.5, 1.5), cy + ry * r * Math.sin(a) + rnd(-1.5, 1.5)])
    }
    return pts
  }
  const ellipsePts = (cx, cy, rx, ry, n = 30) => {
    const amt = Math.min(rx, ry) * 0.02 + 1.5
    const pts = []
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n
      pts.push([cx + rx * Math.cos(a) + rnd(-amt, amt), cy + ry * Math.sin(a) + rnd(-amt, amt)])
    }
    return pts
  }
  const roundRectPts = (box, radius = 38) => {
    const [x0, y0, x1, y1] = box
    const r = Math.max(6, Math.min(radius, (x1 - x0) / 2 - 2, (y1 - y0) / 2 - 2))
    const arc = (cx, cy, a0, a1, k = 7) => Array.from({ length: k }, (_, i) => {
      const a = a0 + (a1 - a0) * (i / (k - 1))
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    const seg = (ax, ay, bx, by, k = 10) => Array.from({ length: k }, (_, i) =>
      [ax + (bx - ax) * (i / (k - 1)), ay + (by - ay) * (i / (k - 1))])
    return [
      ...seg(x0 + r, y0, x1 - r, y0), ...arc(x1 - r, y0 + r, -Math.PI / 2, 0),
      ...seg(x1, y0 + r, x1, y1 - r), ...arc(x1 - r, y1 - r, 0, Math.PI / 2),
      ...seg(x1 - r, y1, x0 + r, y1), ...arc(x0 + r, y1 - r, Math.PI / 2, Math.PI),
      ...seg(x0, y1 - r, x0, y0 + r), ...arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5),
    ].map(([x, y]) => [x + rnd(-2, 2), y + rnd(-2, 2)])
  }
  const cloudTailPts = (box, dir = 1) => {
    const [x0, y0, x1, y1] = box
    let px = x0 + (x1 - x0) * (dir > 0 ? 0.3 : 0.7)
    let py = y1 - (y1 - y0) * 0.03
    let r = Math.max(5, (y1 - y0) * 0.05)
    const out = []
    for (let i = 0; i < 3; i++) { px += dir * r * 1.7; py += r * 2.2; out.push([px, py, r]); r *= 0.6 }
    return out
  }
  const wavyUnderline = (x0, x1, y, col, pW, phase) => {
    const span = x1 - x0
    const periods = Math.max(2, Math.round(span / 130))
    const amp = pW * 1.8
    const n = periods * 18
    const pts = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push([x0 + span * t, y + Math.sin(t * periods * Math.PI * 2 + phase) * amp])
    }
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
    }
    ctx.strokeStyle = col; ctx.lineWidth = pW; ctx.lineCap = 'round'
    ctx.stroke()
  }
  const ticksAt = (cx, y, size, col, pW, lean) => {
    for (let k = -1; k <= 1; k++) {
      const x = cx + k * size * 0.5
      const a = k * 0.2 + (lean[k + 1] || 0)
      stroke([
        [x - Math.sin(a) * size * 0.5, y - Math.cos(a) * size * 0.5],
        [x + Math.sin(a) * size * 0.5, y + Math.cos(a) * size * 0.5],
      ], col, pW)
    }
  }
  const arrowBent = (start, end, bend, col, pW) => {
    const [x0, y0] = start, [x1, y1] = end
    const mx = (x0 + x1) / 2 + bend[0]
    const my = (y0 + y1) / 2 + bend[1]
    const n = 30
    const pts = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      pts.push([
        (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1,
        (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1,
      ])
    }
    for (let i = 0; i < pts.length - 1; i += 2) stroke([pts[i], pts[Math.min(i + 1, pts.length - 1)]], col, pW)
    const [ax, ay] = pts[pts.length - 1]
    const [bx, by] = pts[pts.length - 4] || pts[0]
    const ang = Math.atan2(ay - by, ax - bx)
    for (const da of [0.42, -0.42]) {
      stroke([[ax, ay], [ax - 24 * Math.cos(ang + da), ay - 24 * Math.sin(ang + da)]], col, pW)
    }
  }
  const drawDecoAt = (spec, col, pW) => {
    const { ch, x, y, size, rot } = spec
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.strokeStyle = col; ctx.fillStyle = col
    const s = size / 2
    if (ch === '♡' || ch === '♥' || ch === '❤') {
      ctx.lineWidth = Math.max(2, size * 0.14)
      ctx.beginPath()
      ctx.moveTo(0, s * 0.75)
      ctx.bezierCurveTo(-s * 1.5, -s * 0.35, -s * 0.35, -s * 1.15, 0, -s * 0.28)
      ctx.bezierCurveTo(s * 0.35, -s * 1.15, s * 1.5, -s * 0.35, 0, s * 0.75)
      ctx.stroke()
    } else if (ch === '✦' || ch === '✧' || ch === '✨' || ch === '⭐' || ch === '★' || ch === '*') {
      const lw = Math.max(2, size * 0.1)
      for (let k = 0; k < 4; k++) {
        const a = (Math.PI / 2) * k
        const r = k % 2 === 0 ? s : s * 0.76
        stroke([[-r * Math.cos(a), -r * Math.sin(a)], [r * Math.cos(a), r * Math.sin(a)]], col, lw)
      }
    } else if (ch === '!' || ch === '?' || ch === '·' || ch === '~') {
      ctx.font = fontStr(size)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(ch, 0, 0)
    }
    ctx.restore()
  }

  // ── 배치 (handwriting.js와 동일) ──
  ctx.font = fontStr(fs)
  ctx.textBaseline = 'alphabetic'
  const lineWidths = lines.map((l) => ctx.measureText(l).width || 1)
  const blockW = Math.max(...lineWidths, 1)
  const lineH = fs * 1.32
  const blockH = lineH * lines.length
  const padX = 28, padY = 18
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

  const inflMap = {
    cloud: [boxW * 0.10 + 24, boxH * 0.16 + 18],
    oval: [boxW * 0.16 + 14, boxH * 0.22 + 12],
    arrow_box: [22, 16],
  }
  const [ix, iy] = inflMap[bubble] || [0, 0]

  let left = cx - boxW / 2
  let top = cy - boxH / 2
  const marginX = 24 + ix
  const arrowPad = scene.arrow ? H * 0.09 : 0
  const tailPad = bubble === 'cloud' ? H * 0.05 : 0
  const capSafeTop = H * 0.72 - boxH - iy - arrowPad - tailPad
  left = Math.max(marginX, Math.min(left, W - boxW - marginX))
  top = Math.max(52 + iy, Math.min(top, Math.min(H - boxH - 52 - iy, capSafeTop)))

  const textBox = [left, top, left + boxW, top + boxH]
  const bubbleBox = [textBox[0] - ix, textBox[1] - iy, textBox[2] + ix, textBox[3] + iy]
  const strong = scene.backing !== false
  const bcx = left + boxW / 2

  // 기하 미리 계산
  const geo = {}
  if (bubble !== 'none') {
    geo.bubblePts = bubble === 'cloud' ? cloudPts(bubbleBox)
      : bubble === 'oval' ? ellipsePts((bubbleBox[0] + bubbleBox[2]) / 2, (bubbleBox[1] + bubbleBox[3]) / 2,
        (bubbleBox[2] - bubbleBox[0]) / 2, (bubbleBox[3] - bubbleBox[1]) / 2)
        : roundRectPts(bubbleBox)
    if (bubble === 'cloud') geo.tailDir = bcx > W / 2 ? -1 : 1
  }
  const blockTilt = rnd(-1.8, 1.8) * (Math.PI / 180)
  geo.lines = lines.map((_, i) => ({
    ty: top + padY + lineH * (i + 0.5),
    dx: rnd(-4, 4),
    rot: blockTilt + rnd(-0.9, 0.9) * (Math.PI / 180),
  }))
  if (scene.underline) {
    geo.uy = top + padY + lineH * (lines.length - 0.5) + fs * 0.46
    geo.wavePh = rnd(0, Math.PI)
    geo.tickLean = [rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1)]
  }
  const decoArr = (Array.isArray(scene.deco) ? scene.deco
    : String(scene.deco || '').split(',').map((s) => s.trim()).filter(Boolean)).slice(0, 3)
  {
    const db = bubble === 'none' ? textBox : bubbleBox
    const [dx0, dy0, dx1, dy1] = db
    const dw = dx1 - dx0, dh = dy1 - dy0
    const dspots = [
      [dx1 + rnd(4, 16), dy0 + dh * rnd(0.1, 0.4)],
      [dx0 - rnd(4, 16), dy0 + dh * rnd(0.3, 0.7)],
      [dx1 - dw * rnd(0.05, 0.22), dy1 + rnd(4, 16)],
    ]
    geo.decos = decoArr.map((ch, i) => ({
      ch, x: dspots[i % dspots.length][0], y: dspots[i % dspots.length][1],
      size: Math.round(fs * rnd(0.4, 0.52)), rot: rnd(-0.25, 0.25),
    }))
  }
  if (scene.arrow) {
    const acx = (bubbleBox[0] + bubbleBox[2]) / 2
    const acy = (bubbleBox[1] + bubbleBox[3]) / 2
    const bw = bubbleBox[2] - bubbleBox[0], bh = bubbleBox[3] - bubbleBox[1]
    const tgt = scene.arrowTarget
    if (Array.isArray(tgt) && tgt.length === 2) {
      const ex = W * Number(tgt[0]), ey = H * Number(tgt[1])
      const dx = ex - acx, dy = ey - acy
      const d = Math.max(1, Math.hypot(dx, dy))
      geo.arrow = [[acx + (dx / d) * (bw / 2 + 16), acy + (dy / d) * (bh / 2 + 16)], [ex, ey]]
    } else {
      const [vx, vy] = ARROW_VEC[scene.arrowDir] || ARROW_VEC.down
      const s = [acx + vx * (bw / 2 + 16), acy + vy * (bh / 2 + 16)]
      geo.arrow = [s, [s[0] + vx * 150 + rnd(-30, 30), s[1] + vy * 150 + rnd(-20, 20)]]
    }
    geo.arrowBend = [rnd(-45, 45), rnd(-30, 30)]
  }

  const paint = (col, lineW) => {
    if (geo.bubblePts) {
      smoothClosed(geo.bubblePts)
      ctx.strokeStyle = col; ctx.lineWidth = lineW; ctx.lineJoin = 'round'
      ctx.stroke()
      if (geo.tailDir) cloudTailPts(bubbleBox, geo.tailDir).forEach(([px, py, r]) => {
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.strokeStyle = col; ctx.lineWidth = lineW * 0.85; ctx.stroke()
      })
    }
    ctx.font = fontStr(fs)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = col
    for (let i = 0; i < lines.length; i++) {
      const L = geo.lines[i]
      ctx.save()
      ctx.translate(bcx + L.dx, L.ty)
      ctx.rotate(L.rot)
      ctx.fillText(lines[i], 0, 0)
      ctx.restore()
    }
    if (scene.underline) {
      wavyUnderline(left + padX * 0.3, left + boxW - padX * 0.3, geo.uy, col, lineW, geo.wavePh)
      ticksAt(left + boxW * 0.28, top + padY - fs * 0.32, fs * 0.42, col, lineW, geo.tickLean)
    }
    geo.decos.forEach((d) => drawDecoAt(d, col, lineW))
    if (geo.arrow) arrowBent(geo.arrow[0], geo.arrow[1], geo.arrowBend, col, lineW)
  }

  if (strong) {
    const gx = bcx, gy = top + boxH / 2
    const gr = Math.hypot(boxW, boxH) * 0.62
    const g = ctx.createRadialGradient(gx, gy, gr * 0.15, gx, gy, gr)
    g.addColorStop(0, 'rgba(0,0,0,0.26)')
    g.addColorStop(0.55, 'rgba(0,0,0,0.13)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2)
  }

  // 다크 헤일로 (블러 섀도우 여러 겹) → 깨끗한 컬러
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = fs * 0.02
  const layers = strong ? [[fs * 0.30, 2], [fs * 0.15, 2]] : [[fs * 0.22, 1], [fs * 0.11, 1]]
  for (const [blur, n] of layers) {
    ctx.shadowBlur = blur
    for (let k = 0; k < n; k++) paint('rgba(0,0,0,0.92)', penW)
  }
  ctx.restore()

  ctx.save()
  ctx.shadowColor = strong ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.26)'
  ctx.shadowBlur = fs * 0.1
  ctx.shadowOffsetY = fs * 0.03
  paint(color, penW)
  ctx.restore()
}
