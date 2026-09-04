// 유비 콘텐츠 카테고리 — 시술뿐 아니라 일상·출퇴근·먹방·공간까지.
// 각 카테고리마다 연출 방향(proposals) + 편집 톤(edit-plan) 힌트.

export const CATEGORIES = {
  '시술': {
    label: '시술 (눈썹 반영구 · 이마라인)',
    direction: `Before/After · 과정 클로즈업 · 정보형이 강함. 손·도구·색소 디테일, 거울 확인 순간, 고객의 "어?" 반응이 핵심.
훅은 결과 먼저 보여주거나("이거 반영구예요") 통념을 깨는 문장.`,
    pacing: '핵심 클로즈업은 1.5~3초로 빠르게, 결과 컷은 살짝 길게(2.5~4초). 줌인을 디테일에 적극 사용.',
    sfxLean: 'shutter(Before/After·결과), zoom(디테일 클로즈업), ding(핵심 정보), transition',
    bgmLean: 'trust-corporate 또는 calm-piano',
    grade: 'neutral 또는 moody',
  },
  '일상 브이로그': {
    label: '일상 브이로그',
    direction: `담백한 하루의 조각. 특별한 사건 없이도 리듬으로 보게 만듦. 셀프디스 유머 한 스푼("낯가림은 해도 공간가림은 안 함 ㅋㅋ").
훅은 상황을 툭 던지기("오늘도 트롤리 끌고 출근").`,
    pacing: '장면을 짧게 여러 개(1.5~3초), 브이로그 리듬. 한 컷을 오래 끌지 말 것. slow-mo는 감성 한 순간에만.',
    sfxLean: 'transition/whoosh(장면 전환), pop(자막), click, scratch(반전 유머), sparkle',
    bgmLean: 'upbeat-reel 또는 calm-piano',
    grade: 'neutral',
  },
  '출퇴근': {
    label: '출퇴근 · 트롤리 투어',
    direction: `트롤리에 장비 다 챙겨 다니는 시술자의 이동. SISA 도착, 세팅, 지하철·거리. "만년 직원 → 원장" 아크의 일상 버전.
훅은 이동의 고단함·루틴을 담백하게.`,
    pacing: '걷기·이동 컷에 팬(zoom-out) 활용, 세팅 컷은 타이밍 좋게. 1.5~3초.',
    sfxLean: 'transition/whoosh(이동), click(세팅), typing(계획), zoom',
    bgmLean: 'upbeat-reel',
    grade: 'cool 또는 neutral',
  },
  '먹방': {
    label: '먹방 · 혼밥',
    direction: `혼밥 · 짧은 리액션 · 담백한 감상. ASMR처럼 소리를 살리되 과장 없이. "일하다 이거 하나 먹는 낙" 톤.
훅은 음식 클로즈업 + 한 문장.`,
    pacing: '첫 한 입 클로즈업은 slow-mo, 나머지는 1.5~3초. 음식 원본 소리를 최대한 살리고 BGM은 낮게.',
    sfxLean: 'zoom(첫 입), pop(자막), ding(맛 평가), sparkle',
    bgmLean: 'calm-piano (BGM 볼륨 낮게)',
    grade: 'warm 또는 vivid (음식은 따뜻하게)',
  },
  '공간·오픈': {
    label: '공간 · 석촌 오픈 프로젝트',
    direction: `석촌 개인샵 오픈 과정 — 공사, 간판, 가구 배치, D-day 카운트, 첫 예약. 서사 비중이 큼. R01("만년 직원→원장")의 실사판.
훅은 D-day나 "여기가 제 샵이 됩니다".`,
    pacing: '스토리텔링. 도입→전개→클라이맥스→마무리 감정선. 컷 2.5~5초, 결정적 순간은 slow-mo + riser.',
    sfxLean: 'riser/drumroll(공개 직전), impact-big(공개), transition, sparkle, ding',
    bgmLean: 'calm-piano (감동) 또는 trust-corporate',
    grade: 'moody 또는 neutral',
  },
  '손님 후기': {
    label: '손님 후기',
    direction: `후기 캡처·낭독, 시술 전후 대비, 고객 반응. 신뢰가 핵심. 과장 없이 사실만.
훅은 후기 문장 한 줄을 크게.`,
    pacing: '후기 텍스트 컷은 읽을 시간(2.5~4초), 결과 컷은 zoom. 담백하게.',
    sfxLean: 'shutter, ding(후기 포인트), bell(긍정), pop',
    bgmLean: 'trust-corporate 또는 calm-piano',
    grade: 'neutral',
  },
  'Q&A·정보': {
    label: 'Q&A · 시술 정보',
    direction: `자주 묻는 질문, 시술 팁, 오해 바로잡기. 교육적이되 짧고 명확하게. "3초 만에 정리".
훅은 질문 그 자체("반영구 몇 년 가요?").`,
    pacing: '질문 컷 → 답 컷 리듬. 자막이 주인공. 컷 1.5~3초, 정보는 자막·손글씨로.',
    sfxLean: 'pop/bubble(자막), ding(정답), typing, click, transition',
    bgmLean: 'trust-corporate',
    grade: 'neutral',
  },
  '기타': {
    label: '기타 / 자유',
    direction: '유비 설명과 소스에 맞춰 자유롭게. 채널 톤(모노톤 어반 · 담백 · 셀프디스)만 유지.',
    pacing: '소스에 맞춰. 리듬감 있게 여러 샷으로.',
    sfxLean: 'transition, pop, zoom 중심으로 절제해서',
    bgmLean: '분위기에 맞게',
    grade: 'neutral 또는 moody',
  },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES)

export function categoryBlock(key) {
  const c = CATEGORIES[key] || CATEGORIES['기타']
  return `카테고리: ${c.label}
- 연출 방향: ${c.direction}
- 편집 톤: ${c.pacing}
- 효과음 성향: ${c.sfxLean}
- BGM 성향: ${c.bgmLean}
- 색보정 성향: ${c.grade}`
}
