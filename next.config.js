/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/render': ['./assets/fonts/**', './assets/bgm/**'],
  },
}

module.exports = nextConfig
