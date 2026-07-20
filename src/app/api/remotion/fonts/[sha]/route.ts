import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ sha: string }> },
) {
  const { sha } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    return new Response('Invalid font asset hash', { status: 400 });
  }

  try {
    const manifestUrl = resolveRemotionFontManifestUrl();
    const assetUrl = new URL(`assets/${sha}.woff2`, manifestUrl).toString();
    const response = await fetch(assetUrl, { next: { revalidate: 31536000 } });
    if (!response.ok || !response.body) {
      return new Response('Font asset not found', { status: response.status || 404 });
    }
    return new Response(response.body, {
      headers: {
        'Content-Type': 'font/woff2',
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[remotion-fonts] asset unavailable:', message);
    return new Response('Font asset unavailable', { status: 503 });
  }
}
