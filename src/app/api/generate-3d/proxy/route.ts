import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 120;

/** Proxy GLB/USDZ download to avoid CORS issues with Meshy CDN */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response('Unauthorized', { status: 401 });

    const url = req.nextUrl.searchParams.get('url');
    if (!url || !url.startsWith('https://assets.meshy.ai/')) {
      return new Response('Invalid URL', { status: 400 });
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const body = upstream.body;

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    console.error('[generate-3d/proxy] error:', e);
    return new Response('Proxy error', { status: 500 });
  }
}
