import { NextResponse } from 'next/server';
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest';
import { validateRemotionFontManifest } from '@/remotion/font-catalog';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const manifestUrl = resolveRemotionFontManifestUrl();
    const response = await fetch(manifestUrl, { next: { revalidate: 300 } });
    if (!response.ok) {
      throw new Error(`Font manifest upstream returned ${response.status}`);
    }
    const manifest = validateRemotionFontManifest(await response.json());
    const browserManifest = {
      ...manifest,
      faces: manifest.faces.map((face) => ({
        ...face,
        url: new URL(`/api/remotion/fonts/${face.sha256}`, request.url).toString(),
      })),
    };
    return NextResponse.json(browserManifest, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[remotion-fonts] manifest unavailable:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
