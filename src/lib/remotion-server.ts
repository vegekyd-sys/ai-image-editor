/**
 * Server-side Remotion rendering.
 *
 * Two modes:
 * - **Local** (dev): Uses @remotion/renderer directly with local Chrome. Fast (~0.5s warm).
 * - **Vercel** (production): Uses Vercel Sandbox via snapshot. (~2s warm after 0.6s resume).
 *
 * Mode is auto-detected: if REMOTION_SNAPSHOT_ID is set → Vercel Sandbox, otherwise → local.
 */

import path from 'path';
import type { DesignPayload } from '@/types';

// ─── Local mode: @remotion/renderer with local Chrome ─────────────────────

let _localBundlePromise: Promise<string> | null = null;

async function ensureLocalBundle(): Promise<string> {
  if (_localBundlePromise) return _localBundlePromise;
  _localBundlePromise = (async () => {
    const { bundle } = await import('@remotion/bundler');
    const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx');
    const outDir = path.resolve(process.cwd(), '.remotion-bundle');
    console.log('📦 [remotion-server] Bundling (local)...');
    const abs = await bundle({ entryPoint, outDir, onProgress: () => {} });
    console.log('📦 [remotion-server] Bundle ready');
    return abs;
  })();
  return _localBundlePromise;
}

async function renderLocal(design: DesignPayload, frame: number): Promise<Buffer> {
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const fs = await import('fs');
  const os = await import('os');
  const bundleUrl = await ensureLocalBundle();

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 0;
  const durationInFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;

  const composition = await selectComposition({
    serveUrl: bundleUrl,
    id: 'dynamic-design',
    inputProps: { code: design.code, designProps: design.props || {} },
  });

  const comp = {
    ...composition,
    width: design.width || 1080,
    height: design.height || 1350,
    fps,
    durationInFrames,
  };

  const outputPath = path.join(os.default.tmpdir(), `remotion-frame-${Date.now()}.jpeg`);
  await renderStill({
    composition: comp,
    serveUrl: bundleUrl,
    frame: Math.min(frame, durationInFrames - 1),
    output: outputPath,
    imageFormat: 'jpeg',
    jpegQuality: 90,
    inputProps: { code: design.code, designProps: design.props || {} },
  });

  const buffer = fs.default.readFileSync(outputPath);
  fs.default.unlinkSync(outputPath);
  return buffer;
}

// ─── Vercel Sandbox mode: @remotion/vercel with snapshot ──────────────────

async function renderSandbox(design: DesignPayload, frame: number): Promise<Buffer> {
  const { Sandbox } = await import('@vercel/sandbox');
  const { renderStillOnVercel } = await import('@remotion/vercel');

  const snapshotId = process.env.REMOTION_SNAPSHOT_ID!;
  console.log('🖥️ [remotion-server] Creating Sandbox from snapshot...');
  const t0 = Date.now();
  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    resources: { vcpus: 4 },
    timeout: 5 * 60 * 1000,
  });
  console.log(`🖥️ [remotion-server] Sandbox ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  try {
    const fps = design.animation?.fps || 30;
    const dur = design.animation?.durationInSeconds || 0;
    const durationInFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;

    const outputFile = '/tmp/still.jpeg';
    await renderStillOnVercel({
      sandbox,
      compositionId: 'dynamic-design',
      inputProps: {
        code: design.code,
        designProps: design.props || {},
        fps,
        durationInFrames,
        width: design.width || 1080,
        height: design.height || 1350,
      },
      imageFormat: 'jpeg',
      jpegQuality: 90,
      frame: Math.min(frame, durationInFrames - 1),
      outputFile,
      timeoutInMilliseconds: 30000,
    });

    const buffer = await sandbox.readFileToBuffer({ path: outputFile });
    if (!buffer) throw new Error('Rendered file not found in Sandbox');
    return buffer;
  } finally {
    sandbox.stop().catch(() => {});
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Render a single frame of a Remotion design.
 * Auto-selects local Chrome (dev) or Vercel Sandbox (production).
 */
export async function renderDesignFrame(
  design: DesignPayload,
  frame = 0,
): Promise<Buffer> {
  const useVercel = !!process.env.REMOTION_SNAPSHOT_ID;
  const mode = useVercel ? 'sandbox' : 'local';
  console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height}) via ${mode}...`);
  const t0 = Date.now();

  const buffer = useVercel
    ? await renderSandbox(design, frame)
    : await renderLocal(design, frame);

  console.log(`✅ [remotion-server] Frame rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(buffer.length / 1024).toFixed(0)} KB (${mode})`);
  return buffer;
}
