import { callClaude } from '../../../lib/anthropic'

export async function POST(request) {
  const { proposal, sourceText, treatment, clips } = await request.json()

  const clipList = clips
    .map((c, i) => `${i}: ${c.label || '(라벨 없음)'} (원본 길이 ${c.duration ? c.duration.toFixed(1) + '초' : '알 수 없음'})`)
    .join('\n')

  const prompt = `당신은 인스타 릴스 자동 편집 엔진의 플래너입니다.
아래 업로드된 클립들을 골라 순서를 정하고, 각 클립을 몇 초씩 쓸지, 어느 타이밍에 어떤 자막을 넣을지 결정하세요.

선택한 연출: "${proposal.title}" — "${proposal.hook}"
시술: ${treatment || '미지정'}
유비 설명: ${sourceText || '(없음)'}

업로드된 클립 목록 (index: 라벨 (원본 길이)):
${clipList}

규칙:
- 각 클립의 사용 길이(duration)는 원본 길이를 넘을 수 없습니다.
- 클립은 필요하면 생략하거나 순서를 바꿀 수 있습니다.
- 전체 영상 길이는 8~25초 사이로 구성하세요.
- 자막은 전체 타임라인 기준(초 단위)으로 시작/끝 시각을 지정하세요. 자막끼리 겹치지 않게 하세요.
- 자막 문구는 짧고 임팩트 있게, 실제 릴스에 쓸 수준으로 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "clipPlan": [ { "index": 0, "duration": 3.0 } ],
  "captions": [ { "start": 0, "end": 2.5, "text": "자막 문구" } ],
  "totalDuration": 15.0
}`

  try {
    const parsed = await callClaude(prompt, 2000)
    return Response.json(parsed)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
