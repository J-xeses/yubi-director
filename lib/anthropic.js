const MODEL = 'claude-sonnet-5'

export async function callClaude(prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.')
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic API 오류 (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  const textBlock = data.content.find((b) => b.type === 'text')
  if (!textBlock) {
    throw new Error('Anthropic 응답에 텍스트 블록이 없습니다.')
  }
  const raw = textBlock.text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(raw)
  } catch (e) {
    // stop_reason이 'max_tokens'면 maxTokens가 작아서 JSON이 중간에 잘린 것 —
    // "Unexpected end of JSON input"만 보고는 원인을 알기 어려워서 명확히 구분해준다
    // (2026-08-28 실측: 목표 길이를 20~30초로 늘리자 샷/자막이 늘어 2500 토큰으로
    // 부족해지는 경우가 실제로 발생함).
    if (data.stop_reason === 'max_tokens') {
      throw new Error(`응답이 maxTokens(${maxTokens})를 넘어 중간에 잘렸습니다 — maxTokens를 늘려주세요.`)
    }
    throw new Error(`응답 JSON 파싱 실패 (${e.message}): ${raw.slice(-200)}`)
  }
}
