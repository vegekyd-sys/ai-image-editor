import { NextResponse } from 'next/server';
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest';
import { validateRemotionFontManifest } from '@/remotion/font-catalog';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const manifestUrl = resolveRemotionFontManifestUrl();
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Font manifest upstream returned ${response.status}`);
    }
    const manifest = validateRemotionFontManifest(await response.json());
    const browserManifest = {
      ...manifest,
      faces: manifest.faces.map((face) => ({
        ...face,
        // Keep browser font assets same-origin. An absolute localhost URL here
        // points at the phone itself when a local preview is opened over LAN.
        url: `/api/remotion/fonts/${face.sha256}`,
      })),
    };
    return NextResponse.json(browserManifest, {
      headers: {
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[remotion-fonts] manifest unavailable:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
