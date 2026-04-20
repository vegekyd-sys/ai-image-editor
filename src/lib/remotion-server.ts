/**
 * Server-side Remotion rendering via Vercel Sandbox.
 * Uses Snapshot for fast startup + font caching.
 * Sandbox is reused across renders within the same Lambda instance.
 */

import type { DesignPayload } from '@/types';

// ─── Sandbox pool (reuse across renders and requests) ─────────────────────

type SandboxInstance = import('@vercel/sandbox').Sandbox;

let _sandboxId: string | null = null;
let _sandboxPromise: Promise<SandboxInstance> | null = null;

/** Get or create a Sandbox from snapshot. Reuses across renders and requests. */
async function ensureSandbox(): Promise<SandboxInstance> {
  const { Sandbox } = await import('@vercel/sandbox');

  // Try to reuse existing sandbox
  if (_sandboxPromise) {
    try {
      const sandbox = await _sandboxPromise;
      if (sandbox.status === 'running') return sandbox;
    } catch { /* sandbox died or 410 */ }
    _sandboxPromise = null;
    _sandboxId = null;
  }

  // Create new sandbox from snapshot
  const snapshotId = process.env.REMOTION_SNAPSHOT_ID;
  if (!snapshotId) throw new Error('REMOTION_SNAPSHOT_ID not set');

  _sandboxPromise = (async () => {
    console.log('🖥️ [remotion-server] Creating Sandbox from snapshot...');
    const t0 = Date.now();
    const sandbox = await Sandbox.create({
      source: { type: 'snapshot', snapshotId },
      resources: { vcpus: 4 },
      timeout: 5 * 60 * 1000,
    });
    _sandboxId = sandbox.sandboxId;
    console.log(`🖥️ [remotion-server] Sandbox ready in ${((Date.now() - t0) / 1000).toFixed(1)}s (${sandbox.sandboxId})`);
    return sandbox;
  })();

  return _sandboxPromise;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Render a single frame of a Remotion design via Vercel Sandbox.
 * First call on cold Lambda: ~3-6s (Snapshot resume + render).
 * Subsequent calls: ~2s (Sandbox reused).
 */
export async function renderDesignFrame(
  design: DesignPayload,
  frame = 0,
): Promise<Buffer> {
  const { renderStillOnVercel } = await import('@remotion/vercel');

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 0;
  const durationInFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;
  // Unique output file per render — prevents concurrent renders from overwriting each other
  const outputFile = `/tmp/still-${frame}-${Date.now()}.jpeg`;

  // Retry once if Sandbox is gone (410/expired)
  for (let attempt = 0; attempt < 2; attempt++) {
    const sandbox = await ensureSandbox();
    console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height})${attempt > 0 ? ' [retry]' : ''}...`);
    const t0 = Date.now();

    try {
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

      console.log(`✅ [remotion-server] Frame rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(buffer.length / 1024).toFixed(0)} KB`);
      return buffer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && (msg.includes('410') || msg.includes('gone') || msg.includes('not ok'))) {
        console.warn(`⚠️ [remotion-server] Sandbox expired, recreating...`);
        _sandboxPromise = null;
        _sandboxId = null;
        continue; // retry with fresh sandbox
      }
      throw err;
    }
  }
  throw new Error('renderDesignFrame: all attempts failed');
}
