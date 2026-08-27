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
    throw new Error(`응답 JSON 파싱 실패 (${e.message}): ${raw.slice(-200)}`)
  }
}
