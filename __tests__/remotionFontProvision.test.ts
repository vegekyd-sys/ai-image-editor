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
});
