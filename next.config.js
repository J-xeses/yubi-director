/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'],
  outputFileTracingIncludes: {
    '/api/render': ['./assets/fonts/**', './assets/bgm/**'],
  },
}

module.exports = nextConfig
