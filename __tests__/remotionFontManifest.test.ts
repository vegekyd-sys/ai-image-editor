import { afterEach, describe, expect, it } from 'vitest';
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest';
import { REMOTION_FONT_CATALOG_VERSION } from '@/remotion/font-catalog';

const originalManifestUrl = process.env.REMOTION_FONT_MANIFEST_URL;
const originalServeUrl = process.env.REMOTION_LAMBDA_SERVE_URL;

afterEach(() => {
  if (originalManifestUrl === undefined) delete process.env.REMOTION_FONT_MANIFEST_URL;
  else process.env.REMOTION_FONT_MANIFEST_URL = originalManifestUrl;
  if (originalServeUrl === undefined) delete process.env.REMOTION_LAMBDA_SERVE_URL;
  else process.env.REMOTION_LAMBDA_SERVE_URL = originalServeUrl;
});

describe('Remotion font manifest URL', () => {
  it('prefers an explicit manifest URL and sanitizes accidental newlines', () => {
    process.env.REMOTION_FONT_MANIFEST_URL = 'https://cdn.example.test/fonts/manifest.json\\n';
    expect(resolveRemotionFontManifestUrl('https://ignored.example.test')).toBe(
      'https://cdn.example.test/fonts/manifest.json',
    );
  });

  it('derives the versioned catalog path from the deployed site', () => {
    delete process.env.REMOTION_FONT_MANIFEST_URL;
    delete process.env.REMOTION_LAMBDA_SERVE_URL;
    expect(resolveRemotionFontManifestUrl('https://bucket.s3.us-east-1.amazonaws.com/sites/site/index.html')).toBe(
      `https://bucket.s3.us-east-1.amazonaws.com/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`,
    );
  });

  it('fails clearly when no render site is configured', () => {
    delete process.env.REMOTION_FONT_MANIFEST_URL;
    delete process.env.REMOTION_LAMBDA_SERVE_URL;
    expect(() => resolveRemotionFontManifestUrl()).toThrow('REMOTION_FONT_MANIFEST_URL');
  });
});
