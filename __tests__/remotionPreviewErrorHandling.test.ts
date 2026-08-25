import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyRemotionPreviewError,
  isRecoverableRemotionPreviewError,
} from '@/lib/remotion-preview-errors';

const root = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Remotion preview error handling', () => {
  it('classifies browser resource failures without exposing their raw text', () => {
    expect(classifyRemotionPreviewError('A network error occurred')).toBe('network');
    expect(classifyRemotionPreviewError('Failed to fetch')).toBe('network');
    expect(classifyRemotionPreviewError('The source image cannot be decoded.')).toBe('decode');
    expect(classifyRemotionPreviewError('Remotion fonts failed to load: Noto Sans SC')).toBe('font');
    expect(classifyRemotionPreviewError('Unexpected token')).toBe('runtime');
  });

  it('only treats resource loading failures as preview-recoverable', () => {
    expect(isRecoverableRemotionPreviewError('A network error occurred')).toBe(true);
    expect(isRecoverableRemotionPreviewError('The source image cannot be decoded.')).toBe(true);
    expect(isRecoverableRemotionPreviewError('Remotion fonts failed to load: Inter')).toBe(true);
    expect(isRecoverableRemotionPreviewError('Unexpected token')).toBe(false);
  });

  it('reports technical details to the server and keeps them out of the UI', () => {
    const renderer = read('src/components/RemotionRenderer.tsx');
    const route = read('src/app/api/remotion/client-error/route.ts');
    const fontRoute = read('src/app/api/remotion/fonts/route.ts');
    const fontAssetRoute = read('src/app/api/remotion/fonts/[sha]/route.ts');

    expect(renderer).toContain('reportRemotionPreviewError({');
    expect(renderer).toContain("t('canvas.previewUnavailable')");
    expect(renderer).toContain("t('canvas.previewRetry')");
    expect(renderer).not.toContain('Design error: {compileError}');
    expect(renderer).not.toContain('Design crashed: {this.state.error.message}');
    expect(route).toContain("console.error('[remotion-client-error]'");
    expect(fontRoute).toContain('url: `/api/remotion/fonts/${face.sha256}`');
    expect(fontRoute).not.toContain('new URL(`/api/remotion/fonts/');
    expect(renderer).toContain("fetch('/api/remotion/fonts'");
    expect(renderer).toContain("method: 'POST'");
    expect(fontRoute).toContain("'Cache-Control': 'private, no-cache'");
    expect(fontAssetRoute).toContain('const body = await response.arrayBuffer()');
    expect(fontAssetRoute).toContain("'Content-Length': String(body.byteLength)");
  });
});
