// Vercel Blob에 저장된 렌더 결과(renders/ 프리픽스)를 로컬 renders/ 폴더로 내려받는다.
//
//   node scripts/pull-renders.mjs            # 아직 없는 것만 받기
//   node scripts/pull-renders.mjs --all      # 이미 있어도 다시 받기
//   node scripts/pull-renders.mjs --prefix sources/   # 다른 프리픽스
//
// BLOB_READ_WRITE_TOKEN 은 .env.local 에서 읽는다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { list } from '@vercel/blob'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

async function loadEnv() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return
  try {
    const raw = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // .env.local 없으면 환경변수에 의존
  }
}

async function main() {
  await loadEnv()
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN 이 없습니다 (.env.local 또는 환경변수).')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const forceAll = args.includes('--all')
  const prefixArg = args[args.indexOf('--prefix') + 1]
  const prefix = args.includes('--prefix') && prefixArg ? prefixArg : 'renders/'

  const outDir = path.join(ROOT, 'renders')
  await fs.mkdir(outDir, { recursive: true })

  let cursor
  let total = 0
  let downloaded = 0
  do {
    const res = await list({ prefix, cursor, limit: 1000 })
    for (const blob of res.blobs) {
      total++
      const name = blob.pathname.slice(prefix.length) || path.basename(blob.pathname)
      const dest = path.join(outDir, name)
      if (!forceAll) {
        try {
          const stat = await fs.stat(dest)
          if (stat.size === blob.size) continue
        } catch {
          // 없음 → 받는다
        }
      }
      const r = await fetch(blob.url)
      if (!r.ok) {
        console.warn(`  ! ${blob.pathname} 다운로드 실패 (${r.status})`)
        continue
      }
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()))
      downloaded++
      console.log(`  ↓ ${name}  (${(blob.size / 1024 / 1024).toFixed(1)}MB, ${blob.uploadedAt})`)
    }
    cursor = res.cursor
  } while (cursor)

  console.log(`\n완료: ${prefix} 아래 ${total}개 중 ${downloaded}개 내려받음 → ${outDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
