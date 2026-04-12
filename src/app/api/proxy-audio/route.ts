import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url || !url.startsWith('https://')) {
    return NextResponse.json({ error: 'Missing or invalid url parameter' }, { status: 400 })
  }

  try {
    const res = await fetch(url)
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream fetch failed: ${res.status}` }, { status: 502 })
    }

    const contentType = res.headers.get('Content-Type') || 'audio/mpeg'
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    }
    const contentLength = res.headers.get('Content-Length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength

    return new Response(res.body, { status: 200, headers: responseHeaders })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
