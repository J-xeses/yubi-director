const MODEL = 'claude-sonnet-5'

export async function POST(req) {
  const { prompt, max_tokens = 1000 } = await req.json()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Anthropic API 오류 (${res.status}): ${text.slice(0, 300)}`)
    }

    const data = await res.json()
    const textBlock = data.content?.find((b) => b.type === 'text')
    return Response.json({ content: textBlock?.text || '' })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
