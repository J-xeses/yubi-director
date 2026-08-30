'use client'

import { useState } from 'react'
import { upload } from '@vercel/blob/client'

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
const BGM_LABELS = {
  'calm-piano': '잔잔한 피아노 (Emotional Piano · MondaMusic)',
  'upbeat-reel': '밝고 경쾌한 릴스 비트 (Instagram Reel · SoundSurfer)',
  'trust-corporate': '차분하고 신뢰감 있는 톤 (Trusted Coverage · JoyInSound)',
}

// 편집 계획 상세 — 제작 전 검토 화면과 완성 후 결과 화면에서 공용으로 쓴다.
function PlanDetails({ plan, bgm }) {
  const anns = Array.isArray(plan.annotations) ? plan.annotations : []
  return (
    <>
      <div className="dir-section" style={{ marginTop: 16 }}>
        <div className="dir-sec-label">
          샷 구성 ({plan.shots.length}컷 · 총 {Number(plan.totalDuration || 0).toFixed(1)}초)
        </div>
        <div className="dir-steps">
          {plan.shots.map((s, i) => (
            <div className="dir-step" key={i}>
              <div className="dir-step-no">{i + 1}</div>
              <div className="dir-step-text">
                {s.duration.toFixed(1)}초 · {EFFECT_LABELS[s.effect] || s.effect}
              </div>
            </div>
          ))}
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
      {anns.length > 0 && (
        <div className="dir-section">
          <div className="dir-sec-label">손글씨 주석 ({anns.length}개)</div>
          {anns.map((a, i) => (
            <div className="caption-box" style={{ marginBottom: 8 }} key={i}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                {a.start.toFixed(1)}s ~ {a.end.toFixed(1)}s · {ANN_POS_LABELS[a.position] || a.position} · {ANN_BUBBLE_LABELS[a.bubble] || a.bubble}
                {a.arrow ? ' · 화살표' : ''}
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
      const res = await fetch(`/api/source-search?q=${encodeURIComponent(stockQuery.trim())}`)
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
      status: 'done',
      source: 'stock',
      photographer: result.photographer,
    }])
  }

  function removeClip(id) {
    setClips((prev) => prev.filter((c) => c.id !== id))
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
      setPlan({ ...data, _clips: readyClips })
    } catch (e) {
      setError(`편집 계획 생성 실패: ${e.message}`)
    } finally {
      setPlanLoading(false)
    }
  }

  // 2단계: 검토한 plan을 그대로 렌더로 넘긴다. ("이대로 제작" 클릭 시)
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
      const renderRes = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shots: renderShots,
          captions: plan.captions,
          annotations: plan.annotations || [],
          bgmUrl: bgm?.url || null,
          bgmKey: bgm?.url ? null : plan.bgmKey,
          totalDuration: plan.totalDuration,
          colorGrade: plan.colorGrade,
        }),
      })
      const rendered = await renderRes.json()
      if (!renderRes.ok) throw new Error(rendered.error || '영상 합성 실패')

      setRenderResult({ url: rendered.url, plan })
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
                      <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
                        {c.source === 'stock' ? `Pexels · ${c.photographer || '스톡 영상'}` : c.file.name}
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
              <div className="tag-label">추가 소스 검색 (선택 — 직접 찍은 게 부족하면 스톡 B-roll로 채워드려요)</div>
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
                        style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', borderRadius: 8 }}
                      />
                      <button
                        className="btn-primary"
                        style={{ position: 'absolute', bottom: 6, left: 6, right: 6, padding: '4px 0', fontSize: 12 }}
                        onClick={() => addStockClip(r)}
                      >
                        + 추가
                      </button>
                    </div>
                  ))}
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
                    <PlanDetails plan={plan} bgm={bgm} />
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
    </>
  )
}
