import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

function isGoogleGenerativeFileDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'generativelanguage.googleapis.com'
      && parsed.pathname.startsWith('/v1beta/files/')
      && parsed.pathname.endsWith(':download')
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  // Download mode: ?download=1 (used by save button)
  const isDownload = req.nextUrl.searchParams.get('download') === '1'
  // Full mode: ?full=1 (used by export — need complete file, no Range)
  const isFull = req.nextUrl.searchParams.get('full') === '1'

  try {
    const range = !isFull ? req.headers.get('range') : null
    const fetchHeaders: HeadersInit = {}
    if (range) fetchHeaders['Range'] = range
    if (isGoogleGenerativeFileDownloadUrl(url) && process.env.GOOGLE_API_KEY) {
      fetchHeaders['x-goog-api-key'] = process.env.GOOGLE_API_KEY
    }

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
