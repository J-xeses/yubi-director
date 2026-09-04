import { callClaude } from '../../../lib/anthropic'
import { categoryBlock } from '../../../lib/categories'
import { SFX_KEYS, SFX_GUIDE_TEXT } from '../../../lib/sfx'

const SFX_KEY_SET = new Set(SFX_KEYS)

// 효과음 배치 — AI가 고른 순간에 번들 효과음을 얹는다. 가이드: 모든 전환마다 넣지 말고
// 분기점만. 같은 효과음 3회+ 금지. 시각은 타임라인 클램프.
function sanitizeSfx(sfx, totalDuration) {
  if (!Array.isArray(sfx)) return []
  const used = {}
  const out = []
  for (const s of sfx) {
    const key = String(s?.key || s?.kind || '').trim()
    if (!SFX_KEY_SET.has(key)) continue
    if ((used[key] || 0) >= 2) continue
    let at = Number(s.at)
    if (!isFinite(at) || at < 0) continue
    if (totalDuration && at > totalDuration - 0.2) at = Math.max(0, totalDuration - 0.2)
    used[key] = (used[key] || 0) + 1
    out.push({ key, at: Number(at.toFixed(2)), gain: Number(s.gain) > 0 ? Math.min(1, Number(s.gain)) : undefined })
    if (out.length >= 8) break
  }
  return out.sort((a, b) => a.at - b.at)
}

// AI가 "자막끼리 겹치지 않게"라는 프롬프트 지시를 지키지 않고 겹치는 시간대를
// 반환하는 경우가 실제로 관측됨(2026-08-28) — 프롬프트만 믿지 않고 서버에서
// 강제로 겹침을 제거한다. 시작 시각 순으로 정렬한 뒤, 이전 자막이 끝나기 전에
// 시작하는 자막은 뒤로 밀고, 그 결과 노출 시간이 너무 짧아지면(0.3초 미만) 버린다.
function sanitizeCaptions(captions, totalDuration) {
  if (!Array.isArray(captions)) return []
  const MIN_GAP = 0.05
  const MIN_DURATION = 0.3

  const sorted = captions
    .filter(c => c && typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start && c.text)
    .sort((a, b) => a.start - b.start)

  const result = []
  let lastEnd = 0
  for (const cap of sorted) {
    const start = Math.max(cap.start, result.length ? lastEnd + MIN_GAP : cap.start)
    const end = Math.min(cap.end, totalDuration || cap.end)
    if (end - start < MIN_DURATION) continue
    // 렌더링 시 항상 한 줄로 나오도록 줄바꿈을 공백으로 치환 — 렌더 단계에서도
    // 같은 처리를 하지만(render/route.js), 캡션 데이터의 근본 출처인 여기서도
    // 정리해서 다른 소비자가 이 데이터를 써도 안전하게 한다.
    const text = String(cap.text || '').replace(/\s*\r?\n\s*/g, ' ').trim()
    result.push({ start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text })
    lastEnd = end
  }
  return result
}

const VALID_EFFECTS = new Set(['static', 'zoom-in', 'zoom-out', 'slow-mo'])
const VALID_GRADES = new Set(['warm', 'cool', 'moody', 'vivid', 'neutral'])
const VALID_BGM = new Set(['calm-piano', 'upbeat-reel', 'trust-corporate'])
const VALID_ANN_POS = new Set([
  'top_center', 'top_left', 'top_right', 'center', 'bottom_center', 'bottom_left', 'bottom_right',
])
const VALID_ANN_BUBBLE = new Set(['none', 'cloud', 'oval', 'arrow_box'])
const VALID_ANN_COLOR = new Set(['white', 'pink', 'lavender'])
const VALID_ANN_ARROW_DIR = new Set(['up', 'down', 'left', 'right'])

// 손글씨 오버레이(annotations): AI가 강조하고 싶은 순간 몇 군데에 손글씨 주석을 얹는다.
// caption/shot과 같은 이유로 서버에서 enum 검증 + 타임라인 범위 클램프를 강제한다.
function sanitizeAnnotations(annotations, totalDuration) {
  if (!Array.isArray(annotations)) return []
  return annotations
    .filter((a) => a && String(a.text || '').trim())
    .slice(0, 8)
    .map((a) => {
      let start = Math.max(0, Number(a.start) || 0)
      let end = Number(a.end) || start + 2.5
      if (totalDuration && end > totalDuration) end = totalDuration
      if (end - start < 0.5) end = Math.min(totalDuration || end + 2, start + 2)
      const decoRaw = Array.isArray(a.deco)
        ? a.deco
        : String(a.deco || '').split(',').map((s) => s.trim()).filter(Boolean)
      const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)))
      const out = {
        text: String(a.text).replace(/\s*\r?\n\s*/g, ' ').trim().slice(0, 40),
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        position: VALID_ANN_POS.has(a.position) ? a.position : 'top_center',
        bubble: VALID_ANN_BUBBLE.has(a.bubble) ? a.bubble : 'cloud',
        color: VALID_ANN_COLOR.has(a.color) ? a.color : 'white',
        deco: decoRaw.slice(0, 3).map(String),
        arrow: !!a.arrow,
        arrowDir: VALID_ANN_ARROW_DIR.has(a.arrowDir || a.arrow_direction)
          ? (a.arrowDir || a.arrow_direction)
          : 'down',
        backing: a.backing !== false,
        underline: !!a.underline,
      }
      if (a.x != null && isFinite(Number(a.x))) out.x = Number(clamp01(a.x).toFixed(3))
      if (a.y != null && isFinite(Number(a.y))) out.y = Number(clamp01(a.y).toFixed(3))
      if (Number(a.fontSize) > 0) out.fontSize = Math.max(28, Math.min(96, Math.round(Number(a.fontSize))))
      if (Array.isArray(a.arrowTarget) && a.arrowTarget.length === 2) {
        out.arrowTarget = [Number(clamp01(a.arrowTarget[0]).toFixed(3)), Number(clamp01(a.arrowTarget[1]).toFixed(3))]
      }
      return out
    })
    .filter((a) => a.text && a.end > a.start)
}

// caption과 같은 이유로, AI가 원본 클립 길이를 넘는 trimStart/duration을 주거나
// 없는 clipIndex를 참조하는 경우가 있을 수 있어 서버에서 클램프/필터링한다.
function sanitizeShots(shots, clips) {
  if (!Array.isArray(shots)) return []
  return shots
    .map((s) => {
      const clip = clips[s.clipIndex]
      if (!clip) return null
      const origDur = Number(clip.duration) || 3
      const effect = VALID_EFFECTS.has(s.effect) ? s.effect : 'static'
      const isSlowMo = effect === 'slow-mo'
      let trimStart = Math.max(0, Number(s.trimStart) || 0)
      let duration = Math.max(0.3, Number(s.duration) || 2)
      if (trimStart >= origDur) trimStart = 0
      const sourceNeeded = isSlowMo ? duration / 2 : duration
      if (trimStart + sourceNeeded > origDur) {
        const available = Math.max(0.15, origDur - trimStart)
        duration = isSlowMo ? available * 2 : available
      }
      if (duration < 0.3) return null
      return {
        clipIndex: s.clipIndex,
        trimStart: Number(trimStart.toFixed(2)),
        duration: Number(duration.toFixed(2)),
        effect,
      }
    })
    .filter(Boolean)
}

// 목표 길이 프리셋 — 'short'는 간결·임팩트, 'standard'는 기존 동작.
const LENGTH_PRESETS = {
  short: { lo: 15, hi: 20, cap: 21, shotLen: '2~3.5초', shotCount: '5~8개', captionCount: '4~6개', extra: '군더더기 없이 가장 강한 장면만 남기세요. 도입 훅 → 핵심 1~2개 → 마지막 한 방, 이 구조로 압축하세요.' },
  standard: { lo: 20, hi: 30, cap: 32, shotLen: '1.5~4초', shotCount: '8~12개', captionCount: '5~8개', extra: '' },
  story: { lo: 30, hi: 45, cap: 46, shotLen: '2.5~5초', shotCount: '8~14개', captionCount: '8~14개', extra: '스토리텔링 릴스입니다. 업로드된 클립을 순서대로 이어 감정선(도입→전개→클라이맥스→마무리)을 살리세요. 각 장면의 대사를 자막으로 나눠 담으세요.' },
}

// ── 시리즈 모드 픽스 대본 주입 ───────────────────────────────────────────────
// 시리즈 편을 고르면 그 편의 cuts(scene/caption/fx)가 그대로 편집 계획이 된다.
// Claude를 호출하지 않고, 아래에서 shots/captions/sfx 타임라인을 계산해 반환한 뒤
// 기존 sanitize 파이프라인(클램프·겹침 제거·길이 보정)을 똑같이 통과시킨다.

// cuts[].fx 는 카메라 효과(줌인/고정/슬로우모션/줌아웃)와 효과음 키가 섞여 들어온다.
const FX_TO_EFFECT = {
  '줌인': 'zoom-in', '줌아웃': 'zoom-out', '고정': 'static', '슬로우모션': 'slow-mo',
  'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', 'static': 'static', 'slow-mo': 'slow-mo',
}
function cutEffect(fx) {
  return FX_TO_EFFECT[String(fx || '').trim()] || 'static'
}

// scene 설명 ↔ 업로드 클립 label 을 한글 bigram 겹침으로 매칭. 마땅한 짝이 없으면 순번.
function normKo(s) {
  return String(s || '').toLowerCase().replace(/[^가-힣a-z0-9]+/g, '')
}
function bigrams(s) {
  const set = new Set()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}
function matchScore(scene, label) {
  const a = normKo(scene)
  const b = normKo(label)
  if (a.length < 2 || b.length < 2) return 0
  const ga = bigrams(a)
  const gb = bigrams(b)
  let hits = 0
  for (const g of ga) if (gb.has(g)) hits++
  return hits / ga.size
}
function assignClips(cuts, clips) {
  if (!Array.isArray(clips) || clips.length <= 1) return cuts.map(() => 0)
  return cuts.map((c, i) => {
    let best = -1
    let bestScore = 0.14 // 이 아래면 "매칭 실패"로 보고 순번 배치
    clips.forEach((cl, idx) => {
      const s = matchScore(c.scene, cl.label)
      if (s > bestScore) { bestScore = s; best = idx }
    })
    return best >= 0 ? best : i % clips.length
  })
}

function buildSeriesPlanRaw(seriesPlan, clips, LEN) {
  const cuts = (Array.isArray(seriesPlan.cuts) ? seriesPlan.cuts : [])
    .filter((c) => c && (String(c.scene || '').trim() || String(c.caption || '').trim()))
  const target = (LEN.lo + LEN.hi) / 2
  const per = Math.max(1.6, Math.min(4.0, target / Math.max(1, cuts.length)))
  const clipIdx = assignClips(cuts, clips)

  // 같은 클립이 여러 컷에 배치되면 원본 길이가 허락하는 만큼 trimStart 를 밀어
  // 다른 구간을 보여준다. 안 되면 0(같은 구간 재사용).
  const usedSpan = {}
  const shots = cuts.map((c, i) => {
    const effect = cutEffect(c.fx)
    const dur = Number((effect === 'slow-mo' ? per * 1.15 : per).toFixed(2))
    const idx = clipIdx[i]
    const origDur = Number(clips[idx] && clips[idx].duration) || 0
    let trimStart = 0
    const prev = usedSpan[idx] || 0
    if (origDur && prev + dur + 0.3 <= origDur) trimStart = Number(prev.toFixed(2))
    usedSpan[idx] = trimStart + dur
    return { clipIndex: idx, trimStart, duration: dur, effect }
  })

  let t = 0
  const captions = []
  const sfx = []
  cuts.forEach((c, i) => {
    const dur = shots[i].duration
    const text = String(c.caption || '').replace(/\s*\r?\n\s*/g, ' ').trim()
    if (text) {
      captions.push({
        start: Number((t + 0.2).toFixed(2)),
        end: Number((t + dur - 0.1).toFixed(2)),
        text,
      })
    }
    const fxKey = String(c.fx || '').trim()
    if (SFX_KEY_SET.has(fxKey)) sfx.push({ key: fxKey, at: Number((t + 0.15).toFixed(2)) })
    t += dur
  })

  return {
    shots,
    captions,
    annotations: [], // 시리즈 대본에는 손글씨가 없다 — 검토 화면에서 유비가 직접 추가
    sfx,
    totalDuration: Number(t.toFixed(2)),
    bgmKey: VALID_BGM.has(seriesPlan.bgm) ? seriesPlan.bgm : 'calm-piano',
    colorGrade: VALID_GRADES.has(seriesPlan.color) ? seriesPlan.color : 'neutral',
  }
}
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  const { proposal, sourceText, category, treatment, detail, clips, targetLength, seriesPlan } = await request.json()
  const LEN = LENGTH_PRESETS[targetLength] || LENGTH_PRESETS.standard
  const useSeries = !!(seriesPlan && Array.isArray(seriesPlan.cuts) && seriesPlan.cuts.length > 0)
  const cat = category || (treatment ? '시술' : '기타')
  const catDetail = detail || (cat === '시술' ? treatment : '') || ''

  const clipList = clips
    .map((c, i) => `${i}: ${c.label || '(라벨 없음)'} (원본 길이 ${c.duration ? c.duration.toFixed(1) + '초' : '알 수 없음'})`)
    .join('\n')

  const prompt = `당신은 인스타 릴스 자동 편집 엔진의 디렉터입니다. 그냥 클립을 순서대로 이어붙이는 게 아니라,
실제 편집자처럼 하나의 클립 안에서도 여러 장면(샷)을 뽑아내고 카메라 무빙 효과를 넣어 리듬감 있게 구성하세요.

선택한 연출: "${proposal.title}" — "${proposal.hook}"
유비 설명: ${sourceText || '(없음)'}
${catDetail ? `세부: ${catDetail}` : ''}

${categoryBlock(cat)}

업로드된 클립 목록 (index: 라벨 (원본 길이)):
${clipList}

규칙:
- "shots" 배열이 최종 타임라인입니다. 같은 clipIndex를 여러 샷에서 서로 다른 trimStart로 재사용해도 됩니다
  (예: 클립 0의 0~3초 구간을 줌인 샷으로, 같은 클립의 4~6초 구간을 다른 표정으로 슬로우모션 샷으로 — 이렇게
  하나의 소스에서 최소 2개 이상의 서로 다른 "장면"을 뽑아내세요). 클립이 1개뿐이어도 여러 샷으로 나누세요.
- 각 샷의 trimStart + duration(slow-mo는 duration/2)은 그 클립의 원본 길이를 넘을 수 없습니다.
- 각 샷마다 effect를 아래 중 하나로 지정하세요. 최소 절반 이상의 샷에는 static이 아닌 효과를 쓰세요:
  - "static": 효과 없음
  - "zoom-in": 서서히 확대 (강조하고 싶은 표정/디테일에 사용)
  - "zoom-out": 서서히 축소
  - "slow-mo": 절반 속도 슬로우모션 (감성적인 순간에 사용)
- 샷 길이는 ${LEN.shotLen} 사이로, 너무 길게 한 샷을 끌지 마세요 — 리듬감 있게 여러 샷으로 쪼개세요.
- 전체 영상 길이는 ${LEN.lo}~${LEN.hi}초로 구성하세요. 샷은 총 ${LEN.shotCount} 내외.${LEN.extra ? ' ' + LEN.extra : ''}
- 클립 라벨이 "스톡 B-roll(검색)"인 것은 직접 촬영한 게 아니라 보충용으로 검색해 넣은
  자료입니다. 핵심 서사(시술 과정, 고객 반응 등)는 본인 촬영 클립으로 채우고, 스톡
  클립은 도입부/전환/분위기 보강용으로 활용해 ${LEN.lo}~${LEN.hi}초를 자연스럽게 채우세요.
- 자막은 전체 타임라인 기준(초 단위)으로 시작/끝 시각을 지정하세요. 자막끼리 겹치지 않게 하세요.
- 자막은 ${LEN.captionCount} 정도로, 짧고 임팩트 있게, 실제 릴스에 쓸 수준으로 작성하세요.
- bgmKey는 이 영상 분위기에 가장 잘 맞는 것 하나를 아래 중에서 고르세요:
  - "calm-piano": 잔잔한 피아노, 감동적/진솔한 톤
  - "upbeat-reel": 밝고 경쾌한 릴스 비트, 활기찬 톤
  - "trust-corporate": 차분하고 신뢰감 있는 톤, 전문적/정보형
- colorGrade는 분위기에 맞게 하나 고르세요: "warm"(따뜻한 톤), "cool"(차분한 블루톤), "moody"(무게감 있는 저채도), "vivid"(선명하고 발랄함), "neutral"(자연스럽게 살짝만 보정)
  · 유비 채널은 모노톤·어반 무드가 기본입니다 — 특별한 이유가 없으면 "neutral" 또는 "moody"를 쓰고,
    "warm"/"vivid"는 정말 밝고 따뜻한 장면일 때만 쓰세요.
- "annotations"는 손으로 쓴 듯한 손글씨 주석입니다(인스타 스토리 꾸미기 스타일). 자막과 별개로,
  화면을 풍성하게 채우도록 3~6개를 여러 위치에 흩뿌리세요. 종류를 섞으면 좋습니다:
    · 도입 타이틀 (bubble "none" + underline, 큰 글씨)
    · 감정/반전 한마디 (cloud 말풍선 + deco)
    · 화면 속 사물·장면을 지목하는 짧은 라벨 ("← 직접 조색한 색소" 처럼 arrow로 겨냥)
    · 여백에 툭 던지는 혼잣말 (bubble "none", 작은 글씨, 기울임)
  같은 시간대에 2~3개가 겹쳐 보여도 됩니다. 각 항목:
  - text: 손글씨 문구 (짧고 강하게, 최대 14자. \n로 줄바꿈 가능)
  - start / end: 전체 타임라인 기준 노출 시각(초)
  - position 또는 x/y(0~1 비율, 사물 옆에 붙이고 싶을 때)
  - bubble: "cloud" | "oval" | "arrow_box" | "none"
  - color: "white"(기본) | "pink" | "lavender"
  - deco: 장식 글자 배열 ["♡","✦"] (없으면 [])
  - arrow: true + arrowDir "up"|"down"|"left"|"right", 또는 arrowTarget [x,y](0~1)로 특정 지점 겨냥
  - backing: 기본 true. 어두운 장면이면 false
  - underline: true면 물결 밑줄 + 위쪽 틱마크 (도입 타이틀용, bubble "none"일 때만)
  - fontSize: 타이틀 56~68, 일반 40~50, 작은 라벨 30~38
- "sfx"는 특정 순간에 얹을 효과음입니다. <b>모든 전환마다 넣지 말고</b> 분기점·강조 포인트에만 3~5개.
  같은 효과음을 3번 이상 쓰지 마세요(비슷한 다른 걸로 변주). 위 "효과음 성향"을 참고하세요.
  고를 수 있는 효과음:
${SFX_GUIDE_TEXT}
  각 항목: { "key": "위 이름 중 하나", "at": 전체 타임라인 기준 시각(초) }
  기본 추천 포인트: 도입 훅 / 큰 전환 / 결과·반전 공개 / 마무리.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "shots": [ { "clipIndex": 0, "trimStart": 0, "duration": 3.0, "effect": "zoom-in" } ],
  "captions": [ { "start": 0, "end": 2.5, "text": "자막 문구" } ],
  "annotations": [ { "text": "이거 실화?", "start": 1.0, "end": 4.0, "position": "top_center", "bubble": "cloud", "color": "white", "deco": ["✦"], "arrow": false } ],
  "sfx": [ { "key": "transition", "at": 0.2 }, { "key": "shutter", "at": 6.5 } ],
  "totalDuration": 15.0,
  "bgmKey": "calm-piano",
  "colorGrade": "warm"
}`

  try {
    // 시리즈 편을 골랐으면 픽스된 대본을 그대로 계획으로 쓰고, 아니면 Claude가 생성.
    const parsed = useSeries
      ? buildSeriesPlanRaw(seriesPlan, clips, LEN)
      : await callClaude(prompt, 8000)
    parsed.shots = sanitizeShots(parsed.shots, clips)
    if (parsed.shots.length === 0) {
      return Response.json({
        error: useSeries
          ? '시리즈 대본을 편집 계획으로 변환하지 못했습니다 — 업로드한 소스를 확인해주세요.'
          : 'AI가 유효한 편집 계획을 만들지 못했습니다. 다시 시도해주세요.',
      }, { status: 500 })
    }
    parsed.totalDuration = Number(parsed.shots.reduce((sum, s) => sum + s.duration, 0).toFixed(2))

    // AI가 목표 길이를 넘겨도 사용자가 고른 길이를 지키도록 서버에서 전체를 균등
    // 축소한다(샷·자막·주석 타임코드 동일 비율). 그래야 "짧게(15~20초)"가 실제로 지켜짐.
    if (parsed.totalDuration > LEN.cap) {
      const f = LEN.cap / parsed.totalDuration
      const sc = (t) => Number((Number(t) * f).toFixed(2))
      parsed.shots = parsed.shots.map((s) => ({ ...s, duration: Math.max(0.5, sc(s.duration)) }))
      parsed.totalDuration = Number(parsed.shots.reduce((sum, s) => sum + s.duration, 0).toFixed(2))
      if (Array.isArray(parsed.captions)) {
        parsed.captions = parsed.captions.map((c) => ({ ...c, start: sc(c.start), end: sc(c.end) }))
      }
      if (Array.isArray(parsed.annotations)) {
        parsed.annotations = parsed.annotations.map((a) => ({ ...a, start: sc(a.start), end: sc(a.end) }))
      }
      if (Array.isArray(parsed.sfx)) {
        parsed.sfx = parsed.sfx.map((x) => ({ ...x, at: sc(x.at) }))
      }
    }

    parsed.captions = sanitizeCaptions(parsed.captions, parsed.totalDuration)
    parsed.annotations = sanitizeAnnotations(parsed.annotations, parsed.totalDuration)
    parsed.sfx = sanitizeSfx(parsed.sfx, parsed.totalDuration)
    if (!VALID_GRADES.has(parsed.colorGrade)) parsed.colorGrade = 'neutral'
    parsed.planSource = useSeries ? 'series' : 'ai'
    if (useSeries) parsed.seriesCode = seriesPlan.code || null
    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
