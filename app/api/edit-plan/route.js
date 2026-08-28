import { callClaude } from '../../../lib/anthropic'

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
    result.push({ start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: cap.text })
    lastEnd = end
  }
  return result
}

const VALID_EFFECTS = new Set(['static', 'zoom-in', 'zoom-out', 'slow-mo'])
const VALID_GRADES = new Set(['warm', 'cool', 'moody', 'vivid', 'neutral'])

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

export async function POST(request) {
  const { proposal, sourceText, treatment, clips } = await request.json()

  const clipList = clips
    .map((c, i) => `${i}: ${c.label || '(라벨 없음)'} (원본 길이 ${c.duration ? c.duration.toFixed(1) + '초' : '알 수 없음'})`)
    .join('\n')

  const prompt = `당신은 인스타 릴스 자동 편집 엔진의 디렉터입니다. 그냥 클립을 순서대로 이어붙이는 게 아니라,
실제 편집자처럼 하나의 클립 안에서도 여러 장면(샷)을 뽑아내고 카메라 무빙 효과를 넣어 리듬감 있게 구성하세요.

선택한 연출: "${proposal.title}" — "${proposal.hook}"
시술: ${treatment || '미지정'}
유비 설명: ${sourceText || '(없음)'}

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
- 샷 길이는 1.5~4초 사이로, 너무 길게 한 샷을 끌지 마세요 — 리듬감 있게 여러 샷으로 쪼개세요.
- 전체 영상 길이는 20~30초 사이로 구성하세요.
- 클립 라벨이 "스톡 B-roll(검색)"인 것은 직접 촬영한 게 아니라 보충용으로 검색해 넣은
  자료입니다. 핵심 서사(시술 과정, 고객 반응 등)는 본인 촬영 클립으로 채우고, 스톡
  클립은 도입부/전환/분위기 보강용으로 활용해 20~30초를 자연스럽게 채우세요.
- 자막은 전체 타임라인 기준(초 단위)으로 시작/끝 시각을 지정하세요. 자막끼리 겹치지 않게 하세요.
- 자막 문구는 짧고 임팩트 있게, 실제 릴스에 쓸 수준으로 작성하세요.
- bgmKey는 이 영상 분위기에 가장 잘 맞는 것 하나를 아래 중에서 고르세요:
  - "calm-piano": 잔잔한 피아노, 감동적/진솔한 톤
  - "upbeat-reel": 밝고 경쾌한 릴스 비트, 활기찬 톤
  - "trust-corporate": 차분하고 신뢰감 있는 톤, 전문적/정보형
- colorGrade는 분위기에 맞게 하나 고르세요: "warm"(따뜻한 톤), "cool"(차분한 블루톤), "moody"(무게감 있는 저채도), "vivid"(선명하고 발랄함), "neutral"(자연스럽게 살짝만 보정)

반드시 아래 JSON 형식으로만 응답하세요:
{
  "shots": [ { "clipIndex": 0, "trimStart": 0, "duration": 3.0, "effect": "zoom-in" } ],
  "captions": [ { "start": 0, "end": 2.5, "text": "자막 문구" } ],
  "totalDuration": 15.0,
  "bgmKey": "calm-piano",
  "colorGrade": "warm"
}`

  try {
    const parsed = await callClaude(prompt, 2500)
    parsed.shots = sanitizeShots(parsed.shots, clips)
    if (parsed.shots.length === 0) {
      return Response.json({ error: 'AI가 유효한 편집 계획을 만들지 못했습니다. 다시 시도해주세요.' }, { status: 500 })
    }
    parsed.totalDuration = Number(parsed.shots.reduce((sum, s) => sum + s.duration, 0).toFixed(2))
    parsed.captions = sanitizeCaptions(parsed.captions, parsed.totalDuration)
    if (!VALID_GRADES.has(parsed.colorGrade)) parsed.colorGrade = 'neutral'
    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
