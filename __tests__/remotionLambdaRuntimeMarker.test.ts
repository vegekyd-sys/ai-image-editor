import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { REMOTION_EDITABLE_RUNTIME_VERSION } from '@/lib/editor/editable-react-runtime';
import {
  assertRemotionRuntimeMarker,
  resolveFramesPerLambda,
} from '@/lib/remotion-lambda-renderer';
import {
  REMOTION_FONT_CATALOG_VERSION,
  REMOTION_FONT_RUNTIME_VERSION,
} from '@/remotion/font-catalog';

const serveUrl = 'https://example.test/sites/makaron-runtime/index.html';
const marker = JSON.parse(readFileSync('public/remotion-runtime.json', 'utf8'));

describe('Remotion Lambda runtime marker', () => {
  it('pins the deployed site to the current font and editable runtime ABIs', () => {
    expect(marker).toEqual({
      runtimeVersion: REMOTION_FONT_RUNTIME_VERSION,
      fontCatalogVersion: REMOTION_FONT_CATALOG_VERSION,
      editableRuntimeVersion: REMOTION_EDITABLE_RUNTIME_VERSION,
    });
    expect(() => assertRemotionRuntimeMarker(marker, serveUrl)).not.toThrow();
  });

  it('rejects the legacy font-only marker that lacks the editable runtime ABI', () => {
    expect(() => assertRemotionRuntimeMarker({
      runtimeVersion: 'remotion-font-runtime-r7-legacy-platform-fonts',
      fontCatalogVersion: REMOTION_FONT_CATALOG_VERSION,
    }, serveUrl)).toThrow('Remotion render site version mismatch');
  });

  it('rejects a site with a different editable runtime ABI', () => {
    expect(() => assertRemotionRuntimeMarker({
      runtimeVersion: REMOTION_FONT_RUNTIME_VERSION,
      fontCatalogVersion: REMOTION_FONT_CATALOG_VERSION,
      editableRuntimeVersion: 'remotion-editable-runtime-stale',
    }, serveUrl)).toThrow(REMOTION_EDITABLE_RUNTIME_VERSION);
  });
});

describe('Remotion Lambda chunk sizing', () => {
  it('keeps the benchmark default for ordinary compositions', () => {
    expect(resolveFramesPerLambda(300, 20)).toBe(20);
  });

  it('raises frames per Lambda enough to stay within the 200-function limit', () => {
    expect(resolveFramesPerLambda(4266, 20)).toBe(22);
    expect(Math.ceil(4266 / resolveFramesPerLambda(4266, 20))).toBeLessThanOrEqual(200);
  });

  it('respects a larger explicit chunk size', () => {
    expect(resolveFramesPerLambda(4266, 30)).toBe(30);
  });
});
