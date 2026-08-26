import { callClaude } from '../../../lib/anthropic'

export async function POST(request) {
  const { proposal, sourceText, sourceTags, treatment } = await request.json()

  const prompt = `당신은 뷰티 크리에이터 유비의 인스타 릴스 편집 디렉터입니다.
유비는 CapCut 초보이며 혼자 편집합니다. 따라하기만 하면 되는 수준으로 작성하세요.

선택한 연출: "${proposal.title}"
훅 문구: "${proposal.hook}"
소스: ${sourceTags || sourceText}
시술: ${treatment}

반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "편집 지시서 제목",
  "totalDuration": "완성 영상 예상 길이",
  "editSteps": [
    { "step": "단계 제목", "detail": "구체적인 CapCut 실행 방법 (메뉴 경로 포함)" }
  ],
  "captions": [
    { "time": "등장 시점", "text": "실제 자막 문구", "style": "스타일 설명" }
  ],
  "bgmSuggestion": "BGM 추천 (CapCut 내 검색어)",
  "finalTip": "올릴 때 한 줄 팁"
}`

  try {
    const parsed = await callClaude(prompt, 1200)
    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
