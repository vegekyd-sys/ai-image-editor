/**
 * Server-side Remotion rendering via Vercel Sandbox.
 * Uses Snapshot for fast startup + font caching.
 * Sandbox is reused across renders within the same Lambda instance.
 */

import type { DesignPayload } from '@/types';
import { hasRemotionAudioSources } from '@/lib/remotion-audio';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\[rn]|[\r\n]/g, '').trim();
  return value || undefined;
}

// ─── Sandbox pool (reuse across renders and requests) ─────────────────────

type SandboxInstance = import('@vercel/sandbox').Sandbox;

let _sandboxId: string | null = null;
let _sandboxPromise: Promise<SandboxInstance> | null = null;

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

function isRemoteImageUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^https?:\/\//i.test(value)
    && (
      /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(value)
      || (/\/storage\/v1\/object\/public\//i.test(value) && !/\.(?:mp3|wav|m4a|aac|ogg|mp4|webm|mov)(?:[?#].*)?$/i.test(value))
    );
}

async function remoteImageToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`);
    const arrayBuffer = await res.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
  } catch (err) {
    console.warn('[remotion-server] failed to inline image URL for sandbox:', url, err);
    return null;
  }
}

async function resolveRemoteImagesInValue(
  value: unknown,
  cache: Map<string, Promise<string | null>>,
): Promise<unknown> {
  if (isRemoteImageUrl(value)) {
    let promise = cache.get(value);
    if (!promise) {
      promise = remoteImageToDataUrl(value);
      cache.set(value, promise);
    }
    return (await promise) || value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(item => resolveRemoteImagesInValue(item, cache)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [
        key,
        await resolveRemoteImagesInValue(child, cache),
      ] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function resolveRemoteImagesForSandbox(design: DesignPayload): Promise<{
  code: string;
  props: Record<string, unknown>;
}> {
  const cache = new Map<string, Promise<string | null>>();
  const urlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(?:jpg|jpeg|png|webp|gif)(?:[^\s"'`<>)}\]]*)?/gi;
  let code = design.code;
  const urls = Array.from(new Set(code.match(urlPattern) || [])).filter(isRemoteImageUrl);

  await Promise.all(urls.map(async (url) => {
    let promise = cache.get(url);
    if (!promise) {
      promise = remoteImageToDataUrl(url);
      cache.set(url, promise);
    }
    const dataUrl = await promise;
    if (dataUrl) {
      while (code.includes(url)) code = code.replace(url, dataUrl);
    }
  }));

  const props = await resolveRemoteImagesInValue(design.props || {}, cache) as Record<string, unknown>;
  return { code, props };
}

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
    const vcpus = Number(process.env.REMOTION_SANDBOX_VCPUS || 8);
    const sandbox = await Sandbox.create({
      source: { type: 'snapshot', snapshotId },
      resources: { vcpus },
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
          code: prepareRemotionCodeForSandbox(design.code),
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
      skipFontLoading: readEnv('REMOTION_LOCAL_SKIP_FONTS') !== 'false',
    });
  }

  const { renderMediaOnVercel } = await import('@remotion/vercel');

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 1 / fps;
  const durationInFrames = Math.max(1, Math.round(fps * dur));
  const outputFile = `/tmp/remotion-export-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const resolvedDesign = await resolveRemoteImagesForSandbox(design);
  const hasAudio = hasRemotionAudioSources(resolvedDesign.code);

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
          code: prepareRemotionCodeForSandbox(resolvedDesign.code),
          designProps: resolvedDesign.props,
          fps,
          durationInFrames,
          width: design.width || 1080,
          height: design.height || 1920,
          useNativeVideo: true,
        },
        outputFile,
        codec: 'h264',
        imageFormat: 'jpeg',
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
        _sandboxPromise = null;
        _sandboxId = null;
        continue;
      }
      throw err;
    }
  }

  throw new Error('renderDesignVideo: all attempts failed');
}
