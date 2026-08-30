import { list } from '@vercel/blob'

// 지난 제작물 — Vercel Blob의 renders/ 최근 항목. 제작 참고/재활용용.
// renders/{ts}.mp4 와 같은 이름의 renders/{ts}.jpg 포스터를 짝지어 준다.
export async function GET() {
  try {
    const res = await list({ prefix: 'renders/', limit: 400 })
    const posters = new Map() // base(ts) -> url
    for (const b of res.blobs) {
      const m = b.pathname.match(/renders\/(.+)\.jpg$/i)
      if (m) posters.set(m[1], b.url)
    }
    const items = res.blobs
      .filter((b) => /\.mp4$/i.test(b.pathname))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, 12)
      .map((b) => {
        const base = b.pathname.replace(/^renders\//, '').replace(/\.mp4$/i, '')
        return {
          url: b.url,
          poster: posters.get(base) || null,
          uploadedAt: b.uploadedAt,
          sizeKB: Math.round(b.size / 1024),
        }
      })
    return Response.json({ items })
  } catch (e) {
    return Response.json({ items: [], error: e.message })
  }
}
