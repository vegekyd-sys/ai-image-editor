import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest';
import { resolveRemotionFontManifestUrlForDesign } from '@/lib/remotion-font-resolver';
import { validateRemotionFontManifest } from '@/remotion/font-catalog';

export const runtime = 'nodejs';

async function browserManifest(manifestUrl: string) {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Font manifest upstream returned ${response.status}`);
  }
  const manifest = validateRemotionFontManifest(await response.json());
  return {
    ...manifest,
    faces: manifest.faces.map((face) => ({
      ...face,
      // Keep browser font assets same-origin. An absolute localhost URL here
      // points at the phone itself when a local preview is opened over LAN.
      url: `/api/remotion/fonts/${face.sha256}`,
    })),
  };
}

export async function GET() {
  try {
    const manifestUrl = resolveRemotionFontManifestUrl();
    return NextResponse.json(await browserManifest(manifestUrl), {
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

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if ('error' in authResult) return authResult.error;
    const body = await request.json() as {
      code?: unknown;
      props?: unknown;
      fontSubstitutions?: unknown;
    };
    if (typeof body.code !== 'string') {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }
    const manifestUrl = await resolveRemotionFontManifestUrlForDesign({
      code: body.code,
      props: body.props && typeof body.props === 'object'
        ? body.props as Record<string, unknown>
        : {},
      substitutions: body.fontSubstitutions && typeof body.fontSubstitutions === 'object'
        ? body.fontSubstitutions as Record<string, string>
        : {},
    });
    return NextResponse.json(await browserManifest(manifestUrl), {
      headers: { 'Cache-Control': 'private, no-cache' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[remotion-fonts] dynamic manifest unavailable:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
