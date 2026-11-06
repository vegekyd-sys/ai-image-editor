import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internalRemotionFontFamily, REMOTION_FONT_CATALOG_VERSION } from '@/remotion/font-catalog';

const authenticateRequest = vi.fn();
const provisionRemotionFontFamilies = vi.fn();
const findProvisionedRemotionFontManifest = vi.fn();

vi.mock('@/lib/api-auth', () => ({ authenticateRequest }));
vi.mock('@/lib/remotion-font-provision', () => ({
  provisionRemotionFontFamilies,
  findProvisionedRemotionFontManifest,
}));

const SERVE_URL = 'https://bucket.s3.us-east-1.amazonaws.com/sites/test-site/index.html';
const BASE_MANIFEST_URL = `https://bucket.s3.us-east-1.amazonaws.com/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`;

function face(family: string, weight: number, sha: string) {
  const sha256 = sha.repeat(64);
  return {
    family,
    internalFamily: internalRemotionFontFamily(family),
    style: 'normal',
    weight,
    subset: '[0]',
    unicodeRange: 'U+4E00-9FFF',
    sha256,
    url: `https://bucket.s3.us-east-1.amazonaws.com/assets/${sha256}.woff2`,
  };
}

const baseManifest = {
  version: REMOTION_FONT_CATALOG_VERSION,
  faces: [face('Noto Sans SC', 900, 'a')],
};

function postFonts(code: string) {
  return new Request('http://localhost/api/remotion/fonts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, props: {}, fontSubstitutions: {} }),
  });
}

describe('Remotion font manifest for signed-out viewers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('REMOTION_LAMBDA_SERVE_URL', SERVE_URL);
    vi.stubEnv('REMOTION_FONT_MANIFEST_URL', '');
    authenticateRequest.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === BASE_MANIFEST_URL) return new Response(JSON.stringify(baseManifest), { status: 200 });
      return new Response('not found', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    authenticateRequest.mockReset();
    provisionRemotionFontFamilies.mockReset();
    findProvisionedRemotionFontManifest.mockReset();
  });

  it('serves the pinned catalog so a signed-out preview renders the same CJK face as export', async () => {
    const { POST } = await import('@/app/api/remotion/fonts/route');
    const response = await POST(postFonts(
      `<div style={{fontFamily: "'Noto Sans SC', sans-serif", fontWeight: 900}}>清迈的快乐</div>`,
    ) as never);

    expect(response.status).toBe(200);
    const manifest = await response.json();
    expect(manifest.faces).toEqual([
      expect.objectContaining({
        family: 'Noto Sans SC',
        weight: 900,
        url: `/api/remotion/fonts/${'a'.repeat(64)}`,
      }),
    ]);
    expect(provisionRemotionFontFamilies).not.toHaveBeenCalled();
  });

  it('reuses on-demand fonts the author already published without provisioning new ones', async () => {
    findProvisionedRemotionFontManifest.mockResolvedValue({
      manifestUrl: 'https://bucket.s3.us-east-1.amazonaws.com/derived.json',
      manifest: { ...baseManifest, faces: [...baseManifest.faces, face('Lobster Two', 400, 'b')] },
    });
    const { POST } = await import('@/app/api/remotion/fonts/route');
    const response = await POST(postFonts(`<div style={{fontFamily: 'Lobster Two, cursive'}}>Hi</div>`) as never);

    expect(response.status).toBe(200);
    expect((await response.json()).faces.map((entry: { family: string }) => entry.family))
      .toEqual(['Noto Sans SC', 'Lobster Two']);
    expect(findProvisionedRemotionFontManifest).toHaveBeenCalledWith(expect.objectContaining({
      families: ['Lobster Two'],
    }));
    expect(provisionRemotionFontFamilies).not.toHaveBeenCalled();
  });

  it('falls back to the catalog when an on-demand font was never published', async () => {
    findProvisionedRemotionFontManifest.mockResolvedValue(null);
    const { POST } = await import('@/app/api/remotion/fonts/route');
    const response = await POST(postFonts(`<div style={{fontFamily: 'Lobster Two, cursive'}}>Hi</div>`) as never);

    expect(response.status).toBe(200);
    expect((await response.json()).faces.map((entry: { family: string }) => entry.family)).toEqual(['Noto Sans SC']);
    expect(provisionRemotionFontFamilies).not.toHaveBeenCalled();
  });

  it('still provisions on-demand fonts for signed-in authors', async () => {
    authenticateRequest.mockResolvedValue({ auth: { userId: 'user-1' } });
    provisionRemotionFontFamilies.mockResolvedValue({
      manifestUrl: 'https://bucket.s3.us-east-1.amazonaws.com/derived.json',
      manifest: { ...baseManifest, faces: [...baseManifest.faces, face('Lobster Two', 400, 'b')] },
    });
    const { POST } = await import('@/app/api/remotion/fonts/route');
    const response = await POST(postFonts(`<div style={{fontFamily: 'Lobster Two, cursive'}}>Hi</div>`) as never);

    expect(response.status).toBe(200);
    expect(provisionRemotionFontFamilies).toHaveBeenCalledWith(expect.objectContaining({ families: ['Lobster Two'] }));
    expect(findProvisionedRemotionFontManifest).not.toHaveBeenCalled();
  });
});
