import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FontInfo } from '@remotion/google-fonts';
import {
  normalizeRemotionFontFamilies,
  remotionFontSearchText,
  resolveRemotionFontAssets,
  selectUnicodeSubsets,
} from '@/remotion/font-runtime';

describe('Remotion font runtime', () => {
  it('replaces OS-dependent font stacks while preserving explicit Google Fonts', () => {
    const code = `function Design() {
      return <div style={{fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'}}>
        <h1 style={{fontFamily: 'Playfair Display, serif'}}>Title</h1>
        <code style={{fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'}}>code</code>
      </div>;
    }`;

    const normalized = normalizeRemotionFontFamilies(code);
    expect(normalized).toContain('Inter, Noto Sans SC, sans-serif');
    expect(normalized).toContain('Playfair Display, Noto Serif SC, serif');
    expect(normalized).toContain('JetBrains Mono, Noto Sans SC, monospace');
    expect(normalized).not.toContain('-apple-system');
    expect(normalized).not.toContain('PingFang SC');
  });

  it('includes nested editable props in font and glyph detection text', () => {
    const text = remotionFontSearchText('function Design() {}', {
      scenes: [{ title: '中文字体' }],
    });
    expect(text).toContain('function Design() {}');
    expect(text).toContain('中文字体');
  });

  it('selects only Unicode shards that cover the rendered text', () => {
    const info = {
      unicodeRanges: {
        latin: 'U+0000-00FF',
        cjkA: 'U+4E00-4EFF',
        cjkB: 'U+4F00-9FFF',
      },
    } as unknown as FontInfo;

    expect(selectUnicodeSubsets(info, 'Makaron 中', ['latin', 'cjkA', 'cjkB']))
      .toEqual(['latin', 'cjkA']);
  });

  it('does not treat substrings inside code as font family declarations', async () => {
    const text = `const Content = () => <div style={{fontFamily: 'playfair display, serif', fontWeight: 'bold'}}>Play button</div>`;
    const assets = await resolveRemotionFontAssets(text);
    const families = new Set(assets.map((asset) => asset.family));

    expect(families).toContain('Playfair Display');
    expect(families).toContain('Inter');
    expect(families).not.toContain('Play');
    expect(families).not.toContain('Playfair');
    expect(families).not.toContain('Content');
  });

  it('keeps Lambda font loading enabled with a same-origin manifest and larger chunks', () => {
    const lambda = readFileSync('src/lib/remotion-lambda-renderer.ts', 'utf8');
    const composition = readFileSync('src/remotion/DynamicDesign.tsx', 'utf8');
    const worker = readFileSync('Dockerfile.remotion-worker', 'utf8');

    expect(lambda).toContain('cacheRemotionFontsForLambda');
    expect(lambda).toContain('fontStylesheetUrl: fontCache.stylesheetUrl');
    expect(lambda).toContain('skipFontLoading: options.skipFontLoading ?? false');
    expect(lambda).toContain('options.skipFontLoading ? 20 : 60');
    expect(composition).toContain('loadRemotionFontStylesheet(fontManifestUrl, document)');
    expect(worker).toContain('REMOTION_LOCAL_SKIP_FONTS=false');
  });
});
