import { list } from '@vercel/blob'

// 지난 제작물 — Vercel Blob의 renders/ 최근 항목. 제작 참고/재활용용.
export async function GET() {
  try {
    const res = await list({ prefix: 'renders/', limit: 200 })
    const items = res.blobs
      .filter((b) => /\.mp4$/i.test(b.pathname))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(0, 12)
      .map((b) => ({ url: b.url, uploadedAt: b.uploadedAt, sizeKB: Math.round(b.size / 1024) }))
    return Response.json({ items })
  } catch (e) {
    return Response.json({ items: [], error: e.message })
  }
}
