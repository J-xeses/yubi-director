import path from 'path'
import fs from 'fs'

// 번들 효과음 라이브러리 (assets/sfx/). yeori-studio "AI연구소 효과음 모음집" 가이드에서
// 릴스에 자주 쓰는 것만 추린 세트. 키 = AI가 edit-plan 에서 고르는 이름.
const DIR = path.join(process.cwd(), 'assets', 'sfx')

// 키 → { file, gain, guide }
export const SFX_LIBRARY = {
  transition:   { file: 'transition.wav', gain: 0.5,  guide: '장면 전환 · 자막 등장. 가장 무난. 분기점에만.' },
  whoosh:       { file: 'whoosh.wav',     gain: 0.5,  guide: '전환. transition보다 약간 길고 부드러움.' },
  zoom:         { file: 'zoom.wav',       gain: 0.55, guide: '줌인/줌아웃 강조. 표정·디테일 클로즈업 순간.' },
  pop:          { file: 'pop.wav',        gain: 0.55, guide: '자막·이미지가 톡 튀어오를 때. 키워드 강조.' },
  bubble:       { file: 'bubble.wav',     gain: 0.5,  guide: '짧은 단어 강조. 가벼운 정보 전달.' },
  click:        { file: 'click.wav',      gain: 0.55, guide: '선택·결정·탭. 화면 터치 묘사.' },
  ding:         { file: 'ding.mp3',       gain: 0.55, guide: '정답·깨달음·핵심 정보. "아, 이거구나" 순간.' },
  bell:         { file: 'bell.mp3',       gain: 0.5,  guide: '밝은 알림 · 좋은 소식 · 긍정적 전환.' },
  shutter:      { file: 'shutter.wav',    gain: 0.55, guide: '카메라 셔터. 사진·Before/After·결과 강조.' },
  impact:       { file: 'impact.wav',     gain: 0.7,  guide: '가벼운 임팩트. 자막 크게 띄울 때, 짧은 강조.' },
  'impact-big': { file: 'impact-big.mp3', gain: 0.75, guide: '큰 임팩트. 결정적 순간·반전·최고조. 영상당 1번.' },
  riser:        { file: 'riser.mp3',      gain: 0.5,  guide: '빌드업. 결과 공개·클라이맥스 직전에 깔기.' },
  drumroll:     { file: 'drumroll.mp3',   gain: 0.5,  guide: '결과·진실 공개 직전 긴장. riser 대신 코믹·기대 톤.' },
  scratch:      { file: 'scratch.wav',    gain: 0.55, guide: '레코드 스크래치. 분위기 깨기·갑작스런 전환·"응?"' },
  typing:       { file: 'typing.mp3',     gain: 0.4,  guide: '키보드 타이핑. 메시지·자막 작성 연출. 살짝 길게.' },
  sparkle:      { file: 'sparkle.mp3',    gain: 0.45, guide: '반짝·마법 알림. 신비로운 깨달음·좋은 소식·꾸밈.' },
  fail:         { file: 'fail.mp3',       gain: 0.65, guide: '실패 드럼. 낙담·실수 코믹하게. 셀프디스 순간.' },
  'sad-trombone': { file: 'sad-trombone.mp3', gain: 0.6, guide: '실망 트롬본. 기대 깨짐·허탈함. 대표 코믹.' },
}

export const SFX_KEYS = Object.keys(SFX_LIBRARY)

// AI 프롬프트에 넣을 목록 텍스트
export const SFX_GUIDE_TEXT = SFX_KEYS.map((k) => `  - "${k}": ${SFX_LIBRARY[k].guide}`).join('\n')

export function sfxPath(key) {
  const entry = SFX_LIBRARY[key]
  if (!entry) return null
  const p = path.join(DIR, entry.file)
  return fs.existsSync(p) ? p : null
}
