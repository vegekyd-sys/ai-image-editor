/**
 * Server-side Remotion rendering via Vercel Sandbox.
 * Creates an ephemeral Linux VM with Chrome + Remotion pre-installed,
 * keeps it alive for subsequent renders (avoids 30s cold start per frame).
 * Uses @remotion/vercel (official Vercel integration).
 *
 * Usage:
 *   const jpeg = await renderDesignFrame(design, 0);
 *   // jpeg is a Buffer of JPEG image data
 */

import path from 'path';
import { readdir, readFile } from 'fs/promises';
import type { DesignPayload } from '@/types';

const SANDBOX_BUNDLE_DIR = 'remotion-bundle';

// ─── Bundle cache (built once per server lifecycle) ────────────────────────

let _bundlePromise: Promise<string> | null = null;

/** Bundle the Remotion entry point once, return path relative to cwd. */
async function ensureBundle(): Promise<string> {
  if (_bundlePromise) return _bundlePromise;
  _bundlePromise = (async () => {
    const { bundle } = await import('@remotion/bundler');
    const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx');
    const outDir = path.resolve(process.cwd(), '.remotion-bundle');
    console.log('📦 [remotion-server] Bundling entry point...');
    const abs = await bundle({
      entryPoint,
      outDir,
      onProgress: (p: number) => { if (p % 25 === 0) console.log(`📦 [remotion-server] Bundle: ${p}%`); },
    });
    const rel = path.relative(process.cwd(), abs);
    console.log('📦 [remotion-server] Bundle ready:', rel);
    return rel;
  })();
  return _bundlePromise;
}

// ─── Sandbox pool (reuse across renders) ───────────────────────────────────

type SandboxInstance = Awaited<ReturnType<typeof import('@remotion/vercel').createSandbox>>;
let _sandboxPromise: Promise<SandboxInstance> | null = null;
let _sandboxLastUsed = 0;
const SANDBOX_IDLE_TIMEOUT = 60_000; // stop after 60s idle

/** Get or create a ready-to-render Sandbox with bundle uploaded. */
async function ensureSandbox(): Promise<SandboxInstance> {
  if (_sandboxPromise) {
    const sandbox = await _sandboxPromise;
    if (sandbox.status === 'running') {
      _sandboxLastUsed = Date.now();
      return sandbox;
    }
    // Sandbox died, recreate
    _sandboxPromise = null;
  }

  _sandboxPromise = (async () => {
    const { createSandbox } = await import('@remotion/vercel');
    const bundleDir = await ensureBundle();

    console.log('🖥️ [remotion-server] Creating Vercel Sandbox...');
    const t0 = Date.now();
    const sandbox = await createSandbox({ resources: { vcpus: 2 } });
    console.log(`🖥️ [remotion-server] Sandbox created in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${sandbox.sandboxId}`);

    // Upload bundle
    console.log('📤 [remotion-server] Uploading bundle...');
    const t1 = Date.now();
    await uploadBundleToSandbox(sandbox, bundleDir);
    console.log(`📤 [remotion-server] Bundle uploaded in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

    _sandboxLastUsed = Date.now();

    // Schedule idle cleanup
    scheduleIdleCleanup();

    return sandbox;
  })();

  return _sandboxPromise;
}

function scheduleIdleCleanup() {
  setTimeout(async () => {
    if (!_sandboxPromise) return;
    const idle = Date.now() - _sandboxLastUsed;
    if (idle >= SANDBOX_IDLE_TIMEOUT) {
      console.log('🛑 [remotion-server] Stopping idle Sandbox');
      try {
        const sandbox = await _sandboxPromise;
        await sandbox.stop();
      } catch { /* already stopped */ }
      _sandboxPromise = null;
    } else {
      // Check again later
      scheduleIdleCleanup();
    }
  }, SANDBOX_IDLE_TIMEOUT);
}

// ─── Bundle upload (workaround for @remotion/vercel mkDir bug) ─────────────

async function uploadBundleToSandbox(sandbox: SandboxInstance, bundleDir: string): Promise<void> {
  const fullBundleDir = path.resolve(process.cwd(), bundleDir);

  const files: { path: string; content: Buffer }[] = [];
  async function walk(dir: string, base = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) await walk(full, rel);
      else files.push({ path: rel, content: await readFile(full) });
    }
  }
  await walk(fullBundleDir);

  // Collect all parent directories
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = path.dirname(file.path);
    if (dir && dir !== '.') {
      const parts = dir.split(path.sep);
      for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
  }

  // Create dirs in order (parents first)
  await sandbox.mkDir(SANDBOX_BUNDLE_DIR);
  for (const dir of Array.from(dirs).sort()) {
    await sandbox.mkDir(`${SANDBOX_BUNDLE_DIR}/${dir}`);
  }

  await sandbox.writeFiles(files.map(f => ({
    path: `${SANDBOX_BUNDLE_DIR}/${f.path}`,
    content: f.content,
  })));
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Render a single frame of a Remotion design via Vercel Sandbox.
 * First call: ~40s (bundle + sandbox + upload + render).
 * Subsequent calls: ~3s (render only, sandbox reused).
 * Returns JPEG buffer.
 */
export async function renderDesignFrame(
  design: DesignPayload,
  frame = 0,
): Promise<Buffer> {
  const { renderStillOnVercel } = await import('@remotion/vercel');
  const sandbox = await ensureSandbox();

  const fps = design.animation?.fps || 30;
  const durationInSeconds = design.animation?.durationInSeconds || 0;
  const durationInFrames = durationInSeconds > 0
    ? Math.max(1, Math.round(fps * durationInSeconds))
    : 1;

  const outputFile = '/tmp/still.jpeg';
  console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height})...`);
  const t0 = Date.now();

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

  const buffer = await sandbox.readFileToBuffer({ path: outputFile });
  if (!buffer) throw new Error('Rendered file not found in Sandbox');

  console.log(`✅ [remotion-server] Frame rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(buffer.length / 1024).toFixed(0)} KB`);
  return buffer;
}

/**
 * Render multiple key frames of an animated design.
 * Reuses the same Sandbox across all frames.
 */
export async function renderDesignKeyFrames(
  design: DesignPayload,
  frames?: number[],
): Promise<{ frame: number; buffer: Buffer }[]> {
  const fps = design.animation?.fps || 30;
  const duration = design.animation?.durationInSeconds || 0;
  const totalFrames = duration > 0 ? Math.round(fps * duration) : 1;

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
