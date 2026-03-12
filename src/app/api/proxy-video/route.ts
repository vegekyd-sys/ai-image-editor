import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  // Download mode: ?download=1 (used by save button)
  const isDownload = req.nextUrl.searchParams.get('download') === '1'

  try {
    const range = req.headers.get('range')
    const fetchHeaders: HeadersInit = {}
    if (range) fetchHeaders['Range'] = range

    const res = await fetch(url, { headers: fetchHeaders })
    if (!res.ok && res.status !== 206) {
      return NextResponse.json({ error: `Fetch failed: ${res.status}` }, { status: 502 })
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': res.headers.get('Content-Type') || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }
    if (isDownload) {
      responseHeaders['Content-Disposition'] = 'attachment; filename="makaron-video.mp4"'
    }
    const contentLength = res.headers.get('Content-Length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength
    const contentRange = res.headers.get('Content-Range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange

    // Stream the response body directly (supports Range-based seeking)
    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
