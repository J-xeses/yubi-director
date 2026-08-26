import './globals.css'

export const metadata = {
  title: '유비 디렉터',
  description: '영상 소스 설명 → 릴스 연출 제안 → 편집 지시서',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
