import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REMOTION_FONT_CATALOG_VERSION,
  internalRemotionFontFamily,
  loadPreparedRemotionFonts,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives the stable manifest URL from the deployed Remotion site', () => {
    expect(remotionFontManifestUrlFromServeUrl('https://example.test/sites/site-id/index.html')).toBe(
      `https://example.test/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`,
    );
  });

  it('accepts content-addressed assets and rejects mismatched filenames', () => {
    const valid = makeManifest();
    expect(validateRemotionFontManifest(valid)).toEqual(valid);

    const proxied = structuredClone(valid);
    proxied.faces[0].url = `https://app.example.test/api/remotion/fonts/${proxied.faces[0].sha256}`;
    expect(validateRemotionFontManifest(proxied)).toEqual(proxied);

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

  it('pins catalog fonts passed through helper props under their public family names', async () => {
    class MockFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}

      async load() {
        return this;
      }
    }
    vi.stubGlobal('FontFace', MockFontFace);
    const fonts = {
      ready: Promise.resolve(),
      add: vi.fn(),
      check: vi.fn(() => true),
    };
    const targetDocument = { fonts } as unknown as Document;
    const manifest = makeManifest();
    const code = `
      function Title({ chineseFont }) {
        return <div style={{fontFamily: chineseFont + ', Noto Sans SC'}}>风起字生光</div>;
      }
      const title = <Title chineseFont="Ma Shan Zheng" />;
    `;
    const prepared = prepareRemotionFontCode({ code, manifest });

    expect(prepared.dynamicFamilyAliases).toContainEqual({
      alias: 'Ma Shan Zheng',
      family: 'Ma Shan Zheng',
    });
    expect(prepared.usedFamilies).toContain('Ma Shan Zheng');

    const timing = await loadPreparedRemotionFonts({
      manifest,
      prepared,
      text: code,
      targetDocument,
    });
    const registeredFamilies = fonts.add.mock.calls.map(([face]) => face.family);
    expect(registeredFamilies).toContain('Ma Shan Zheng');
    expect(registeredFamilies).toContain(internalRemotionFontFamily('Ma Shan Zheng'));
    expect(timing.faceCount).toBe(registeredFamilies.length);
  });

  it('pins catalog fonts supplied through persisted composition props', () => {
    const prepared = prepareRemotionFontCode({
      code: `
        function Title({ chineseFont }) {
          return <div style={{fontFamily: chineseFont}}>云影落长安</div>;
        }
        const title = <Title chineseFont={props.fontOne} />;
      `,
      props: {
        fontOne: 'Ma Shan Zheng',
      },
      manifest: makeManifest(),
    });

    expect(prepared.dynamicFamilyAliases).toContainEqual({
      alias: 'Ma Shan Zheng',
      family: 'Ma Shan Zheng',
    });
    expect(prepared.usedFamilies).toContain('Ma Shan Zheng');
  });

  it('records cold and document-cache font loading timings', async () => {
    class MockFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}

      async load() {
        return this;
      }
    }
    vi.stubGlobal('FontFace', MockFontFace);
    const fonts = {
      ready: Promise.resolve(),
      add: vi.fn(),
      check: vi.fn(() => true),
    };
    const targetDocument = { fonts } as unknown as Document;
    const manifest = makeManifest();
    const code = `const title = <div style={{fontFamily: 'Inter, sans-serif'}}>中文 Title</div>;`;
    const prepared = prepareRemotionFontCode({ code, manifest });

    const cold = await loadPreparedRemotionFonts({
      manifest,
      prepared,
      text: code,
      targetDocument,
    });
    const warm = await loadPreparedRemotionFonts({
      manifest,
      prepared,
      text: code,
      targetDocument,
    });

    expect(cold.requestCacheHit).toBe(false);
    expect(cold.faceCount).toBeGreaterThanOrEqual(2);
    expect(cold.faces.every((face) => face.loadMs >= 0)).toBe(true);
    expect(warm.requestCacheHit).toBe(true);
    expect(warm.faceCount).toBe(cold.faceCount);
    expect(fonts.add).toHaveBeenCalledTimes(cold.faceCount);
  });
});
