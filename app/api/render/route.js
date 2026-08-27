import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { put } from '@vercel/blob'
import { FFMPEG, run } from '../../../lib/media'

export const maxDuration = 120

const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-Bold.ttf')
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'])

function extOf(url) {
  const clean = url.split('?')[0]
  const ext = path.extname(clean).toLowerCase()
  return ext || '.mp4'
}

async function downloadTo(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`다운로드 실패 (${res.status}): ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(destPath, buf)
}

export async function POST(request) {
  const { clips, captions = [], bgmUrl, totalDuration } = await request.json()

  if (!Array.isArray(clips) || clips.length === 0) {
    return Response.json({ error: '클립이 없습니다.' }, { status: 400 })
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yubi-'))

  try {
    // 1) 클립/BGM 다운로드
    const localClips = []
    for (let i = 0; i < clips.length; i++) {
      const ext = extOf(clips[i].url)
      const dest = path.join(workDir, `clip${i}${ext}`)
      await downloadTo(clips[i].url, dest)
      localClips.push({
        path: dest,
        isImage: IMAGE_EXT.has(ext),
        duration: Math.max(0.3, Number(clips[i].duration) || 3),
      })
    }

    let bgmPath = null
    if (bgmUrl) {
      bgmPath = path.join(workDir, `bgm${extOf(bgmUrl)}`)
      await downloadTo(bgmUrl, bgmPath)
    }

    // 2) ffmpeg 입력/필터 그래프 구성
    const inputArgs = []
    const filterParts = []
    const concatLabels = []

    localClips.forEach((clip, i) => {
      if (clip.isImage) {
        inputArgs.push('-loop', '1', '-t', String(clip.duration), '-framerate', '30', '-i', clip.path)
      } else {
        inputArgs.push('-i', clip.path)
      }

      filterParts.push(
        `[${i}:v]trim=0:${clip.duration},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v${i}]`
      )

      if (clip.isImage) {
        filterParts.push(`anullsrc=r=44100:cl=stereo,atrim=0:${clip.duration}[a${i}]`)
      } else {
        // 비디오에 오디오 트랙이 없을 수도 있으므로 무음 트랙으로 대체하는 대신
        // amerge 대신 aformat + apad 조합으로 안전하게 처리
        filterParts.push(
          `[${i}:a]atrim=0:${clip.duration},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`
        )
      }
      concatLabels.push(`[v${i}][a${i}]`)
    })

    filterParts.push(`${concatLabels.join('')}concat=n=${localClips.length}:v=1:a=1[vraw][araw]`)

    // 3) 자막 drawtext 체인
    // 자막 텍스트는 명령줄 인자로 넘기면 Windows 콘솔 코드페이지 문제로
    // 한글이 깨지는 경우가 있어(spawn 인자 인코딩 이슈), UTF-8 파일에 써서
    // drawtext의 textfile= 옵션으로 읽게 한다 — 인코딩 문제와 특수문자
    // 이스케이핑 문제를 동시에 회피한다.
    let videoLabel = 'vraw'
    if (captions.length > 0) {
      let chain = `[vraw]`
      for (let idx = 0; idx < captions.length; idx++) {
        const cap = captions[idx]
        const capFile = path.join(workDir, `cap${idx}.txt`)
        await fs.writeFile(capFile, String(cap.text || ''), 'utf-8')
        const isLast = idx === captions.length - 1
        const safeFontPath = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:')
        const safeCapPath = capFile.replace(/\\/g, '/').replace(/:/g, '\\:')
        chain += `drawtext=fontfile='${safeFontPath}':textfile='${safeCapPath}':enable='between(t\\,${cap.start}\\,${cap.end})':x=(w-text_w)/2:y=h-320:fontsize=58:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=24`
        chain += isLast ? `[vout]` : `,`
      }
      filterParts.push(chain)
      videoLabel = 'vout'
    }

    // 4) BGM 믹싱
    let audioLabel = 'araw'
    if (bgmPath) {
      const bgmIndex = localClips.length
      inputArgs.push('-stream_loop', '-1', '-i', bgmPath)
      filterParts.push(
        `[${bgmIndex}:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,volume=0.18[bgmtrim]`,
        `[araw][bgmtrim]amix=inputs=2:duration=first:dropout_transition=0[amixed]`
      )
      audioLabel = 'amixed'
    }

    const outPath = path.join(workDir, 'output.mp4')
    const ffArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterParts.join(';'),
      '-map', `[${videoLabel}]`,
      '-map', `[${audioLabel}]`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k',
      '-r', '30',
      outPath,
    ]

    await run(FFMPEG, ffArgs)

    // 5) 결과 업로드
    const outBuf = await fs.readFile(outPath)
    const blob = await put(`renders/${Date.now()}.mp4`, outBuf, {
      access: 'public',
      contentType: 'video/mp4',
    })

    return Response.json({ url: blob.url })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
