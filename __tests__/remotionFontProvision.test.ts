import { describe, expect, it } from 'vitest';
import { collectRemotionFontSourceFaces } from '@/lib/remotion-font-provision';
import { REMOTION_FONT_CATALOG, internalRemotionFontFamily } from '@/remotion/font-catalog';

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
});
