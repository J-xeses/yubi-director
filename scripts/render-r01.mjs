// R01 "만년 직원이 갑자기 원장이 된 이유" — 컷별 재작업 렌더
// 스토리보드(5씬) 스크립트 그대로, 컷 순서 고정, 손글씨 3개(도입/클라이맥스/마무리 북엔드)
const BASE = process.argv[2] || 'https://yubi-director.vercel.app'

const IMG = {
  C01: 'https://mxhkl9t8tyatr1rr.public.blob.vercel-storage.com/r01-src/C01-1788167899083-o48ATyxZtDfkznZXbl4QhPcP5EfpiR.jpg',
  C02: 'https://mxhkl9t8tyatr1rr.public.blob.vercel-storage.com/r01-src/C02-1788167899896-cMhD0PYD1sk3fvI8UGZRdUmsJT98xu.jpg',
  C03: 'https://mxhkl9t8tyatr1rr.public.blob.vercel-storage.com/r01-src/C03-1788167900545-3xCfyAKr7FJmM5pKQ5E0w3l0MGaSfz.jpg',
  C043: 'https://mxhkl9t8tyatr1rr.public.blob.vercel-storage.com/r01-src/C04-3-1788167901380-JxlcSwNOR038TSBoEf6fKFOLarJfLb.jpg',
  C05: 'https://mxhkl9t8tyatr1rr.public.blob.vercel-storage.com/r01-src/C05-1788167902020-VTIKxKWvMGem7gnMQXaxXuLdT9Rl9m.jpg',
}

// 샷: S1 0-5 / S2 5-13 / S3 13-20 / S4 20-30 / S5 30-38
const shots = [
  { url: IMG.C01, duration: 5.0, effect: 'zoom-in' },   // 도구 정리 → 정면, 쓸쓸
  { url: IMG.C02, duration: 8.0, effect: 'zoom-out' },   // 카페, 회상 (뒤로 빠지며 고립감)
  { url: IMG.C03, duration: 7.0, effect: 'zoom-in' },    // 눈물, 감정 몰입
  { url: IMG.C043, duration: 10.0, effect: 'zoom-in' },  // 샵 문 여는 장면, 고조
  { url: IMG.C05, duration: 8.0, effect: 'zoom-out' },   // 미소, 여운 (뒤로 빠지며 마무리)
]
const totalDuration = 38.0

const captions = [
  // S1
  { text: '저 사실… 원장 될 생각이 없었어요', start: 0.6, end: 4.7 },
  // S2
  { text: '사업, 세 번 말아먹었거든요', start: 5.5, end: 8.4 },
  { text: '그냥 직원이 편했어요', start: 8.7, end: 10.9 },
  { text: '책임, 안 져도 되니까', start: 11.1, end: 12.8 },
  // S3
  { text: '아빠가 많이 아프시다는', start: 13.6, end: 16.7 },
  { text: '연락을 받았어요', start: 16.9, end: 19.6 },
  // S4
  { text: '더 많이 벌어야 했어요', start: 20.6, end: 23.4 },
  { text: '무서워도, 해야 했어요', start: 23.7, end: 26.5 },
  { text: '그래서 차렸어요. 제 샵', start: 26.8, end: 29.6 },
  // S5
  { text: '무서워서 못 한 게 아니라', start: 30.6, end: 33.3 },
  { text: '무서워도, 했어요', start: 33.6, end: 35.4 },
  { text: '아직도 떨리지만, 괜찮아요', start: 35.7, end: 37.8 },
]

const annotations = [
  { // S1 도입 — 상단, 얼굴 위 어두운 천장
    text: '10년째, 직원이었어요',
    position: 'top_center', y: 0.11,
    bubble: 'none', backing: true, color: 'white', deco: [], fontSize: 54,
    start: 1.4, end: 4.8,
  },
  { // S4 클라이맥스 — 유리문 위쪽, 인물(우측) 피해서
    text: '무서웠지만\n문을, 열었어요',
    position: 'top_center', x: 0.31, y: 0.2,
    bubble: 'none', backing: true, color: 'white', deco: [], fontSize: 48,
    start: 24.6, end: 29.4,
  },
  { // S5 마무리 — 상단, 얼굴 위. S1과 북엔드
    text: '이제, 제 샵이에요',
    position: 'top_center', y: 0.1,
    bubble: 'none', backing: true, color: 'white', deco: ['♡'], fontSize: 54,
    start: 34.0, end: 37.8,
  },
]

const payload = {
  shots, captions, annotations, totalDuration,
  colorGrade: 'warm',
  bgmKey: 'calm-piano',
  bgmVolume: 0.15,
}

console.error(`POST ${BASE}/api/render  (${shots.length}샷 / ${totalDuration}s / 자막 ${captions.length} / 손글씨 ${annotations.length})`)
const t0 = Date.now()
const res = await fetch(`${BASE}/api/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})
const text = await res.text()
console.error(`status ${res.status}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
console.log(text)
