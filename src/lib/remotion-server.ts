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
  if (_sandboxPromise && _sandboxId) {
    try {
      const sandbox = await _sandboxPromise;
      if (sandbox.status === 'running') return sandbox;
    } catch { /* sandbox died */ }
    _sandboxPromise = null;
    _sandboxId = null;
  }

  // Try to reconnect to a previously created sandbox
  if (_sandboxId) {
    try {
      const sandbox = await Sandbox.get({ sandboxId: _sandboxId });
      if (sandbox.status === 'running') {
        _sandboxPromise = Promise.resolve(sandbox);
        console.log(`🖥️ [remotion-server] Reconnected to Sandbox ${_sandboxId}`);
        return sandbox;
      }
    } catch { /* expired */ }
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
  const sandbox = await ensureSandbox();

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 0;
  const durationInFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;

  const outputFile = '/tmp/still.jpeg';
  console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height})...`);
  const t0 = Date.now();

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
}
