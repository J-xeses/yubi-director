// R01 전처리 프레임 5장을 Vercel Blob에 업로드하고 URL 출력
import { put } from '@vercel/blob'
import { readFile } from 'fs/promises'
import path from 'path'

const token = (await readFile(path.join(process.cwd(), '.env.local'), 'utf8'))
  .split('\n').find((l) => l.startsWith('BLOB_READ_WRITE_TOKEN='))
  .split('=')[1].trim().replace(/^["']|["']$/g, '')

const DIR = process.argv[2]
const names = ['C01', 'C02', 'C03', 'C04-3', 'C05']
const out = {}
for (const n of names) {
  const buf = await readFile(path.join(DIR, `${n}.jpg`))
  const b = await put(`r01-src/${n}-${Date.now()}.jpg`, buf, {
    access: 'public', contentType: 'image/jpeg', token, addRandomSuffix: true,
  })
  out[n] = b.url
  console.error(`${n} -> ${b.url}`)
}
console.log(JSON.stringify(out, null, 2))
