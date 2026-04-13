/**
 * Server-side Remotion rendering — renders a single frame of an Agent design.
 * Uses @remotion/renderer (Chromium-based) for pixel-perfect output.
 *
 * Usage:
 *   const jpeg = await renderDesignFrame(design, 0);
 *   // jpeg is a Buffer of JPEG image data
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { DesignPayload } from '@/types';

let _bundlePromise: Promise<string> | null = null;

/**
 * Bundle the Remotion entry point once, reuse for all renders.
 * Returns the serve URL for renderStill.
 */
async function getBundleUrl(): Promise<string> {
  if (_bundlePromise) return _bundlePromise;

  _bundlePromise = (async () => {
    const { bundle } = await import('@remotion/bundler');
    const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx');
    console.log('📦 [remotion-server] Bundling entry point...');
    const bundleUrl = await bundle({
      entryPoint,
      onProgress: (progress: number) => {
        if (progress % 25 === 0) console.log(`📦 [remotion-server] Bundle progress: ${progress}%`);
      },
    });
    console.log('📦 [remotion-server] Bundle ready:', bundleUrl);
    return bundleUrl;
  })();

  return _bundlePromise;
}

/**
 * Render a single frame of a Remotion design.
 * Returns JPEG buffer.
 */
export async function renderDesignFrame(
  design: DesignPayload,
  frame = 0,
): Promise<Buffer> {
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const bundleUrl = await getBundleUrl();

  const fps = design.animation?.fps || 30;
  const durationInSeconds = design.animation?.durationInSeconds || 0;
  const durationInFrames = durationInSeconds > 0
    ? Math.max(1, Math.round(fps * durationInSeconds))
    : 1;

  // Select the composition with dynamic props
  const composition = await selectComposition({
    serveUrl: bundleUrl,
    id: 'dynamic-design',
    inputProps: {
      code: design.code,
      designProps: design.props || {},
    },
  });

  // Override composition dimensions and duration from the design
  const compositionWithOverrides = {
    ...composition,
    width: design.width || 1080,
    height: design.height || 1350,
    fps,
    durationInFrames,
  };

  // Render to temp file
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `remotion-frame-${Date.now()}.jpeg`);

  await renderStill({
    composition: compositionWithOverrides,
    serveUrl: bundleUrl,
    frame: Math.min(frame, durationInFrames - 1),
    output: outputPath,
    imageFormat: 'jpeg',
    jpegQuality: 90,
    inputProps: {
      code: design.code,
      designProps: design.props || {},
    },
  });

  const buffer = fs.readFileSync(outputPath);
  // Clean up temp file
  fs.unlinkSync(outputPath);

  return buffer;
}

/**
 * Render multiple key frames of an animated design.
 * Returns array of { frame, buffer } objects.
 */
export async function renderDesignKeyFrames(
  design: DesignPayload,
  frames?: number[],
): Promise<{ frame: number; buffer: Buffer }[]> {
  const fps = design.animation?.fps || 30;
  const duration = design.animation?.durationInSeconds || 0;
  const totalFrames = duration > 0 ? Math.round(fps * duration) : 1;

  // Default: first frame, middle, last
  const targetFrames = frames || (totalFrames > 1
    ? [0, Math.floor(totalFrames / 2), totalFrames - 1]
    : [0]);

  const results: { frame: number; buffer: Buffer }[] = [];
  for (const frame of targetFrames) {
    const buffer = await renderDesignFrame(design, frame);
    results.push({ frame, buffer });
  }
  return results;
}
