import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectRemotionFontSourceFaces,
  collectRemotionFontSourceFacesForFamilies,
  findProvisionedRemotionFontManifest,
} from '@/lib/remotion-font-provision';
import { REMOTION_FONT_CATALOG, REMOTION_FONT_CATALOG_VERSION, internalRemotionFontFamily } from '@/remotion/font-catalog';

describe('Remotion deploy-time font provisioner', () => {
  it('resolves every catalog family and requested weight without network access', async () => {
    const faces = await collectRemotionFontSourceFaces();
    expect(faces.length).toBeGreaterThan(1000);
    for (const definition of REMOTION_FONT_CATALOG) {
      for (const weight of definition.weights) {
        const matching = faces.filter((face) => face.family === definition.family && face.weight === weight);
        expect(matching.length, `${definition.family} ${weight}`).toBeGreaterThan(0);
        expect(matching.every((face) => face.internalFamily === internalRemotionFontFamily(definition.family))).toBe(true);
        expect(matching.every((face) => face.sourceUrl.startsWith('https://fonts.gstatic.com/'))).toBe(true);
      }
    }
  });

  it('includes a pinned glyph for the plain four-pointed-star icon used by compositions', async () => {
    const faces = await collectRemotionFontSourceFaces();
    const codePoint = 0x2726;
    const symbolFaces = faces.filter((face) => face.family === 'Noto Sans Symbols 2');
    const coversCodePoint = (unicodeRange: string) => unicodeRange.split(',').some((part) => {
      const [startRaw, endRaw = startRaw] = part.trim().replace(/^U\+/i, '').split('-');
      return codePoint >= Number.parseInt(startRaw, 16) && codePoint <= Number.parseInt(endRaw, 16);
    });

    expect(symbolFaces.some((face) => coversCodePoint(face.unicodeRange))).toBe(true);
  });

  it('discovers all normal faces for an arbitrary Google Font outside the base catalog', async () => {
    const faces = await collectRemotionFontSourceFacesForFamilies(['Bungee Spice']);

    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((face) => face.family === 'Bungee Spice')).toBe(true);
    expect(faces.every((face) => face.sourceUrl.startsWith('https://fonts.gstatic.com/'))).toBe(true);
  });

  describe('read-only lookup for signed-out preview', () => {
    afterEach(() => vi.unstubAllGlobals());
    const serveUrl = 'https://bucket.s3.us-east-1.amazonaws.com';
    const sha = 'c'.repeat(64);
    const derived = {
      version: REMOTION_FONT_CATALOG_VERSION,
      faces: [{
        family: 'Lobster Two',
        internalFamily: internalRemotionFontFamily('Lobster Two'),
        style: 'normal',
        weight: 400,
        subset: '[0]',
        unicodeRange: 'U+0000-00FF',
        sha256: sha,
        url: `${serveUrl}/assets/${sha}.woff2`,
      }],
    };

    it('reads the deterministic derived manifest the author already published', async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(derived), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const found = await findProvisionedRemotionFontManifest({ serveUrl, families: ['lobster two'] });

      expect(found?.manifest.faces[0].family).toBe('Lobster Two');
      expect(found?.manifestUrl).toMatch(
        new RegExp(`^${serveUrl}/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifests/[a-f0-9]{64}\\.json$`),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns null instead of provisioning when nothing was published', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 403 })));

      await expect(findProvisionedRemotionFontManifest({ serveUrl, families: ['Lobster Two'] })).resolves.toBeNull();
    });

    it('needs no lookup for catalog families', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(findProvisionedRemotionFontManifest({ serveUrl, families: ['Noto Sans SC'] })).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
