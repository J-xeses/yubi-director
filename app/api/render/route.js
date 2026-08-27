import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { put } from '@vercel/blob'
import { FFMPEG, run } from '../../../lib/media'

export const maxDuration = 120

const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-Bold.ttf')
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'])

// 내장 무료 라이선스 BGM 라이브러리 (Pixabay Content License, 별도 업로드 없이 기본 제공)
const BGM_LIBRARY = {
  'calm-piano': path.join(process.cwd(), 'assets', 'bgm', 'calm-piano.mp3'),
  'upbeat-reel': path.join(process.cwd(), 'assets', 'bgm', 'upbeat-reel.mp3'),
  'trust-corporate': path.join(process.cwd(), 'assets', 'bgm', 'trust-corporate.mp3'),
}

const FADE_DUR = 0.3 // 컷 경계 페이드 길이(초) — xfade 필터는 번들 ffmpeg 버전에 없어
                      // 클립별 fade in/out(디졸브 느낌의 블랙 페이드)으로 대체

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
  const { clips, captions = [], bgmUrl, bgmKey, totalDuration } = await request.json()

  if (!Array.isArray(clips) || clips.length === 0) {
    return Response.json({ error: '클립이 없습니다.' }, { status: 400 })
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yubi-'))

  try {
    // 1) 클립 다운로드
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

    // 2) BGM 준비: 사용자가 직접 올린 파일이 있으면 그걸 쓰고,
    //    없으면 내장 라이브러리(bgmKey)에서 기본 제공
    let bgmPath = null
    if (bgmUrl) {
      bgmPath = path.join(workDir, `bgm${extOf(bgmUrl)}`)
      await downloadTo(bgmUrl, bgmPath)
    } else if (bgmKey && BGM_LIBRARY[bgmKey]) {
      bgmPath = BGM_LIBRARY[bgmKey]
    }

    // 3) 클립별 개별 트림/스케일 필터
    const inputArgs = []
    const filterParts = []

    const concatLabels = []
    localClips.forEach((clip, i) => {
      if (clip.isImage) {
        inputArgs.push('-loop', '1', '-t', String(clip.duration), '-framerate', '30', '-i', clip.path)
      } else {
        inputArgs.push('-i', clip.path)
      }

      // 컷 경계에 짧은 페이드(디졸브 느낌)를 넣는다 — 첫 클립은 시작에 fade-in
      // 생략, 마지막 클립은 끝에 fade-out 생략(전체 영상 시작/끝은 하드컷 유지)
      const fd = Math.max(0.1, Math.min(FADE_DUR, clip.duration / 3))
      const vFades = []
      const aFades = []
      if (i > 0) {
        vFades.push(`fade=t=in:st=0:d=${fd.toFixed(2)}`)
        aFades.push(`afade=t=in:st=0:d=${fd.toFixed(2)}`)
      }
      if (i < localClips.length - 1) {
        const st = Math.max(0, clip.duration - fd)
        vFades.push(`fade=t=out:st=${st.toFixed(2)}:d=${fd.toFixed(2)}`)
        aFades.push(`afade=t=out:st=${st.toFixed(2)}:d=${fd.toFixed(2)}`)
      }
      const vFadeStr = vFades.length ? ',' + vFades.join(',') : ''
      const aFadeStr = aFades.length ? ',' + aFades.join(',') : ''

      filterParts.push(
        `[${i}:v]trim=0:${clip.duration},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30${vFadeStr}[v${i}]`
      )

      if (clip.isImage) {
        filterParts.push(`anullsrc=r=44100:cl=stereo,atrim=0:${clip.duration}${aFadeStr}[a${i}]`)
      } else {
        filterParts.push(
          `[${i}:a]atrim=0:${clip.duration},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo${aFadeStr}[a${i}]`
        )
      }
      concatLabels.push(`[v${i}][a${i}]`)
    })

    filterParts.push(`${concatLabels.join('')}concat=n=${localClips.length}:v=1:a=1[vraw0][araw0]`)
    const joinedVideo = 'vraw0'
    const joinedAudio = 'araw0'

    // 5) 자막 drawtext 체인
    // 자막 텍스트는 명령줄 인자로 넘기면 Windows 콘솔 코드페이지 문제로
    // 한글이 깨지는 경우가 있어(spawn 인자 인코딩 이슈), UTF-8 파일에 써서
    // drawtext의 textfile= 옵션으로 읽게 한다 — 인코딩 문제와 특수문자
    // 이스케이핑 문제를 동시에 회피한다.
    let videoLabel = joinedVideo
    if (captions.length > 0) {
      let chain = `[${joinedVideo}]`
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

    // 6) BGM 믹싱
    let audioLabel = joinedAudio
    if (bgmPath) {
      const bgmIndex = localClips.length
      inputArgs.push('-stream_loop', '-1', '-i', bgmPath)
      filterParts.push(
        `[${bgmIndex}:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,volume=0.18[bgmtrim]`,
        `[${joinedAudio}][bgmtrim]amix=inputs=2:duration=first:dropout_transition=0[amixed]`
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

    // 7) 결과 업로드
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
