// @vitest-environment node
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ create: vi.fn(), resolve: vi.fn() }));
vi.mock('fontkit', () => ({ create: h.create }));
vi.mock('@/lib/remotion-font-resolver', () => ({ resolveRemotionFontManifestForDesign: h.resolve }));
import { fitLayerizeText, layerizeFontCandidates, layerizeMatchingFaces } from '@/lib/layerize-text-fit';
import type { RemotionFontCatalogFace } from '@/remotion/font-catalog';
const face = (subset: string): RemotionFontCatalogFace => ({ family: 'Noto Sans SC', internalFamily: 'pinned-cjk', style: 'normal', weight: 400,
  subset, unicodeRange: subset === 'a' ? 'U+7532,U+31' : 'U+4E59', url: `https://example.test/${subset}.woff2`, sha256: `fixture-${subset}` });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('keeps CJK subsets and chooses a CJK family instead of measuring missing glyphs in Latin fonts', async () => {
  h.resolve.mockResolvedValue({ manifest: { faces: [face('a'), face('b')] } });
  const faces = await layerizeMatchingFaces(['MiSans'], ['甲乙1']);
  expect(faces).toHaveLength(2);
  expect(layerizeFontCandidates('MiSans', '甲乙1')).toEqual(['Noto Sans SC']);
  expect(layerizeFontCandidates('Ma Shan Zheng', '甲乙')).toEqual(['Ma Shan Zheng']);
});
it('assembles glyphs across unicode subsets and retains uniform CJK shape scaling', async () => {
  h.create.mockImplementation((bytes: Buffer) => {
    const subset = bytes.toString();
    const has = (cp: number) => (subset === 'a' ? ['甲', '1'] : ['乙']).some(c => c.codePointAt(0) === cp);
    return { unitsPerEm: 1000, hasGlyphForCodePoint: has, layout: (text: string) => ({
      glyphs: Array.from(text).map(c => { const w = c === '1' ? 500 : 900; return { bbox: { minX: 0, minY: 0, maxX: w, maxY: 900 }, path: { toSVG: () => `M0 0H${w}V900H0Z` } }; }),
      positions: Array.from(text).map(c => ({ xAdvance: c === '1' ? 600 : 1000, xOffset: 0, yOffset: 0 })),
    }) };
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('/a.') ? 'a' : 'b')));
  const target = await sharp(Buffer.from('<svg width="81" height="33"><g fill="white"><rect x="3" y="3" width="27" height="27"/><rect x="33" y="3" width="27" height="27"/><rect x="63" y="3" width="15" height="27"/></g></svg>')).png().toBuffer();
  const fit = await fitLayerizeText(target, '甲乙1', 'MiSans', '#112233', [face('a'), face('b')]);
  expect(fit).not.toBeNull();
  expect(fit!.matrix[0]).toBeCloseTo(fit!.matrix[3], 6);
  expect(fit!.matrix[1]).toBe(0); expect(fit!.matrix[2]).toBe(0);
  expect(fit!.advances).toEqual({ 甲: 1000, 乙: 1000, '1': 600 });
  expect(fit!.score).toBeGreaterThan(.9);
});
