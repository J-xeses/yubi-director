'use client'

import { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { drawAnnotationPreview } from '../lib/handwriting-preview'

const SOURCE_TAGS = [
  '시술 전 사진/영상', '시술 중 클로즈업', '시술 후 결과', '고객 반응',
  '거울 확인 장면', '손/도구 클로즈업', 'Before/After 사진', '유비 설명 셀카',
  '스톡 B-roll(검색)',
]
const TREATMENT_TAGS = ['이마라인 교정', '눈썹 반영구', '복합 시술', '상담/설명', '기타']
const MOOD_TAGS = ['감동적/진솔한', '전문적/신뢰감', '밝고 활기찬', '교육적/정보형', '친근한/일상적']
const LENGTH_TAGS = [
  { key: 'short', label: '짧게 · 임팩트 (15~20초)' },
  { key: 'standard', label: '표준 (20~30초)' },
]
const EFFECT_LABELS = {
  'static': '고정',
  'zoom-in': '줌인',
  'zoom-out': '줌아웃',
  'slow-mo': '슬로우모션',
}
const ANN_POS_LABELS = {
  top_center: '상단 중앙', top_left: '상단 왼쪽', top_right: '상단 오른쪽',
  center: '중앙', bottom_center: '하단 중앙', bottom_left: '하단 왼쪽', bottom_right: '하단 오른쪽',
}
const ANN_BUBBLE_LABELS = {
  none: '말풍선 없음', cloud: '구름 말풍선', oval: '동그란 말풍선', arrow_box: '각진 말풍선',
}
const ANN_COLOR_LABELS = { white: '흰색', pink: '핑크', lavender: '라벤더' }
const ANN_ARROW_DIR_LABELS = { up: '위', down: '아래', left: '왼쪽', right: '오른쪽' }

// 표현 유형 프리셋 — 하나 고르면 말풍선/색/장식/화살표가 한 번에 세팅되고,
// 이후 각 항목을 사람이 미세 조정할 수 있다. (text/시간/위치는 유지)
const ANNOTATION_PRESETS = [
  { key: 'custom', label: '직접 설정', hint: '아래 항목을 자유롭게', config: null },
  { key: 'question', label: '질문 던지기', hint: '구름 말풍선 · 흰색 · ✦', config: { bubble: 'cloud', color: 'white', deco: ['✦'], arrow: false } },
  { key: 'highlight', label: '핵심 강조', hint: '동그라미 · 핑크 · 아래 화살표', config: { bubble: 'oval', color: 'pink', deco: [], arrow: true, arrowDir: 'down' } },
  { key: 'point', label: '콕 집어 지목', hint: '각진 말풍선 · 라벤더 · 옆 화살표', config: { bubble: 'arrow_box', color: 'lavender', deco: [], arrow: true, arrowDir: 'left' } },
  { key: 'emotion', label: '감성 한마디', hint: '구름 말풍선 · 라벤더 · ♡', config: { bubble: 'cloud', color: 'lavender', deco: ['♡'], arrow: false } },
  { key: 'cta', label: '마무리 CTA', hint: '각진 말풍선 · 핑크 · 위 화살표', config: { bubble: 'arrow_box', color: 'pink', deco: ['✦'], arrow: true, arrowDir: 'up' } },
  { key: 'minimal', label: '미니멀', hint: '말풍선 없이 글씨만', config: { bubble: 'none', color: 'white', deco: [] } },
]
const PRESET_BY_KEY = Object.fromEntries(ANNOTATION_PRESETS.map((p) => [p.key, p]))

// AI가 준 주석이 어떤 표현 유형과 일치하는지 추정 (편집기 드롭다운 초기값용)
function inferPreset(a) {
  for (const p of ANNOTATION_PRESETS) {
    if (!p.config) continue
    const c = p.config
    const decoEq = (c.deco || []).join(',') === (a.deco || []).join(',')
    if (c.bubble === a.bubble && c.color === a.color && decoEq
      && !!c.arrow === !!a.arrow
      && (!c.arrow || c.arrowDir === a.arrowDir)) return p.key
  }
  return 'custom'
}

function blankAnnotation(totalDuration) {
  const mid = Math.max(1, Math.round((Number(totalDuration) || 12) / 2))
  return {
    text: '', start: Math.max(0, mid - 1), end: mid + 2,
    position: 'top_center', bubble: 'cloud', color: 'white',
    deco: [], arrow: false, arrowDir: 'down', backing: true, _preset: 'custom',
  }
}
const BGM_LABELS = {
  'calm-piano': '잔잔한 피아노 (Emotional Piano · MondaMusic)',
  'upbeat-reel': '밝고 경쾌한 릴스 비트 (Instagram Reel · SoundSurfer)',
  'trust-corporate': '차분하고 신뢰감 있는 톤 (Trusted Coverage · JoyInSound)',
}

const annFieldStyle = {
  background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 12, padding: '5px 8px',
}
const annLabelStyle = { fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }

// 영상 URL에서 지정 시각의 프레임을 뽑아 dataURL로 (Vercel Blob은 CORS 개방)
function useVideoFrame(url, time, w = 132, h = 234) {
  const [dataUrl, setDataUrl] = useState(null)
  useEffect(() => {
    setDataUrl(null)
    if (!url || typeof document === 'undefined') return
    let cancelled = false
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.preload = 'metadata'
    v.playsInline = true
    const cleanup = () => { v.removeAttribute('src'); v.load() }
    const capture = () => {
      if (cancelled) return
      try {
        const cv = document.createElement('canvas')
        cv.width = w; cv.height = h
        const ctx = cv.getContext('2d')
        const vr = v.videoWidth / v.videoHeight, cr = w / h
        let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0
        if (vr > cr) { sw = sh * cr; sx = (v.videoWidth - sw) / 2 }
        else { sh = sw / cr; sy = (v.videoHeight - sh) / 2 }
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h)
        if (!cancelled) setDataUrl(cv.toDataURL('image/jpeg', 0.72))
      } catch { if (!cancelled) setDataUrl(null) }
      cleanup()
    }
    v.addEventListener('loadeddata', () => {
      try { v.currentTime = Math.min(Math.max(0, time || 0), (v.duration || 1) - 0.05) } catch { capture() }
    })
    v.addEventListener('seeked', capture)
    v.addEventListener('error', () => { if (!cancelled) setDataUrl(null); cleanup() })
    v.src = url
    return () => { cancelled = true; cleanup() }
  }, [url, time, w, h])
  return dataUrl
}

// 영상 URL을 정지 프레임(포스터)으로 보여준다 — <video>는 브라우저마다 첫 프레임을
// 안 그리는 경우가 있어 canvas 캡처를 쓴다.
function VideoPoster({ url, time = 1, style, className, onClick }) {
  const frame = useVideoFrame(url, time, 180, 320)
  if (frame) {
    return <img src={frame} alt="" className={className} style={style} onClick={onClick} />
  }
  return (
    <div className={className} onClick={onClick}
      style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#fff' }}>
      ▶
    </div>
  )
}

// 검토 화면 — 각 컷의 대표 프레임 썸네일
function ShotThumb({ clip, trimStart }) {
  const isImg = !!clip?.isImage
  const imgSrc = clip?.previewUrl || clip?.url || null
  const frame = useVideoFrame(isImg ? null : (clip?.url || null), trimStart, 132, 234)
  const box = {
    width: 44, height: 78, borderRadius: 6, flexShrink: 0, objectFit: 'cover',
    background: 'var(--surface2)', border: '1px solid var(--border)',
  }
  if (isImg && imgSrc) return <img src={imgSrc} alt="" style={box} />
  if (frame) return <img src={frame} alt="" style={box} />
  return <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎬</div>
}

// 업로드/스톡 소스 클립의 작은 미리보기 (목록에서 어떤 소스인지 눈으로 확인)
function ClipThumb({ clip }) {
  const box = {
    width: 48, height: 48, borderRadius: 8, flexShrink: 0, objectFit: 'cover',
    background: 'var(--surface2)', border: '1px solid var(--border)',
  }
  if (!clip.previewUrl) {
    return <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{clip.isImage ? '🖼️' : '🎬'}</div>
  }
  if (clip.isImage) {
    return <img src={clip.previewUrl} alt="" style={box} />
  }
  return <VideoPoster url={clip.previewUrl} time={0.2} style={box} />
}

// 손글씨 주석 실시간 미리보기 — lib/handwriting-preview.js(브라우저 canvas)로 그린다.
function AnnotationPreview({ scene }) {
  const ref = useRef(null)
  const key = JSON.stringify({
    t: scene.text || '', b: scene.bubble, c: scene.color,
    d: scene.deco, p: scene.position, a: scene.arrow, ad: scene.arrowDir,
    bk: scene.backing, x: scene.x, y: scene.y, fs: scene.fontSize, at: scene.arrowTarget,
  })
  useEffect(() => {
    let cancelled = false
    const paint = () => { if (!cancelled && ref.current) drawAnnotationPreview(ref.current, scene) }
    paint()
    // 웹폰트가 늦게 로드되면 한 번 더 그린다
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('64px "Nanum Pen Script"'),
        document.fonts.load('64px "Noto Sans KR"'),
      ]).then(paint).catch(() => {})
    }
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <canvas
      ref={ref}
      width={150}
      height={267}
      style={{
        width: 150, height: 267, borderRadius: 8, flexShrink: 0,
        border: '1px solid var(--border)', background: '#777',
      }}
    />
  )
}

// 손글씨 주석 편집기 — 표현 유형(프리셋)으로 1차 선택 후 각 항목을 미세 조정.
function AnnotationEditor({ annotations, totalDuration, onChange }) {
  const list = Array.isArray(annotations) ? annotations : []

  const update = (i, patch) =>
    onChange(list.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))

  const applyPreset = (i, key) => {
    const preset = PRESET_BY_KEY[key]
    if (!preset || !preset.config) return update(i, { _preset: key })
    update(i, { ...preset.config, _preset: key })
  }

  const add = () => onChange([...list, blankAnnotation(totalDuration)].slice(0, 8))
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i))

  return (
    <div className="dir-section">
      <div className="dir-sec-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>손글씨 주석 ({list.length}개)</span>
        {list.length < 8 && (
          <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={add}>+ 추가</button>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
        표현 유형을 고른 뒤, 필요하면 아래 항목을 직접 조정하세요. 문구를 비우면 제작 시 제외됩니다.
      </div>

      {list.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          손글씨 주석이 없어요. &quot;+ 추가&quot;로 넣을 수 있어요.
        </div>
      )}

      {list.map((a, i) => (
        <div key={i} className="caption-box" style={{ marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="text"
              value={a.text || ''}
              placeholder="손글씨 문구 (짧고 강하게, 최대 12자 권장)"
              onChange={(e) => update(i, { text: e.target.value })}
              style={{ ...annFieldStyle, flex: 1, fontSize: 13 }}
            />
            <button className="btn-reset" style={{ padding: '5px 10px' }} onClick={() => remove(i)}>✕</button>
          </div>

          <div>
            <label style={annLabelStyle}>표현 유형</label>
            <select
              value={a._preset || 'custom'}
              onChange={(e) => applyPreset(i, e.target.value)}
              style={{ ...annFieldStyle, width: '100%' }}
            >
              {ANNOTATION_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label} — {p.hint}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label style={annLabelStyle}>시작(초)</label>
              <input type="number" step="0.5" min="0" max={totalDuration || undefined}
                value={a.start ?? 0}
                onChange={(e) => update(i, { start: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...annFieldStyle, width: '100%' }} />
            </div>
            <div>
              <label style={annLabelStyle}>끝(초)</label>
              <input type="number" step="0.5" min="0" max={totalDuration || undefined}
                value={a.end ?? 0}
                onChange={(e) => update(i, { end: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...annFieldStyle, width: '100%' }} />
            </div>
            <div>
              <label style={annLabelStyle}>위치</label>
              <select value={a.position || 'top_center'}
                onChange={(e) => update(i, { position: e.target.value })}
                style={{ ...annFieldStyle, width: '100%' }}>
                {Object.entries(ANN_POS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={annLabelStyle}>말풍선</label>
              <select value={a.bubble || 'cloud'}
                onChange={(e) => update(i, { bubble: e.target.value, _preset: 'custom' })}
                style={{ ...annFieldStyle, width: '100%' }}>
                {Object.entries(ANN_BUBBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={annLabelStyle}>색</label>
              <select value={a.color || 'white'}
                onChange={(e) => update(i, { color: e.target.value, _preset: 'custom' })}
                style={{ ...annFieldStyle, width: '100%' }}>
                {Object.entries(ANN_COLOR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={annLabelStyle}>장식 글자 (쉼표로 구분: ♡, ✦, !, ?)</label>
              <input type="text"
                value={(a.deco || []).join(', ')}
                placeholder="예: ♡, ✦"
                onChange={(e) => update(i, {
                  deco: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
                  _preset: 'custom',
                })}
                style={{ ...annFieldStyle, width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text)' }}>
                <input type="checkbox" checked={!!a.arrow}
                  onChange={(e) => update(i, { arrow: e.target.checked, _preset: 'custom' })} />
                화살표
              </label>
              {a.arrow && (
                <select value={a.arrowDir || 'down'}
                  onChange={(e) => update(i, { arrowDir: e.target.value, _preset: 'custom' })}
                  style={{ ...annFieldStyle, flex: 1 }}>
                  {Object.entries(ANN_ARROW_DIR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 8, alignItems: 'end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text)', paddingBottom: 5 }}>
              <input type="checkbox" checked={a.backing !== false}
                onChange={(e) => update(i, { backing: e.target.checked })} />
              배경 판
            </label>
            <div>
              <label style={annLabelStyle}>가로 % (선택 · 비우면 위치 자동)</label>
              <input type="number" min="0" max="100" placeholder="—"
                value={a.x != null ? Math.round(a.x * 100) : ''}
                onChange={(e) => {
                  const v = e.target.value
                  update(i, v === '' ? { x: undefined } : { x: Math.max(0, Math.min(1, Number(v) / 100)) })
                }}
                style={{ ...annFieldStyle, width: '100%' }} />
            </div>
            <div>
              <label style={annLabelStyle}>세로 %</label>
              <input type="number" min="0" max="100" placeholder="—"
                value={a.y != null ? Math.round(a.y * 100) : ''}
                onChange={(e) => {
                  const v = e.target.value
                  update(i, v === '' ? { y: undefined } : { y: Math.max(0, Math.min(1, Number(v) / 100)) })
                }}
                style={{ ...annFieldStyle, width: '100%' }} />
            </div>
          </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            <AnnotationPreview scene={a} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>미리보기</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// 편집 계획 상세 — 제작 전 검토 화면과 완성 후 결과 화면에서 공용으로 쓴다.
// onAnnotationsChange가 주어지면 손글씨 주석 부분이 편집 가능해진다(검토 화면).
function PlanDetails({ plan, bgm, onAnnotationsChange }) {
  const anns = Array.isArray(plan.annotations) ? plan.annotations : []
  return (
    <>
      <div className="dir-section" style={{ marginTop: 16 }}>
        <div className="dir-sec-label">
          샷 구성 ({plan.shots.length}컷 · 총 {Number(plan.totalDuration || 0).toFixed(1)}초)
        </div>
        <div className="dir-steps">
          {plan.shots.map((s, i) => {
            const clip = (plan._clips || [])[s.clipIndex]
            return (
              <div className="dir-step" key={i} style={{ alignItems: 'center' }}>
                <div className="dir-step-no">{i + 1}</div>
                {clip && <ShotThumb clip={clip} trimStart={s.trimStart} />}
                <div className="dir-step-text">
                  {s.duration.toFixed(1)}초 · {EFFECT_LABELS[s.effect] || s.effect}
                  {clip && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {' '}· {clip.source === 'stock' ? 'Pexels' : (clip.label || '소스')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="dir-section">
        <div className="dir-sec-label">자막 ({plan.captions.length})</div>
        {plan.captions.map((c, i) => (
          <div className="caption-box" style={{ marginBottom: 8 }} key={i}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
              {c.start.toFixed(1)}s ~ {c.end.toFixed(1)}s
            </div>
            <div className="caption-line">&quot;{c.text}&quot;</div>
          </div>
        ))}
      </div>
      {onAnnotationsChange ? (
        <AnnotationEditor
          annotations={anns}
          totalDuration={plan.totalDuration}
          onChange={onAnnotationsChange}
        />
      ) : anns.filter((a) => String(a.text || '').trim()).length > 0 && (
        <div className="dir-section">
          <div className="dir-sec-label">
            손글씨 주석 ({anns.filter((a) => String(a.text || '').trim()).length}개)
          </div>
          {anns.filter((a) => String(a.text || '').trim()).map((a, i) => (
            <div className="caption-box" style={{ marginBottom: 8 }} key={i}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                {Number(a.start).toFixed(1)}s ~ {Number(a.end).toFixed(1)}s · {ANN_POS_LABELS[a.position] || a.position} · {ANN_BUBBLE_LABELS[a.bubble] || a.bubble}
                {a.arrow ? ` · 화살표(${ANN_ARROW_DIR_LABELS[a.arrowDir] || a.arrowDir})` : ''}
                {a.deco && a.deco.length ? ` · ${a.deco.join(' ')}` : ''}
              </div>
              <div className="caption-line">✍ &quot;{a.text}&quot;</div>
            </div>
          ))}
        </div>
      )}
      <div className="dir-section">
        <div className="dir-sec-label">BGM</div>
        <div className="dir-step">
          <div className="dir-step-no">♪</div>
          <div className="dir-step-text">
            {bgm?.url ? `직접 업로드한 파일: ${bgm.file.name}` : (BGM_LABELS[plan.bgmKey] || '없음 (원본 소리만)')}
          </div>
        </div>
      </div>
    </>
  )
}

function StepDot({ n, current }) {
  const done = n < current
  const active = n === current
  return (
    <div className="step-item">
      <div className={`step-dot${active ? ' active' : ''}${done ? ' done' : ''}`}>
        {done ? '✓' : n}
      </div>
      <span className={`step-label${active ? ' active' : ''}`}>
        {n === 1 ? '소스 입력' : n === 2 ? '연출 선택' : '완성'}
      </span>
    </div>
  )
}

function probeVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    let done = false
    // metadata 로드가 끝나지 않는 코덱/환경(예: HEVC 미지원, 백그라운드 탭 미디어
    // 로딩 중단)에서 onloadedmetadata·onerror 둘 다 안 불리면 업로드가 영영 시작
    // 안 되고 "업로드 중..."에 멈춘다 — 타임아웃으로 무조건 매듭짓는다.
    const finish = (dur) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      resolve(dur)
    }
    v.preload = 'metadata'
    v.onloadedmetadata = () => finish(v.duration || null)
    v.onerror = () => finish(null)
    setTimeout(() => finish(null), 8000)
    v.src = url
  })
}

let nextClipId = 1

export default function Page() {
  const [step, setStep] = useState(1)
  const [sourceText, setSourceText] = useState('')
  const [sourceTags, setSourceTags] = useState([])
  const [treatment, setTreatment] = useState('')
  const [mood, setMood] = useState('')
  const [targetLength, setTargetLength] = useState('standard')

  // 업로드된 소스 클립: { id, file, label, isImage, duration, url, status }
  // 스톡 검색으로 추가된 클립은 file 없이 { id, label, isImage, duration, url,
  // status:'done', source:'stock', photographer }로 같은 배열에 들어간다 —
  // generatePlan()은 소스 구분 없이 clips 배열을 그대로 사용하므로 별도 처리 불필요.
  const [clips, setClips] = useState([])
  const [bgm, setBgm] = useState(null) // { file, url, status }

  const [stockQuery, setStockQuery] = useState('')
  const [stockResults, setStockResults] = useState([])
  const [stockSearching, setStockSearching] = useState(false)
  const [stockError, setStockError] = useState('')
  const [stockType, setStockType] = useState('video') // 'video'=B-roll, 'image'=분위기 참고
  const [lightbox, setLightbox] = useState(null) // 크게 보기: { src, link }

  const [loadingProposals, setLoadingProposals] = useState(false)
  const [proposals, setProposals] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(null)

  const [loadingDirective, setLoadingDirective] = useState(false)
  const [directive, setDirective] = useState(null)
  // 제작 전 검토 게이트: /api/edit-plan 결과를 plan에 담아 사용자에게 보여주고,
  // "이대로 제작"을 눌러야 /api/render로 넘어간다. plan._clips는 그 계획을 만들 때
  // 쓴 업로드 클립 스냅샷(렌더가 같은 url을 참조하도록).
  const [plan, setPlan] = useState(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [renderResult, setRenderResult] = useState(null)
  const [renderStage, setRenderStage] = useState('')
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // 지난 제작물 (참고/재활용)
  const [pastOpen, setPastOpen] = useState(false)
  const [pastRenders, setPastRenders] = useState(null) // null=미로드, []=없음

  async function togglePast() {
    const next = !pastOpen
    setPastOpen(next)
    if (next && pastRenders === null) {
      try {
        const res = await fetch('/api/recent-renders')
        const data = await res.json()
        setPastRenders(Array.isArray(data.items) ? data.items : [])
      } catch {
        setPastRenders([])
      }
    }
  }

  function toggleSourceTag(tag) {
    setSourceTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  async function handleFilesSelected(fileList) {
    const files = Array.from(fileList)
    const entries = files.map((file) => ({
      id: nextClipId++,
      file,
      label: SOURCE_TAGS[0],
      isImage: file.type.startsWith('image/'),
      duration: file.type.startsWith('image/') ? 2.5 : null,
      url: null,
      // 업로드한 원본을 목록에서 바로 미리보게 (로컬 objectURL, 제거 시 revoke)
      previewUrl: typeof URL !== 'undefined' ? URL.createObjectURL(file) : null,
      status: 'uploading',
    }))
    setClips((prev) => [...prev, ...entries])

    for (const entry of entries) {
      try {
        if (!entry.isImage) {
          const dur = await probeVideoDuration(entry.file)
          setClips((prev) => prev.map((c) => (c.id === entry.id ? { ...c, duration: dur } : c)))
        }
        const blob = await upload(entry.file.name, entry.file, {
          access: 'public',
          handleUploadUrl: '/api/blob-upload',
        })
        setClips((prev) => prev.map((c) => (c.id === entry.id ? { ...c, url: blob.url, status: 'done' } : c)))
      } catch (e) {
        setClips((prev) => prev.map((c) => (c.id === entry.id ? { ...c, status: 'error' } : c)))
      }
    }
  }

  async function handleBgmSelected(file) {
    if (!file) return
    setBgm({ file, url: null, status: 'uploading' })
    try {
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob-upload' })
      setBgm({ file, url: blob.url, status: 'done' })
    } catch {
      setBgm({ file, url: null, status: 'error' })
    }
  }

  function updateClipLabel(id, label) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)))
  }

  async function searchStock() {
    if (!stockQuery.trim()) return
    setStockSearching(true)
    setStockError('')
    try {
      const res = await fetch(`/api/source-search?q=${encodeURIComponent(stockQuery.trim())}&type=${stockType}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '검색 실패')
      setStockResults(data.results || [])
    } catch (e) {
      setStockError(e.message)
      setStockResults([])
    } finally {
      setStockSearching(false)
    }
  }

  function addStockClip(result) {
    setClips((prev) => [...prev, {
      id: nextClipId++,
      label: '스톡 B-roll(검색)',
      isImage: result.type === 'image',
      duration: result.duration || 3,
      url: result.downloadUrl,
      previewUrl: result.thumbnail || result.downloadUrl,
      status: 'done',
      source: 'stock',
      photographer: result.photographer,
    }])
  }

  function removeClip(id) {
    setClips((prev) => {
      const gone = prev.find((c) => c.id === id)
      if (gone?.previewUrl && gone.file && typeof URL !== 'undefined') {
        try { URL.revokeObjectURL(gone.previewUrl) } catch {}
      }
      return prev.filter((c) => c.id !== id)
    })
  }

  async function generateProposals() {
    if (!sourceText.trim() && sourceTags.length === 0) {
      alert('영상 소스를 설명해주세요!')
      return
    }
    setError('')
    setLoadingProposals(true)
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: sourceText.trim(),
          sourceTags: sourceTags.join(', '),
          treatment,
          mood,
          targetLength,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '알 수 없는 오류')
      setProposals(data.proposals)
      setStep(2)
    } catch (e) {
      setError(`연출 제안 생성 실패: ${e.message}`)
    } finally {
      setLoadingProposals(false)
    }
  }

  async function generateDirective() {
    if (selectedIndex === null) return
    const proposal = proposals[selectedIndex]
    setError('')
    setStep(3)
    setLoadingDirective(true)
    try {
      const res = await fetch('/api/directive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal,
          sourceText: sourceText.trim(),
          sourceTags: sourceTags.join(', '),
          treatment,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '알 수 없는 오류')
      setDirective(data)
    } catch (e) {
      setError(`편집 지시서 생성 실패: ${e.message}`)
    } finally {
      setLoadingDirective(false)
    }
  }

  // 1단계: AI 편집 계획만 생성 → plan에 담아 검토 화면을 띄운다. (아직 렌더 안 함)
  async function generatePlan() {
    if (selectedIndex === null) return
    const proposal = proposals[selectedIndex]
    const readyClips = clips.filter((c) => c.status === 'done' && c.url)
    if (readyClips.length === 0) {
      alert('업로드가 아직 끝나지 않았어요. 잠시 후 다시 시도해주세요.')
      return
    }
    setError('')
    setStep(3)
    setRenderResult(null)
    setPlan(null)
    setPlanLoading(true)
    try {
      const planRes = await fetch('/api/edit-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal,
          sourceText: sourceText.trim(),
          treatment,
          targetLength,
          clips: readyClips.map((c) => ({ label: c.label, duration: c.duration })),
        }),
      })
      const data = await planRes.json()
      if (!planRes.ok) throw new Error(data.error || '편집 계획 생성 실패')
      const annotations = (Array.isArray(data.annotations) ? data.annotations : [])
        .map((a) => ({ ...a, _preset: inferPreset(a) }))
      setPlan({ ...data, annotations, _clips: readyClips })
    } catch (e) {
      setError(`편집 계획 생성 실패: ${e.message}`)
    } finally {
      setPlanLoading(false)
    }
  }

  // 2단계: 검토한 plan을 그대로 렌더로 넘긴다. ("이대로 제작" 클릭 시)
  // 검토 화면에서 사용자가 손글씨 주석을 편집하면 plan을 갱신한다.
  function setAnnotations(next) {
    setPlan((p) => (p ? { ...p, annotations: next } : p))
  }

  async function runRender() {
    if (!plan) return
    const readyClips = plan._clips || clips.filter((c) => c.status === 'done' && c.url)
    setError('')
    setRendering(true)
    setRenderResult(null)
    try {
      setRenderStage('영상 합성 중... (최대 1~2분 걸려요)')
      const renderShots = plan.shots.map((s) => ({
        url: readyClips[s.clipIndex].url,
        trimStart: s.trimStart,
        duration: s.duration,
        effect: s.effect,
      }))
      // 편집기 내부용 _preset 키는 제거하고 문구 있는 것만 전송
      const cleanAnns = (plan.annotations || [])
        .filter((a) => String(a.text || '').trim())
        .map(({ _preset, ...a }) => a)
      const renderRes = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shots: renderShots,
          captions: plan.captions,
          annotations: cleanAnns,
          bgmUrl: bgm?.url || null,
          bgmKey: bgm?.url ? null : plan.bgmKey,
          totalDuration: plan.totalDuration,
          colorGrade: plan.colorGrade,
        }),
      })
      const rendered = await renderRes.json()
      if (!renderRes.ok) throw new Error(rendered.error || '영상 합성 실패')

      setRenderResult({ url: rendered.url, posterUrl: rendered.posterUrl || null, plan })
    } catch (e) {
      setError(`영상 합성 실패: ${e.message}`)
    } finally {
      setRendering(false)
      setRenderStage('')
    }
  }

  function directiveText() {
    if (!directive) return ''
    return (
      `[${directive.title}] 완성 길이: ${directive.totalDuration}\n\n` +
      directive.editSteps.map((s, i) => `${i + 1}. ${s.step}\n${s.detail}`).join('\n\n') +
      '\n\n[자막]\n' + directive.captions.map((c) => `${c.time}: "${c.text}"`).join('\n') +
      `\n\nBGM: ${directive.bgmSuggestion}\n\n팁: ${directive.finalTip}`
    )
  }

  async function copyDirective() {
    try {
      await navigator.clipboard.writeText(directiveText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('복사 실패 — 직접 선택해서 복사해주세요.')
    }
  }

  function restart() {
    setStep(1)
    setSourceText('')
    setSourceTags([])
    setTreatment('')
    setMood('')
    setTargetLength('standard')
    setClips([])
    setBgm(null)
    setProposals([])
    setSelectedIndex(null)
    setDirective(null)
    setPlan(null)
    setPlanLoading(false)
    setRenderResult(null)
    setError('')
    setStockResults([])
    setLightbox(null)
  }

  const hasClips = clips.some((c) => c.status === 'done')

  return (
    <>
      <div className="header">
        <div className="header-mark">✦</div>
        <div>
          <div className="header-title">유비 디렉터</div>
          <div className="header-sub">영상 소스 업로드 → 릴스 연출 제안 → 자동 편집</div>
        </div>
      </div>

      <div className="main">
        <div className="steps">
          <StepDot n={1} current={step} />
          <div className="step-line" />
          <StepDot n={2} current={step} />
          <div className="step-line" />
          <StepDot n={3} current={step} />
        </div>

        {step === 1 && (
          <div>
            <div className="section">
              <div className="sec-eyebrow">Step 1</div>
              <div className="sec-title">오늘 어떤 영상 찍었어요?</div>
              <div className="sec-desc">촬영한 것들을 편하게 설명해주세요. 영상/사진을 올리면 자동으로 편집까지 해드려요.</div>
            </div>

            <div className="input-wrap" style={{ marginBottom: 16 }}>
              <textarea
                className="source-textarea"
                placeholder="예시: 오늘 이마라인 시술하는데 클로즈업으로 찍었어요. 시술 전 사진이랑 끝나고 바로 찍은 영상도 있고, 고객분이 거울 보면서 좋아하는 거 잠깐 찍었어요."
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
              />
              <div className="input-footer">
                <span className="char-count">{sourceText.length}자</span>
              </div>
            </div>

            <div className="tag-group">
              <div className="tag-label">영상/사진 파일 업로드 (선택 — 올리면 자동 편집까지 해드려요)</div>
              <input
                type="file"
                accept="video/*,image/*"
                multiple
                onChange={(e) => handleFilesSelected(e.target.files)}
                style={{ color: 'var(--text-sub)', fontSize: 13 }}
              />
              {clips.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {clips.map((c) => (
                    <div key={c.id} className="dir-step" style={{ alignItems: 'center' }}>
                      <ClipThumb clip={c} />
                      <div style={{ flex: 1, fontSize: 13, color: 'var(--text)', minWidth: 0 }}>
                        <span style={{ wordBreak: 'break-all' }}>
                          {c.source === 'stock' ? `Pexels · ${c.photographer || '스톡 영상'}` : c.file.name}
                        </span>
                        {c.status === 'uploading' && <span style={{ color: 'var(--text-muted)' }}> · 업로드 중...</span>}
                        {c.status === 'error' && <span style={{ color: 'var(--rose)' }}> · 업로드 실패</span>}
                        {c.status === 'done' && !c.isImage && c.duration && (
                          <span style={{ color: 'var(--text-muted)' }}> · {c.duration.toFixed(1)}초</span>
                        )}
                      </div>
                      <select
                        value={c.label}
                        onChange={(e) => updateClipLabel(c.id, e.target.value)}
                        style={{
                          background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)',
                          borderRadius: 8, fontSize: 12, padding: '4px 8px',
                        }}
                      >
                        {SOURCE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button className="btn-reset" style={{ padding: '4px 10px' }} onClick={() => removeClip(c.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="tag-group">
              <div className="tag-label">추가 소스 검색 (B-roll 채우기 · 분위기 참고)</div>
              <div className="tags" style={{ marginBottom: 8 }}>
                <button className={`tag${stockType === 'video' ? ' on' : ''}`}
                  onClick={() => { setStockType('video'); setStockResults([]) }}>영상 (B-roll)</button>
                <button className={`tag${stockType === 'image' ? ' on' : ''}`}
                  onClick={() => { setStockType('image'); setStockResults([]) }}>사진 (분위기 참고)</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="예: skincare closeup, eyebrow makeup"
                  value={stockQuery}
                  onChange={(e) => setStockQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchStock()}
                  style={{
                    flex: 1, background: 'var(--surface2)', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, padding: '8px 10px',
                  }}
                />
                <button className="btn-secondary" onClick={searchStock} disabled={stockSearching}>
                  {stockSearching ? '검색 중...' : '검색'}
                </button>
              </div>
              {stockError && <div className="error-box" style={{ marginTop: 8 }}>{stockError}</div>}
              {stockResults.length > 0 && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: 8, marginTop: 12,
                }}>
                  {stockResults.map((r) => (
                    <div key={r.id} style={{ position: 'relative' }}>
                      <img
                        src={r.thumbnail}
                        alt={r.title}
                        onClick={() => setLightbox({ src: r.downloadUrl && r.type === 'image' ? r.downloadUrl : r.thumbnail, link: r.pexelsUrl })}
                        style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in' }}
                      />
                      <button
                        className="btn-primary"
                        style={{ position: 'absolute', bottom: 6, left: 6, right: 6, padding: '4px 0', fontSize: 12 }}
                        onClick={() => addStockClip(r)}
                      >
                        {stockType === 'image' ? '+ 소스로 추가' : '+ 추가'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {stockType === 'image' && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  썸네일을 누르면 크게 볼 수 있어요. 참고만 하고 안 넣어도 됩니다.
                </div>
              )}
            </div>

            {clips.length > 0 && (
              <div className="tag-group">
                <div className="tag-label">BGM 파일 (선택 — 안 올리면 분위기에 맞는 무료 음원을 자동으로 넣어드려요)</div>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => handleBgmSelected(e.target.files[0])}
                  style={{ color: 'var(--text-sub)', fontSize: 13 }}
                />
                {bgm && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    {bgm.file.name} {bgm.status === 'uploading' ? '· 업로드 중...' : bgm.status === 'done' ? '· 완료' : '· 실패'}
                  </div>
                )}
              </div>
            )}

            <div className="tag-group">
              <div className="tag-label">어떤 소스가 있나요? (복수 선택)</div>
              <div className="tags">
                {SOURCE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={`tag${sourceTags.includes(tag) ? ' on' : ''}`}
                    onClick={() => toggleSourceTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="tag-group">
              <div className="tag-label">시술 종류</div>
              <div className="tags">
                {TREATMENT_TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={`tag${treatment === tag ? ' on' : ''}`}
                    onClick={() => setTreatment(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="tag-group">
              <div className="tag-label">이번 릴스 분위기는?</div>
              <div className="tags">
                {MOOD_TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={`tag${mood === tag ? ' on' : ''}`}
                    onClick={() => setMood(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="tag-group" style={{ marginBottom: 24 }}>
              <div className="tag-label">영상 길이</div>
              <div className="tags">
                {LENGTH_TAGS.map((opt) => (
                  <button
                    key={opt.key}
                    className={`tag${targetLength === opt.key ? ' on' : ''}`}
                    onClick={() => setTargetLength(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-primary" onClick={generateProposals} disabled={loadingProposals}>
              연출 제안 받기 →
            </button>

            {error && <div className="error-box">{error}</div>}

            <div className="tip-box">
              <strong>💡 팁:</strong> 완벽하게 설명 안 해도 돼요. &quot;클로즈업 찍었는데 흔들렸어요&quot; 같은 것도 OK — 그것도 연출에 반영해드려요.
            </div>

            <div className="tag-group" style={{ marginTop: 20 }}>
              <button
                className="btn-secondary"
                onClick={togglePast}
                style={{ width: '100%' }}
              >
                {pastOpen ? '▲ 지난 제작물 닫기' : '▼ 지난 제작물 보기 (참고 / 재활용)'}
              </button>
              {pastOpen && (
                <div style={{ marginTop: 12 }}>
                  {pastRenders === null && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>불러오는 중...</div>
                  )}
                  {pastRenders && pastRenders.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>아직 제작물이 없어요.</div>
                  )}
                  {pastRenders && pastRenders.length > 0 && (
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8,
                    }}>
                      {pastRenders.map((r) => (
                        <a key={r.url} href={r.url} target="_blank" rel="noreferrer"
                          style={{ textDecoration: 'none' }}>
                          {r.poster ? (
                            <img src={r.poster} alt=""
                              style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 8, background: '#000', border: '1px solid var(--border)', cursor: 'pointer' }} />
                          ) : (
                            <VideoPoster
                              url={r.url}
                              time={1}
                              style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 8, background: '#000', border: '1px solid var(--border)', cursor: 'pointer' }}
                            />
                          )}
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, textAlign: 'center' }}>
                            {new Date(r.uploadedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {loadingProposals && (
          <div className="loading show">
            <div className="loading-dots">
              <div className="dot" /><div className="dot" /><div className="dot" />
            </div>
            <div className="loading-text">영상 소스 분석 중...<br />맞춤 연출 3가지 만들고 있어요</div>
          </div>
        )}

        {step === 2 && !loadingProposals && (
          <div>
            <div className="section">
              <div className="sec-eyebrow">Step 2</div>
              <div className="sec-title">연출 방향 골라요</div>
              <div className="sec-desc">이 소스로 만들 수 있는 릴스예요. 하나 골라주세요.</div>
            </div>
            <div className="proposals show">
              {proposals.map((p, i) => (
                <div
                  key={i}
                  className={`proposal-card${selectedIndex === i ? ' selected' : ''}`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <div className="proposal-head">
                    <div className="proposal-no">{i + 1}</div>
                    <div>
                      <div className="proposal-title">{p.title}</div>
                      <div className="proposal-hook">&quot;{p.hook}&quot;</div>
                    </div>
                  </div>
                  <div className="proposal-body">
                    <div className="proposal-desc">{p.description}</div>
                    <div className="proposal-meta">
                      <span className="meta-tag duration">⏱ {p.duration}</span>
                      <span className="meta-tag format">📐 {p.format}</span>
                      <span className="meta-tag">난이도: {p.difficulty}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {hasClips ? (
                <>
                  <button className="btn-primary" onClick={generatePlan} disabled={selectedIndex === null}>
                    🎬 편집 계획 만들기 →
                  </button>
                  <button className="btn-secondary" onClick={generateDirective} disabled={selectedIndex === null}>
                    편집 지시서만 보기
                  </button>
                </>
              ) : (
                <button className="btn-primary" onClick={generateDirective} disabled={selectedIndex === null}>
                  편집 지시서 받기 →
                </button>
              )}
            </div>
            <div className="restart-row">
              <button className="btn-restart" onClick={restart}>← 소스 다시 입력</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="section">
              <div className="sec-eyebrow">Step 3</div>
              <div className="sec-title">
                {renderResult ? '완성됐어요!'
                  : rendering ? '영상 만드는 중이에요'
                  : planLoading ? '편집 계획 짜는 중이에요'
                  : plan ? '이렇게 만들게요 — 확인해 주세요'
                  : '이렇게 편집하면 돼요'}
              </div>
              <div className="sec-desc">
                {renderResult ? '아래 영상을 확인하고 다운로드하세요.'
                  : rendering ? ''
                  : planLoading ? ''
                  : plan ? 'AI가 짠 계획이에요. 마음에 들면 "이대로 제작"을 눌러주세요.'
                  : '순서대로 따라하면 완성이에요.'}
              </div>
            </div>

            {(loadingDirective || rendering || planLoading) && (
              <div className="loading show">
                <div className="loading-dots">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
                <div className="loading-text">
                  {rendering ? renderStage : planLoading ? '편집 계획 짜는 중...' : '편집 지시서 작성 중...'}
                </div>
              </div>
            )}

            {plan && !renderResult && !rendering && !planLoading && (
              <>
                <div className="directive show">
                  <div className="directive-body">
                    <PlanDetails plan={plan} bgm={bgm} onAnnotationsChange={setAnnotations} />
                  </div>
                </div>
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button className="btn-primary" onClick={runRender}>
                    ✅ 이대로 제작 →
                  </button>
                  <button className="btn-secondary" onClick={generatePlan}>
                    🔄 계획 다시 짜기
                  </button>
                </div>
                <div className="restart-row">
                  <button className="btn-restart" onClick={() => { setPlan(null); setStep(2) }}>← 연출 다시 고르기</button>
                </div>
              </>
            )}

            {error && <div className="error-box">{error}</div>}

            {renderResult && !rendering && (
              <>
                <div className="directive show">
                  <div className="directive-body">
                    <video
                      src={renderResult.url}
                      poster={renderResult.posterUrl || undefined}
                      controls
                      style={{ width: '100%', borderRadius: 10, background: '#000' }}
                    />
                    <PlanDetails plan={renderResult.plan} bgm={bgm} />
                  </div>
                </div>
                <div className="action-row">
                  <a className="btn-secondary" href={renderResult.url} download style={{ textAlign: 'center', textDecoration: 'none' }}>
                    ⬇ 다운로드
                  </a>
                  <button className="btn-reset" onClick={restart}>처음부터</button>
                </div>
              </>
            )}

            {directive && !loadingDirective && (
              <>
                <div className="directive show">
                  <div className="directive-header">
                    <div>
                      <div className="directive-header-title">📋 {directive.title}</div>
                      <div className="directive-header-sub">완성 길이: {directive.totalDuration}</div>
                    </div>
                  </div>
                  <div className="directive-body">
                    <div className="dir-section">
                      <div className="dir-sec-label">편집 순서</div>
                      <div className="dir-steps">
                        {directive.editSteps.map((s, i) => (
                          <div className="dir-step" key={i}>
                            <div className="dir-step-no">{i + 1}</div>
                            <div className="dir-step-text">
                              <strong>{s.step}</strong><br />{s.detail}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="dir-section">
                      <div className="dir-sec-label">자막 문구</div>
                      {directive.captions.map((c, i) => (
                        <div className="caption-box" style={{ marginBottom: 8 }} key={i}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                            {c.time} · {c.style}
                          </div>
                          <div className="caption-line">&quot;{c.text}&quot;</div>
                        </div>
                      ))}
                      <div className="caption-note">※ 위 문구를 CapCut 텍스트에 그대로 붙여넣으세요</div>
                    </div>
                    <div className="dir-section">
                      <div className="dir-sec-label">BGM</div>
                      <div className="dir-step">
                        <div className="dir-step-no">♪</div>
                        <div className="dir-step-text">
                          CapCut 오디오 탭 → <strong>&quot;{directive.bgmSuggestion}&quot;</strong> 검색 → 볼륨 20%
                        </div>
                      </div>
                    </div>
                    <div className="dir-section">
                      <div className="dir-sec-label">업로드 팁</div>
                      <div className="tip-box" style={{ marginTop: 0 }}>
                        💡 {directive.finalTip}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="action-row">
                  <button className="btn-secondary" onClick={copyDirective}>
                    {copied ? '✓ 복사됨!' : '📋 전체 복사'}
                  </button>
                  <button className="btn-reset" onClick={restart}>처음부터</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <img src={lightbox.src} alt="" style={{ maxWidth: '100%', maxHeight: '82vh', borderRadius: 10 }} />
          <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
            {lightbox.link && (
              <a href={lightbox.link} target="_blank" rel="noreferrer" className="btn-secondary"
                onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>
                Pexels에서 보기 ↗
              </a>
            )}
            <button className="btn-reset" onClick={() => setLightbox(null)}>닫기</button>
          </div>
        </div>
      )}
    </>
  )
}
