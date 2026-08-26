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
  const raw = data.content[0].text.replace(/```json|```/g, '').trim()
  return JSON.parse(raw)
}
