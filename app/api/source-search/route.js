const PEXELS_API_KEY = process.env.PEXELS_API_KEY || ''

// orientation 요청을 Pexels 자체 orientation 파라미터로 1차 필터링한 뒤, 응답 항목의
// 실제 width/height도 다시 비교해 걸러낸다 — Pexels 태깅이 항상 정확하진 않아서
// (세로 요청인데 가로 파일이 섞여 나오는 경우가 있음) 2중으로 확인한다.
function matchesOrientation(width, height, orientation) {
  if (orientation === 'portrait') return height > width
  if (orientation === 'landscape') return width > height
  return true
}

// 릴스용 B-roll 스톡 소스 검색(Pexels). 여리 스튜디오 server/proxy.js의
// /api/source-search와 동일 로직 — 세로 릴스 전용이라 orientation/type 기본값만
// portrait/video로 다르게 잡는다.
export async function GET(request) {
  if (!PEXELS_API_KEY) {
    return Response.json({ error: 'PEXELS_API_KEY 미설정 (.env.local 확인)' }, { status: 500 })
  }
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')
  const type = searchParams.get('type') || 'video'
  const orientation = searchParams.get('orientation') || 'portrait'
  const page = searchParams.get('page') || '1'
  const perPage = searchParams.get('perPage') || '15'
  if (!q) return Response.json({ error: 'q(검색어) 필요' }, { status: 400 })

  try {
    const results = []

    if (type === 'video' || type === 'all') {
      const url = new URL('https://api.pexels.com/videos/search')
      url.searchParams.set('query', q)
      url.searchParams.set('page', page)
      url.searchParams.set('per_page', perPage)
      if (orientation !== 'all') url.searchParams.set('orientation', orientation)
      const r = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } })
      if (!r.ok) throw new Error(`Pexels 영상 검색 실패: HTTP ${r.status}`)
      const data = await r.json()
      for (const v of data.videos || []) {
        // 여러 화질 변형(video_files) 중 orientation에 맞고 해상도가 가장 큰 것을 대표로 선택
        const candidates = (v.video_files || []).filter(f => matchesOrientation(f.width, f.height, orientation))
        const pick = candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
        if (!pick) continue
        results.push({
          id: `video-${v.id}`,
          type: 'video',
          title: v.user?.name ? `${v.user.name} · 영상` : `Pexels 영상 #${v.id}`,
          thumbnail: v.image,
          downloadUrl: pick.link,
          width: pick.width,
          height: pick.height,
          duration: v.duration,
          photographer: v.user?.name || '',
          pexelsUrl: v.url,
        })
      }
    }

    if (type === 'image' || type === 'all') {
      const url = new URL('https://api.pexels.com/v1/search')
      url.searchParams.set('query', q)
      url.searchParams.set('page', page)
      url.searchParams.set('per_page', perPage)
      if (orientation !== 'all') url.searchParams.set('orientation', orientation)
      const r = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } })
      if (!r.ok) throw new Error(`Pexels 이미지 검색 실패: HTTP ${r.status}`)
      const data = await r.json()
      for (const p of data.photos || []) {
        if (!matchesOrientation(p.width, p.height, orientation)) continue
        results.push({
          id: `image-${p.id}`,
          type: 'image',
          title: p.alt || `Pexels 사진 #${p.id}`,
          thumbnail: p.src?.medium,
          downloadUrl: p.src?.original,
          width: p.width,
          height: p.height,
          duration: null,
          photographer: p.photographer || '',
          pexelsUrl: p.url,
        })
      }
    }

    return Response.json({ results })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
