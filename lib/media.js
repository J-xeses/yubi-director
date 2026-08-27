import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import ffprobePath from '@ffprobe-installer/ffprobe'
import { spawn } from 'child_process'

export const FFMPEG = ffmpegPath.path
export const FFPROBE = ffprobePath.path

export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-2000)}`))
    })
  })
}

export async function probeDuration(filePath) {
  const stderr = await new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    let out = ''
    proc.stdout.on('data', (d) => { out += d.toString() })
    proc.on('error', reject)
    proc.on('close', () => resolve(out))
  })
  const val = parseFloat(stderr.trim())
  return Number.isFinite(val) ? val : null
}
