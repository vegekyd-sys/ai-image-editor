/**
 * Server-side Remotion rendering via Vercel Sandbox.
 * Uses Snapshot for fast startup + font caching.
 * Sandbox is reused across renders within the same Lambda instance.
 */

import { createHash, randomUUID } from 'node:crypto';
import { awaitPreviewOperation, runPreviewCommand } from './remotion-preview-command';
import type { DesignPayload } from '@/types';
import { hasRemotionAudioSources } from '@/lib/remotion-audio';
import { resolveRemotionFontManifestUrlForDesign } from '@/lib/remotion-font-resolver';
import { normalizeRemotionTextValue } from '@/lib/remotion-text-normalization';
import { collectPreviewMediaSources, localizePreviewMedia, PREVIEW_MEDIA_PREFETCH_SCRIPT } from './remotion-preview-media';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\[rn]|[\r\n]/g, '').trim();
  return value || undefined;
}

// ─── Sandbox pool (reuse across renders and requests) ─────────────────────

type SandboxInstance = import('@vercel/sandbox').Sandbox;

interface SandboxPoolEntry {
  promise: Promise<SandboxInstance> | null;
  createdAt: number;
  prefetchTail: Promise<void>;
}
const sandboxPool = new Map<string, SandboxPoolEntry>();
const SANDBOX_LIFETIME_MS = 10 * 60 * 1000;
function previewPoolKey(design: DesignPayload): string {
  return 'preview:' + createHash('sha256').update(collectPreviewMediaSources(design).map(s => s.path).join('\n')).digest('hex');
}
function poolEntry(key: string): SandboxPoolEntry {
  let entry = sandboxPool.get(key);
  if (!entry) { entry = {promise:null,createdAt:0,prefetchTail:Promise.resolve()}; sandboxPool.set(key,entry); }
  return entry;
}
async function preparePreviewMedia(design: DesignPayload, sandbox: SandboxInstance, entry: SandboxPoolEntry, signal: AbortSignal): Promise<DesignPayload> {
  const sources = collectPreviewMediaSources(design);
  if (!sources.length) return design;
  const previous = entry.prefetchTail;
  const current = previous.catch(() => undefined).then(async () => {
    signal.throwIfAborted();
    await awaitPreviewOperation(sandbox.writeFiles([{ path: '/tmp/makaron-preview-prefetch.mjs', content: Buffer.from(PREVIEW_MEDIA_PREFETCH_SCRIPT) }], {signal}), signal);
    await runPreviewCommand(sandbox, ['/tmp/makaron-preview-prefetch.mjs', JSON.stringify(sources)], signal);
  });
  entry.prefetchTail = current;
  await awaitPreviewOperation(current, signal);
  return localizePreviewMedia(design, sources);
}

export function normalizeRemotionServerCode(code: string): string {
  return code
    .trim()
    .replace(/^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Remotion\s*;?\s*$/gm, '')
    .replace(/^\s*(?:const|let|var)\s+Remotion\s*=\s*window\.Remotion\s*;?\s*$/gm, '')
    .replace(/\bwindow\.Remotion\./g, '')
    .replace(/\bRemotion\./g, '')
    .trim();
}

export function pickRemotionServerComponentName(code: string): string {
  const names = [
    ...Array.from(code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g), m => m[1]),
    ...Array.from(code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g), m => m[1]),
  ];

  const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene'];
  for (const name of preferred) {
    if (names.includes(name)) return name;
  }

  const descriptive = [...names].reverse().find(name =>
    /(?:Composition|Design)$/i.test(name) &&
    !/(?:Caption|Badge|Label|Title|Subtitle|Overlay)$/i.test(name)
  );
  if (descriptive) return descriptive;

  return names[names.length - 1] || 'Design';
}

export function prepareRemotionCodeForSandbox(code: string): string {
  const normalized = normalizeRemotionServerCode(code);
  const componentName = pickRemotionServerComponentName(normalized);
  if (componentName === 'Design') return normalized;

  return `function Design(props) {
  return React.createElement(${componentName}, props);
}

${normalized}`;
}

/** Get or create a Sandbox from snapshot. Reuses across renders and requests. */
async function ensureSandbox(key = 'export', signal?: AbortSignal): Promise<SandboxInstance> {
  const { Sandbox } = await import('@vercel/sandbox');
  // Keep different source sets out of one another's cache/queue. Do not trust
  // the SDK object's cached status after the service's lifetime has elapsed.
  for (const [oldKey, old] of sandboxPool) {
    if (Date.now() - old.createdAt >= SANDBOX_LIFETIME_MS) sandboxPool.delete(oldKey);
  }
  const entry = poolEntry(key);
  if (entry.promise && Date.now() - entry.createdAt < SANDBOX_LIFETIME_MS - 60_000) {
    try {
      const sandbox = await entry.promise;
      if (sandbox.status === 'running') return sandbox;
    } catch { /* sandbox died or 410 */ }
  }
  const snapshotId = process.env.REMOTION_SNAPSHOT_ID;
  if (!snapshotId) throw new Error('REMOTION_SNAPSHOT_ID not set');
  entry.createdAt = Date.now();
  entry.prefetchTail = Promise.resolve();
  entry.promise = Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    resources: { vcpus: Number(process.env.REMOTION_SANDBOX_VCPUS || 8) },
    timeout: SANDBOX_LIFETIME_MS,
    signal,
  });
  return entry.promise;
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
  options: { signal?: AbortSignal } = {},
): Promise<Buffer> {
  options.signal?.throwIfAborted();
  if (readEnv('REMOTION_RENDERER') === 'local') {
    const { renderDesignFrameLocal } = await import('@/lib/remotion-local-renderer');
    return renderDesignFrameLocal(design, frame, {
      cacheDir: readEnv('REMOTION_LOCAL_MEDIA_CACHE_DIR'),
      mediaServerPort: Number(readEnv('REMOTION_LOCAL_MEDIA_PORT') || 5123),
    });
  }

  const key = previewPoolKey(design);
  const frameSignal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(330_000)]);

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 0;
  const durationInFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;
  const fontManifestUrl = await awaitPreviewOperation(resolveRemotionFontManifestUrlForDesign({
    code: design.code,
    props: design.props || {},
    substitutions: design.fontSubstitutions || {},
  }), frameSignal);
  // Unique output file per render — prevents concurrent renders from overwriting each other
  const outputFile = `/tmp/still-${frame}-${randomUUID()}.jpeg`;

  // Retry once if Sandbox is gone (410/expired)
  for (let attempt = 0; attempt < 2; attempt++) {
    const sandbox = await awaitPreviewOperation(ensureSandbox(key, frameSignal), frameSignal);
    console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height})${attempt > 0 ? ' [retry]' : ''}...`);
    const t0 = Date.now();

    try {
      const renderDesign = await preparePreviewMedia(design, sandbox, poolEntry(key), AbortSignal.any([frameSignal, AbortSignal.timeout(240_000)]));
      await runPreviewCommand(sandbox, ['render-still.mjs', JSON.stringify({
        serveUrl: '/vercel/sandbox/remotion-bundle',
        compositionId: 'dynamic-design',
        inputProps: {
          code: prepareRemotionCodeForSandbox(renderDesign.code),
          designProps: normalizeRemotionTextValue(renderDesign.props || {}),
          fps,
          durationInFrames,
          width: design.width || 1080,
          height: design.height || 1350,
          // preview_frame is a deterministic server capture, not interactive
          // playback. Always use Remotion's real OffthreadVideo decoder here so
          // MP4s with cover-art/auxiliary tracks do not get stuck in the
          // browser media-parser path. This applies to both <Video> and an
          // explicit <OffthreadVideo> without requiring the Agent to rewrite.
          useOffthreadVideo: true,
          fontManifestUrl,
          fontSubstitutions: design.fontSubstitutions || {},
        },
        imageFormat: 'jpeg',
        jpegQuality: 90,
        envVariables: {},
        scale: 1,
        logLevel: 'info',
        offthreadVideoCacheSizeInBytes: null,
        mediaCacheSizeInBytes: null,
        offthreadVideoThreads: null,
        licenseKey: null,
        chromiumOptions: { disableWebSecurity: true, gl: null },
        frame: Math.min(frame, durationInFrames - 1),
        output: outputFile,
        timeoutInMilliseconds: 30000,
        chromeMode: 'headless-shell',
        browserExecutable: null,
        binariesDirectory: null,
      })], AbortSignal.any([frameSignal, AbortSignal.timeout(60_000)]));

      options.signal?.throwIfAborted();
      const buffer = await awaitPreviewOperation(sandbox.readFileToBuffer({ path: outputFile }, {signal:frameSignal}), frameSignal);
      if (!buffer) throw new Error('Rendered file not found in Sandbox');

      console.log(`✅ [remotion-server] Frame rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(buffer.length / 1024).toFixed(0)} KB`);
      return buffer;
    } catch (err) {
      frameSignal.throwIfAborted();
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && (msg.includes('410') || msg.includes('gone') || msg.includes('not ok'))) {
        console.warn(`⚠️ [remotion-server] Sandbox expired, recreating...`);
        sandboxPool.delete(key);
        continue; // retry with fresh sandbox
      }
      throw err;
    }
  }
  throw new Error('renderDesignFrame: all attempts failed');
}

export async function renderDesignVideo(
  design: DesignPayload,
  options: {
    onProgress?: (progress: unknown) => void | Promise<void>;
    scale?: number;
  } = {},
): Promise<Buffer> {
  if (readEnv('REMOTION_RENDERER') === 'lambda') {
    const { renderDesignVideoLambda } = await import('@/lib/remotion-lambda-renderer');
    return renderDesignVideoLambda(design, options);
  }

  if (readEnv('REMOTION_RENDERER') === 'local') {
    const { renderDesignVideoLocal } = await import('@/lib/remotion-local-renderer');
    return renderDesignVideoLocal(design, {
      ...options,
      concurrency: readEnv('REMOTION_LOCAL_CONCURRENCY') || 4,
      cacheDir: readEnv('REMOTION_LOCAL_MEDIA_CACHE_DIR'),
      mediaServerPort: Number(readEnv('REMOTION_LOCAL_MEDIA_PORT') || 5123),
    });
  }

  const { renderMediaOnVercel } = await import('@remotion/vercel');

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 1 / fps;
  const durationInFrames = Math.max(1, Math.round(fps * dur));
  const outputFile = `/tmp/remotion-export-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const hasAudio = hasRemotionAudioSources(design.code);
  const fontManifestUrl = await resolveRemotionFontManifestUrlForDesign({
    code: design.code,
    props: design.props || {},
    substitutions: design.fontSubstitutions || {},
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const sandbox = await ensureSandbox();
    const scale = Number.isFinite(options.scale) && options.scale && options.scale > 0 ? options.scale : 1;
    const outputWidth = Math.max(2, Math.round((design.width || 1080) * scale / 2) * 2);
    const outputHeight = Math.max(2, Math.round((design.height || 1920) * scale / 2) * 2);
    console.log(`🎬 [remotion-server] Rendering video ${durationInFrames} frames (${design.width}x${design.height} -> ${outputWidth}x${outputHeight})${attempt > 0 ? ' [retry]' : ''}...`);
    const t0 = Date.now();

    try {
      const result = await renderMediaOnVercel({
        sandbox,
        compositionId: 'dynamic-design',
        inputProps: {
          code: prepareRemotionCodeForSandbox(design.code),
          designProps: normalizeRemotionTextValue(design.props || {}),
          fps,
          durationInFrames,
          width: design.width || 1080,
          height: design.height || 1920,
          fontManifestUrl,
          fontSubstitutions: design.fontSubstitutions || {},
          useNativeVideo: true,
        },
        outputFile,
        codec: 'h264',
        imageFormat: 'jpeg',
        chromiumOptions: { disableWebSecurity: true, gl: null },
        scale,
        crf: 23,
        x264Preset: 'veryfast',
        concurrency: '100%',
        muted: !hasAudio,
        audioCodec: hasAudio ? 'aac' : null,
        enforceAudioTrack: hasAudio,
        timeoutInMilliseconds: Math.max(60_000, Math.ceil(durationInFrames / fps) * 30_000),
        onProgress: options.onProgress,
      });

      const buffer = await sandbox.readFileToBuffer({ path: result.sandboxFilePath || outputFile });
      if (!buffer) throw new Error('Rendered video not found in Sandbox');

      console.log(`✅ [remotion-server] Video rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
      return buffer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && (msg.includes('410') || msg.includes('gone') || msg.includes('not ok'))) {
        console.warn(`⚠️ [remotion-server] Sandbox expired, recreating...`);
        sandboxPool.delete('export');
        continue;
      }
      throw err;
    }
  }

  throw new Error('renderDesignVideo: all attempts failed');
}
