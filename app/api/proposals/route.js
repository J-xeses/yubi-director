import { callClaude } from '../../../lib/anthropic'
import { categoryBlock } from '../../../lib/categories'

export async function POST(request) {
  const { sourceText, sourceTags, category, treatment, detail, mood, targetLength } = await request.json()
  // treatment 는 구버전 필드명 — category 로 통합(하위호환)
  const cat = category || (treatment ? '시술' : '기타')
  const catDetail = detail || (cat === '시술' ? treatment : '') || ''

  const lengthHint = targetLength === 'short'
    ? '15~20초의 간결하고 임팩트 있는 릴스'
    : targetLength === 'story'
      ? '30~45초의 스토리텔링 릴스'
      : '20~30초 분량의 릴스'

  const prompt = `당신은 크리에이터 유비의 인스타 릴스 디렉터입니다.
유비는 눈썹 반영구 시술자이면서, 채널에는 시술뿐 아니라 일상·출퇴근·먹방·공간 만들기까지 폭넓게 올립니다.
지금은 공유 스튜디오(SISA, 베드쉐어)에서 일하고, 곧 석촌에 자기 개인샵을 오픈합니다.
CapCut 초보 수준이고 혼자 촬영/편집합니다.
채널 무드는 모노톤·어반(흰 벽/검은 조명/대리석/스트릿 패션), 말투는 담백하고 솔직하며 가끔 셀프디스("낯가림은 해도 공간가림은 안 함 ㅋㅋ").
과한 감성·꾸밈은 지양하고, 짧고 사실적인 1인칭 톤을 유지하세요.

${categoryBlock(cat)}

오늘 유비가 찍은 영상 소스:
- 설명: ${sourceText || '(직접 설명 없음)'}
- 소스 유형: ${sourceTags || '미선택'}
- 세부: ${catDetail || '없음'}
- 원하는 분위기: ${mood || '미선택'}
- 목표 길이: ${lengthHint}

이 소스로 만들 수 있는 인스타 릴스 연출 방향을 3가지 제안해주세요.
위 카테고리의 연출 방향·톤을 반영하되, 소스 설명이 우선입니다.
각 제안의 "duration"은 위 목표 길이에 맞추세요.
각 제안은 CapCut 초보도 실제로 만들 수 있는 수준이어야 합니다.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{
  "proposals": [
    {
      "title": "연출 제목 (10자 이내)",
      "hook": "첫 3초 훅 문구 (실제 자막에 쓸 문장)",
      "description": "이 연출의 핵심 포인트와 왜 효과적인지 2문장",
      "duration": "예상 길이 (예: 15~20초)",
      "format": "릴스 포맷 (예: Before/After형, 브이로그형, 정보형, 스토리텔링형, 먹방/ASMR형)",
      "difficulty": "쉬움 or 보통"
    }
  ]
}`

  try {
    const parsed = await callClaude(prompt, 2000)
    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
