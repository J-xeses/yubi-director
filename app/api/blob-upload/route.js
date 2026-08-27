import { handleUpload } from '@vercel/blob/client'

export async function POST(request) {
  const body = await request.json()

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['video/*', 'image/*', 'audio/*'],
        addRandomSuffix: true,
        maximumSizeInBytes: 200 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {},
    })
    return Response.json(jsonResponse)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 })
  }
}
