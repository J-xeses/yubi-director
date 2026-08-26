'use client'

import { useState } from 'react'

const SOURCE_TAGS = [
  '시술 전 사진/영상', '시술 중 클로즈업', '시술 후 결과', '고객 반응',
  '거울 확인 장면', '손/도구 클로즈업', 'Before/After 사진', '유비 설명 셀카',
]
const TREATMENT_TAGS = ['이마라인 교정', '눈썹 반영구', '복합 시술', '상담/설명', '기타']
const MOOD_TAGS = ['감동적/진솔한', '전문적/신뢰감', '밝고 활기찬', '교육적/정보형', '친근한/일상적']

function StepDot({ n, current }) {
  const done = n < current
  const active = n === current
  return (
    <div className="step-item">
      <div className={`step-dot${active ? ' active' : ''}${done ? ' done' : ''}`}>
        {done ? '✓' : n}
      </div>
      <span className={`step-label${active ? ' active' : ''}`}>
        {n === 1 ? '소스 입력' : n === 2 ? '연출 선택' : '편집 지시서'}
      </span>
    </div>
  )
}

export default function Page() {
  const [step, setStep] = useState(1)
  const [sourceText, setSourceText] = useState('')
  const [sourceTags, setSourceTags] = useState([])
  const [treatment, setTreatment] = useState('')
  const [mood, setMood] = useState('')

  const [loadingProposals, setLoadingProposals] = useState(false)
  const [proposals, setProposals] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(null)

  const [loadingDirective, setLoadingDirective] = useState(false)
  const [directive, setDirective] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  function toggleSourceTag(tag) {
    setSourceTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
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
    setProposals([])
    setSelectedIndex(null)
    setDirective(null)
    setError('')
  }

  return (
    <>
      <div className="header">
        <div className="header-mark">✦</div>
        <div>
          <div className="header-title">유비 디렉터</div>
          <div className="header-sub">영상 소스 설명 → 릴스 연출 제안 → 편집 지시서</div>
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
              <div className="sec-desc">촬영한 것들을 편하게 설명해주세요. 잘 정리 안 해도 돼요.</div>
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

            <div className="tag-group" style={{ marginBottom: 24 }}>
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
            <div style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={generateDirective} disabled={selectedIndex === null}>
                편집 지시서 받기 →
              </button>
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
              <div className="sec-title">이렇게 편집하면 돼요</div>
              <div className="sec-desc">순서대로 따라하면 완성이에요.</div>
            </div>

            {loadingDirective && (
              <div className="loading show">
                <div className="loading-dots">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
                <div className="loading-text">편집 지시서 작성 중...</div>
              </div>
            )}

            {error && <div className="error-box">{error}</div>}

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
