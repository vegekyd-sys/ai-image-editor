/**
 * Server-side Remotion rendering via Vercel Sandbox.
 * Each render spins up an ephemeral Linux VM with Chrome + Remotion pre-installed.
 * Uses @remotion/vercel (official Vercel integration).
 *
 * Usage:
 *   const jpeg = await renderDesignFrame(design, 0);
 *   // jpeg is a Buffer of JPEG image data
 */

import path from 'path';
import type { DesignPayload } from '@/types';

// Cache the bundle directory path (built once, reused)
let _bundlePromise: Promise<string> | null = null;

/**
 * Bundle the Remotion entry point once (on first call), reuse for all renders.
 * Returns the local bundle directory path.
 */
async function ensureBundle(): Promise<string> {
  if (_bundlePromise) return _bundlePromise;

  _bundlePromise = (async () => {
    const { bundle } = await import('@remotion/bundler');
    const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx');
    console.log('📦 [remotion-server] Bundling entry point...');
    const bundleDir = await bundle({
      entryPoint,
      onProgress: (progress: number) => {
        if (progress % 25 === 0) console.log(`📦 [remotion-server] Bundle progress: ${progress}%`);
      },
    });
    console.log('📦 [remotion-server] Bundle ready:', bundleDir);
    return bundleDir;
  })();

  return _bundlePromise;
}

/**
 * Render a single frame of a Remotion design via Vercel Sandbox.
 * Returns JPEG buffer.
 */
export async function renderDesignFrame(
  design: DesignPayload,
  frame = 0,
): Promise<Buffer> {
  const { createSandbox, addBundleToSandbox, renderStillOnVercel } = await import('@remotion/vercel');

  // 1. Ensure bundle is ready
  const bundleDir = await ensureBundle();

  // 2. Create Sandbox VM (minimal resources for a single still)
  console.log('🖥️ [remotion-server] Creating Vercel Sandbox...');
  const sandbox = await createSandbox({ resources: { vcpus: 2 } });

  try {
    // 3. Upload bundle to Sandbox
    console.log('📤 [remotion-server] Uploading bundle to Sandbox...');
    await addBundleToSandbox({ sandbox, bundleDir });

    // 4. Render the frame
    const fps = design.animation?.fps || 30;
    const durationInSeconds = design.animation?.durationInSeconds || 0;
    const durationInFrames = durationInSeconds > 0
      ? Math.max(1, Math.round(fps * durationInSeconds))
      : 1;

    const outputFile = '/tmp/still.jpeg';
    console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height})...`);
    await renderStillOnVercel({
      sandbox,
      compositionId: 'dynamic-design',
      inputProps: {
        code: design.code,
        designProps: design.props || {},
      },
      imageFormat: 'jpeg',
      jpegQuality: 90,
      frame: Math.min(frame, durationInFrames - 1),
      outputFile,
      scale: 1,
      timeoutInMilliseconds: 30000,
    });

    // 5. Read the rendered image back from the Sandbox
    console.log('📥 [remotion-server] Reading rendered image from Sandbox...');
    const buffer = await sandbox.readFileToBuffer({ path: outputFile });
    if (!buffer) throw new Error('Rendered file not found in Sandbox');

    console.log(`✅ [remotion-server] Frame rendered: ${(buffer.length / 1024).toFixed(0)} KB`);
    return buffer;
  } finally {
    // Always clean up the Sandbox
    await sandbox.stop().catch((e: Error) => console.warn('⚠️ [remotion-server] Sandbox stop error:', e.message));
  }
}

/**
 * Render multiple key frames of an animated design.
 * Returns array of { frame, buffer } objects.
 *
 * Note: Each call creates a new Sandbox for now. Future optimization:
 * keep the Sandbox alive across frames.
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
