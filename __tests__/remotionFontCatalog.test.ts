import { describe, expect, it } from 'vitest';
import {
  REMOTION_FONT_CATALOG_VERSION,
  internalRemotionFontFamily,
  prepareRemotionFontCode,
  remotionFontManifestUrlFromServeUrl,
  validateRemotionFontManifest,
  type RemotionFontCatalogManifest,
} from '@/remotion/font-catalog';

const SHA = 'a'.repeat(64);

function makeManifest(): RemotionFontCatalogManifest {
  const families = [
    'Inter',
    'Noto Sans SC',
    'Noto Serif SC',
    'Noto Color Emoji',
    'Ma Shan Zheng',
    'GFS Didot',
    'JetBrains Mono',
    'Caveat',
  ];
  return {
    version: REMOTION_FONT_CATALOG_VERSION,
    generatedAt: '2026-07-20T00:00:00.000Z',
    faces: families.map((family, index) => {
      const sha256 = `${index.toString(16)}`.repeat(64);
      return {
        family,
        internalFamily: internalRemotionFontFamily(family),
        style: 'normal' as const,
        weight: 400,
        subset: 'latin',
        unicodeRange: 'U+0000-FFFF',
        url: `https://example.test/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/assets/${sha256}.woff2`,
        sha256,
      };
    }),
  };
}

describe('Remotion shared font catalog', () => {
  it('derives the stable manifest URL from the deployed Remotion site', () => {
    expect(remotionFontManifestUrlFromServeUrl('https://example.test/sites/site-id/index.html')).toBe(
      `https://example.test/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`,
    );
  });

  it('accepts content-addressed assets and rejects mismatched filenames', () => {
    const valid = makeManifest();
    expect(validateRemotionFontManifest(valid)).toEqual(valid);

    const invalid = structuredClone(valid);
    invalid.faces[0].sha256 = SHA;
    expect(() => validateRemotionFontManifest(invalid)).toThrow('not content-addressed');
  });

  it('rewrites public font names to versioned internal family names', () => {
    const prepared = prepareRemotionFontCode({
      code: `const title = <div style={{fontFamily: 'Ma Shan Zheng, serif'}}>中文 Title</div>;`,
      manifest: makeManifest(),
    });

    expect(prepared.code).toContain(internalRemotionFontFamily('Ma Shan Zheng'));
    expect(prepared.code).toContain(internalRemotionFontFamily('Noto Serif SC'));
    expect(prepared.code).not.toContain("fontFamily: 'Ma Shan Zheng");
  });

  it('fails visibly for an unsupported local system font', () => {
    expect(() => prepareRemotionFontCode({
      code: `const title = <div style={{fontFamily: 'STKaiti, Kaiti SC, KaiTi, serif'}}>微信华章</div>;`,
      manifest: makeManifest(),
    })).toThrow('Unsupported Remotion font "STKaiti"');
  });

  it('uses only explicit persisted substitutions for a legacy design', () => {
    const prepared = prepareRemotionFontCode({
      code: `
        const title = <div style={{fontFamily: 'STKaiti, Kaiti SC, KaiTi, serif'}}>微信华章</div>;
        const english = <div style={{fontFamily: "Didot, Bodoni 72, Times New Roman, serif"}}>WECHAT</div>;
        const body = <div style={{fontFamily: 'Arial, PingFang SC, Microsoft YaHei, sans-serif'}}>中英正文</div>;
      `,
      manifest: makeManifest(),
      substitutions: {
        STKaiti: 'Ma Shan Zheng',
        Didot: 'GFS Didot',
        Arial: 'Inter',
      },
    });

    expect(prepared.usedFamilies).toEqual(expect.arrayContaining(['Ma Shan Zheng', 'GFS Didot', 'Inter']));
    expect(prepared.code).not.toMatch(/STKaiti|Didot,|Arial|PingFang|Microsoft YaHei/);
    expect(prepared.code).toContain(internalRemotionFontFamily('Ma Shan Zheng'));
    expect(prepared.code).toContain(internalRemotionFontFamily('GFS Didot'));
    expect(prepared.code).toContain(internalRemotionFontFamily('Inter'));
  });

  it('rejects dynamic font family expressions because they cannot be provisioned safely', () => {
    expect(() => prepareRemotionFontCode({
      code: 'const title = <div style={{fontFamily: `Inter, ${fallback}`}}>Title</div>;',
      manifest: makeManifest(),
    })).toThrow('Dynamic template fontFamily values are not supported');
  });
});
