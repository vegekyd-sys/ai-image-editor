import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REMOTION_FONT_CATALOG_VERSION,
  internalRemotionFontFamily,
  loadPreparedRemotionFonts,
  prepareRemotionFontCode,
  prepareRemotionFontCodeFromBundledCatalog,
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
    'Noto Sans Symbols 2',
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
    proxied.faces[0].url = `/api/remotion/fonts/${proxied.faces[0].sha256}`;
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

  it('prepares the deferred browser preview without waiting for the remote manifest', () => {
    const prepared = prepareRemotionFontCodeFromBundledCatalog({
      code: `const title = <div style={{fontFamily: 'Montserrat, sans-serif'}}>Title</div>;`,
    });

    expect(prepared.code).toContain(internalRemotionFontFamily('Montserrat'));
    expect(prepared.code).toContain(internalRemotionFontFamily('Noto Sans SC'));
    expect(prepared.code).toContain(internalRemotionFontFamily('Noto Sans Symbols 2'));
    expect(prepared.defaultFontFamily).toContain(internalRemotionFontFamily('Inter'));
    expect(prepared.code).not.toContain("fontFamily: 'Montserrat");
  });

  it('prepares an arbitrary authored Google Font while its pinned manifest is resolving', () => {
    const prepared = prepareRemotionFontCodeFromBundledCatalog({
      code: `const title = <div style={{fontFamily: 'Bungee Spice, sans-serif'}}>Title</div>;`,
    });

    expect(prepared.code).toContain(internalRemotionFontFamily('Bungee Spice'));
    expect(prepared.usedFamilies).toContain('Bungee Spice');
    expect(prepared.code).not.toContain("fontFamily: 'Bungee Spice");
  });

  it('loads a pinned symbol face for plain Unicode icons instead of relying on OS fallback', async () => {
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
    const code = `const badge = <div style={{fontFamily: 'Noto Sans SC'}}>✦ 高支 · 高针 · 高密</div>;`;
    const prepared = prepareRemotionFontCode({ code, manifest });

    await loadPreparedRemotionFonts({
      manifest,
      prepared,
      text: code,
      targetDocument,
    });

    const registeredFamilies = fonts.add.mock.calls.map(([face]) => face.family);
    expect(registeredFamilies).toContain(internalRemotionFontFamily('Noto Sans Symbols 2'));
  });

  it('fails visibly for an unsupported local system font', () => {
    expect(() => prepareRemotionFontCode({
      code: `const title = <div style={{fontFamily: 'STKaiti, Kaiti SC, KaiTi, serif'}}>微信华章</div>;`,
      manifest: makeManifest(),
    })).toThrow('Unsupported Remotion font "STKaiti"');
  });

  it('migrates legacy platform font stacks to pinned catalog families', () => {
    const prepared = prepareRemotionFontCode({
      code: `
        const ui = <div style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>Settings</div>;
        const chinese = <div style={{fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif'}}>微信诞生</div>;
      `,
      manifest: makeManifest(),
    });

    expect(prepared.usedFamilies).toEqual(expect.arrayContaining(['Inter', 'Noto Sans SC']));
    expect(prepared.code).not.toMatch(/system-ui|-apple-system|PingFang SC|Microsoft YaHei/);
    expect(prepared.code).toContain(internalRemotionFontFamily('Inter'));
    expect(prepared.code).toContain(internalRemotionFontFamily('Noto Sans SC'));
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

  it('pins font stacks kept in constants instead of falling back to the platform generic', () => {
    // Real session 32452f29: Chinese titles rendered blank in Sandbox preview
    // because the stacks lived in constants the fontFamily rewrite never saw.
    const prepared = prepareRemotionFontCode({
      code: `
        const SERIF = "'Noto Serif SC', serif";
        const SANS = 'Noto Sans SC, sans-serif';
        const title = <div style={{fontFamily: SERIF}}>生日快乐</div>;
        const label = <div style={{fontFamily: SANS}}>京都 · 一家人的晚餐</div>;
        const badge = <Badge font="'Ma Shan Zheng', cursive" />;
      `,
      manifest: makeManifest(),
    });

    expect(prepared.usedFamilies).toEqual(
      expect.arrayContaining(['Noto Serif SC', 'Noto Sans SC', 'Ma Shan Zheng']),
    );
    expect(prepared.code).toContain(
      `const SERIF = "'${internalRemotionFontFamily('Noto Serif SC')}', `,
    );
    expect(prepared.code).toContain(
      `const SANS = '"${internalRemotionFontFamily('Noto Sans SC')}", `,
    );
    // JSX attribute strings cannot hold escapes, so inner names use the other quote.
    expect(prepared.code).toContain(
      `font="'${internalRemotionFontFamily('Ma Shan Zheng')}', '${internalRemotionFontFamily('Noto Sans SC')}'`,
    );
    expect(prepared.code).not.toMatch(/'Noto Serif SC', serif/);
    expect(prepared.warnings).toEqual([]);
  });

  it('aliases each family of a font stack supplied through persisted props', () => {
    const prepared = prepareRemotionFontCode({
      code: 'const title = <div style={{fontFamily: props.titleFont}}>云影落长安</div>;',
      props: { titleFont: "'Noto Serif SC', serif", caption: 'Hello, world' },
      manifest: makeManifest(),
    });

    expect(prepared.dynamicFamilyAliases).toContainEqual({ alias: 'Noto Serif SC', family: 'Noto Serif SC' });
    expect(prepared.usedFamilies).toContain('Noto Serif SC');
    expect(prepared.warnings).toEqual([]);
  });

  it('leaves copy and canvas font shorthands untouched', () => {
    const code = `
      const copy = 'Hello, world';
      const canvas = "bold 48px Inter, sans-serif";
      const unknown = "'Lobster Two', cursive";
    `;
    const prepared = prepareRemotionFontCode({ code, manifest: makeManifest() });

    expect(prepared.code).toBe(code);
    expect(prepared.warnings).toEqual([]);
  });

  it('reports runtime fontFamily values that cannot reach a pinned face', () => {
    const prepared = prepareRemotionFontCode({
      code: `
        const KAI = 'STKaiti';
        const title = <div style={{fontFamily: KAI}}>微信华章</div>;
        const body = <div style={{fontFamily: theme.body}}>正文</div>;
      `,
      manifest: makeManifest(),
    });

    expect(prepared.warnings).toHaveLength(3);
    expect(prepared.warnings[0]).toContain('fontFamily: KAI resolves to "STKaiti"');
    expect(prepared.warnings[1]).toContain('fontFamily: theme.body is a runtime value');
    expect(prepared.warnings[2]).toContain('Sandbox preview_frame and Lambda export run on Linux');
    expect(prepared.warnings[2]).toContain('not a font-loading race');
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

  it('identifies the exact font resource when browser loading fails', async () => {
    class FailingFontFace {
      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors: FontFaceDescriptors,
      ) {}

      async load() {
        throw new Error('A network error occurred.');
      }
    }
    vi.stubGlobal('FontFace', FailingFontFace);
    const targetDocument = {
      fonts: {
        ready: Promise.resolve(),
        add: vi.fn(),
        check: vi.fn(() => true),
      },
    } as unknown as Document;
    const manifest = makeManifest();
    const code = `const title = <div style={{fontFamily: 'Inter, sans-serif'}}>Title</div>;`;
    const prepared = prepareRemotionFontCode({ code, manifest });

    await expect(loadPreparedRemotionFonts({
      manifest,
      prepared,
      text: code,
      targetDocument,
    })).rejects.toThrow(
      `Remotion font failed to load: Inter 400 latin from ${manifest.faces[0].url}. `
      + 'A network error occurred.',
    );
  });
});
