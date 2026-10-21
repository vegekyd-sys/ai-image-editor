/**
 * Server-side Remotion rendering via Vercel Sandbox.
 * Uses Snapshot for fast startup + font caching.
 * Scoped previews reuse one VM for a short idle window, then retain only disk.
 * Unscoped operations, failures and cancellations stop their VM immediately.
 */

import { createHash, randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { PreviewSessionCache } from './remotion-preview-session';
import { readPreviewMemory, type PreviewRenderMetrics } from './remotion-preview-metrics';
import { awaitPreviewOperation, runPreviewCommand } from './remotion-preview-command';
import type { DesignPayload } from '@/types';
import { hasRemotionAudioSources } from '@/lib/remotion-audio';
import { resolveRemotionFontManifestUrlForDesign } from '@/lib/remotion-font-resolver';
import { normalizeRemotionTextValue } from '@/lib/remotion-text-normalization';
import { collectPreviewMediaSources, localizePreviewMedia, PREVIEW_MEDIA_PREFETCH_SCRIPT } from './remotion-preview-media';
import { PREVIEW_BATCH_SCRIPT } from './remotion-preview-batch';
import {readPreviewCheckpoint,writePreviewCheckpoint} from './remotion-preview-checkpoint';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\[rn]|[\r\n]/g, '').trim();
  return value || undefined;
}

// ─── Operation-scoped Sandbox (reuse within a multi-frame batch) ──────────

type SandboxInstance = import('@vercel/sandbox').Sandbox;

interface SandboxSession {
  promise: Promise<SandboxInstance>;
}
const SANDBOX_LIFETIME_MS = 10 * 60 * 1000;
async function preparePreviewMedia(design: DesignPayload, sandbox: SandboxInstance, signal: AbortSignal): Promise<DesignPayload> {
  const sources = collectPreviewMediaSources(design);
  if (!sources.length) return design;
  signal.throwIfAborted();
  await awaitPreviewOperation(sandbox.writeFiles([{ path: '/tmp/makaron-preview-prefetch.mjs', content: Buffer.from(PREVIEW_MEDIA_PREFETCH_SCRIPT) }], {signal}), signal);
  await runPreviewCommand(sandbox, ['/tmp/makaron-preview-prefetch.mjs', JSON.stringify(sources)], signal);
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

async function createSandboxSession(kind: 'preview' | 'export', signal?: AbortSignal, cachedSnapshotId?: string): Promise<SandboxSession> {
  const { Sandbox } = await import('@vercel/sandbox');
  const snapshotId = cachedSnapshotId || process.env.REMOTION_SNAPSHOT_ID;
  if (!snapshotId) throw new Error('REMOTION_SNAPSHOT_ID not set');
  // Large-project repeats regressed at 2 CPUs; 4 retained 8-CPU warm latency.
  const defaultVcpus = kind === 'preview' ? 4 : 8;
  const configured = Number((kind === 'preview' && readEnv('REMOTION_PREVIEW_SANDBOX_VCPUS')) || readEnv('REMOTION_SANDBOX_VCPUS') || defaultVcpus);
  const vcpus = [1, 2, 4, 6, 8].includes(configured) ? configured : defaultVcpus;
  const promise = Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    resources: { vcpus },
    timeout: SANDBOX_LIFETIME_MS,
    signal,
  });
  return {promise};
}

async function stopSandboxSession(entry: SandboxSession): Promise<void> {
  // Register cleanup even when a cancelled create RPC settles late. Do not let
  // a stranded create/stop RPC undo the caller's bounded cancellation.
  const stopping = entry.promise.then(sandbox => sandbox.stop({signal: AbortSignal.timeout(10_000)}));
  await awaitPreviewOperation(stopping, AbortSignal.timeout(10_000)).catch(() => {
    console.warn('[remotion-server] Sandbox cleanup incomplete; lifetime limit remains the fallback');
  });
}

const previewProcessId=randomUUID();
const resumedSandboxes=new WeakMap<SandboxInstance,{resume:()=>Promise<SandboxInstance>;origin:string}>();
const sharedCheckpointsEnabled=()=>readEnv('REMOTION_PREVIEW_SHARED_CACHE')==='true';
function checkpointResume(snapshotId:string,origin='local-checkpoint'):()=>Promise<SandboxInstance>{
  const resume=async()=>{
    const sandbox=await createSandboxSession('preview',undefined,snapshotId).then(entry=>entry.promise);
    resumedSandboxes.set(sandbox,{resume,origin});
    return sandbox;
  };
  return resume;
}
async function createPreviewSandbox(key:string|undefined,signal:AbortSignal):Promise<SandboxInstance>{
  if(key?.startsWith('media:')&&sharedCheckpointsEnabled()){
    const cached=await readPreviewCheckpoint(key,signal).catch(()=>undefined);
    signal.throwIfAborted();
    if(cached){
      try{return await checkpointResume(cached.snapshotId,'shared-checkpoint')();}
      catch{signal.throwIfAborted();console.warn('[preview-cache] expired snapshot; rebuilding');}
    }
  }
  return createSandboxSession('preview',signal).then(entry=>entry.promise);
}
function makePreviewSessions(){return new PreviewSessionCache<SandboxInstance>(
  value => stopSandboxSession({promise:value}),
  work => after(work),
  Math.min(600_000, Math.max(20_000, Number(readEnv('REMOTION_PREVIEW_IDLE_MS')) || 25_000)),
  SANDBOX_LIFETIME_MS,
  async (value,key,cachedResume) => {
    if (!key.startsWith('media:') || readEnv('REMOTION_PREVIEW_DISK_CACHE') === 'off') {
      await stopSandboxSession({promise:value});
      return undefined;
    }
    // Sources are immutable for this key. Reuse the existing disk checkpoint
    // on subsequent suspensions instead of accumulating a new paid snapshot.
    if (cachedResume) {
      await stopSandboxSession({promise:value});
      return cachedResume;
    }
    const sandbox = await value;
    const started = Date.now();
    // Files only: no paid running VM during a user's thinking time. These
    // owner/source/runtime-scoped cache snapshots expire automatically.
    // The deployed API enforces a one-day minimum, even though the SDK accepts
    // any millisecond duration. One checkpoint is reused for this source set.
    const snapshot = await sandbox.snapshot({expiration:24*60*60_000,signal:AbortSignal.timeout(30_000)});
    console.log('[remotion-preview-suspended]',JSON.stringify({sandboxId:sandbox.sandboxId,snapshotId:snapshot.snapshotId,sizeBytes:snapshot.sizeBytes,suspendMs:Date.now()-started,expiresAt:snapshot.expiresAt?.toISOString()}));
    if(sharedCheckpointsEnabled()){
      await writePreviewCheckpoint({version:1,key,snapshotId:snapshot.snapshotId,sizeBytes:snapshot.sizeBytes,expiresAt:snapshot.expiresAt?.getTime()||Date.now()+86400_000})
        .catch(()=>console.warn('[preview-cache] checkpoint could not be shared'));
    }
    return checkpointResume(snapshot.snapshotId);
  },
  // Publish the first source checkpoint immediately after the first batch.
  // The next Agent request must not wait 25 seconds for a process-local timer.
  (key,session)=>key.startsWith('media:')&&sharedCheckpointsEnabled()&&!session.resume?0:
    Math.min(600_000,Math.max(20_000,Number(readEnv('REMOTION_PREVIEW_IDLE_MS'))||25_000)),
);}
const previewSessions=makePreviewSessions();

function previewSessionKey(design: DesignPayload, scope: string): string {
  return (collectPreviewMediaSources(design).length ? 'media:' : 'text:') + createHash('sha256').update(JSON.stringify([
    'preview-batch-v1',scope, process.env.REMOTION_SNAPSHOT_ID,
    readEnv('REMOTION_PREVIEW_SANDBOX_VCPUS') || readEnv('REMOTION_SANDBOX_VCPUS') || '4',
    collectPreviewMediaSources(design).map(source => source.url),
  ])).digest('hex');
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Render a single frame of a Remotion design via Vercel Sandbox.
 * Use renderDesignFrames for a contact sheet so sources stay cached until the
 * whole batch is complete. Scoped calls share the short idle window.
 */
export async function renderDesignFrame(
  design: DesignPayload,
  frame = 0,
  options: { signal?: AbortSignal; sandboxScope?: string; onMetrics?: (metrics: PreviewRenderMetrics) => void; freshSession?: boolean } = {},
): Promise<Buffer> {
  return (await renderDesignFrames(design, [frame], options))[0]!;
}

export async function renderDesignFrames(
  design: DesignPayload,
  frames: number[],
  options: { signal?: AbortSignal; sandboxScope?: string; onMetrics?: (metrics: PreviewRenderMetrics) => void; freshSession?: boolean } = {},
): Promise<Buffer[]> {
  options.signal?.throwIfAborted();
  if (!frames.length) return [];
  if (readEnv('REMOTION_RENDERER') === 'local') {
    const { renderDesignFrameLocal } = await import('@/lib/remotion-local-renderer');
    const buffers: Buffer[] = [];
    for (const frame of frames) {
      options.signal?.throwIfAborted();
      buffers.push(await renderDesignFrameLocal(design, frame, {
        cacheDir: readEnv('REMOTION_LOCAL_MEDIA_CACHE_DIR'),
        mediaServerPort: Number(readEnv('REMOTION_LOCAL_MEDIA_PORT') || 5123),
      }));
    }
    return buffers;
  }

  const frameSignal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(330_000)]);

  const fps = design.animation?.fps || 30;
  const dur = design.animation?.durationInSeconds || 0;
  const durationInFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;
  const fontManifestUrl = await awaitPreviewOperation(resolveRemotionFontManifestUrlForDesign({
    code: design.code,
    props: design.props || {},
    substitutions: design.fontSubstitutions || {},
  }), frameSignal);
  // Retry once if Sandbox is gone (410/expired)
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = options.sandboxScope ? previewSessionKey(design, options.sandboxScope) : undefined;
    const pool=options.freshSession?makePreviewSessions():previewSessions;
    const lease = key ? pool.acquire(key, () => createPreviewSandbox(key,frameSignal)) : undefined;
    const entry = lease ? {promise:lease.session.value} : await createSandboxSession('preview', frameSignal);
    let successful = false;
    const render = async (sandbox: SandboxInstance): Promise<Buffer[]> => {
      const resumed=resumedSandboxes.get(sandbox);
      if(lease&&resumed)lease.session.resume=resumed.resume;
      const prefetchStart = Date.now();
      const renderDesign = await preparePreviewMedia(design, sandbox, AbortSignal.any([frameSignal, AbortSignal.timeout(240_000)]));
      const metrics: PreviewRenderMetrics = {sandboxId:sandbox.sandboxId,reused:lease?.reused || false,prefetchMs:Date.now()-prefetchStart,frameMs:[],sourceCount:collectPreviewMediaSources(design).length,processId:previewProcessId,cacheOrigin:lease?.reused?'warm':resumed?.origin||'cold'};
      const makeFrameConfig = (frame:number,outputFile:string) => ({
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
        });
      const buffers: Buffer[] = [];
      if(frames.length>1 && readEnv('REMOTION_PREVIEW_BATCH_RENDERER')==='true'){
        const id=randomUUID();
        const outputs=frames.map((frame,index)=>`/tmp/batch-${id}-${index}-${frame}.jpeg`);
        const inputPath=`/tmp/batch-${id}.json`;
        await awaitPreviewOperation(sandbox.writeFiles([
          {path:'/vercel/sandbox/makaron-render-frames-v1.mjs',content:Buffer.from(PREVIEW_BATCH_SCRIPT)},
          {path:inputPath,content:Buffer.from(JSON.stringify({config:makeFrameConfig(0,''),frames:frames.map(frame=>Math.min(frame,durationInFrames-1)),outputs}))},
        ],{signal:frameSignal}),frameSignal);
        const started=Date.now();
        await runPreviewCommand(sandbox,['/vercel/sandbox/makaron-render-frames-v1.mjs',inputPath],frameSignal);
        metrics.batchMs=Date.now()-started;
        for(const output of outputs){
          const buffer=await awaitPreviewOperation(sandbox.readFileToBuffer({path:output},{signal:frameSignal}),frameSignal);
          if(!buffer)throw new Error('Rendered file not found in Sandbox');
          buffers.push(buffer);
        }
        const timing=await sandbox.readFileToBuffer({path:outputs[0]+'.metrics.json'},{signal:frameSignal}).catch(()=>undefined);
        try{metrics.frameMs=JSON.parse(timing?.toString()||'{}').frameMs||[];}catch{/* Metrics must not discard captured images. */}
      }else for (const frame of frames) {
        frameSignal.throwIfAborted();
        const outputFile = `/tmp/still-${frame}-${randomUUID()}.jpeg`;
        const t0 = Date.now();
        console.log(`🎨 [remotion-server] Rendering frame ${frame} (${design.width}x${design.height})...`);
        await runPreviewCommand(sandbox, ['render-still.mjs', JSON.stringify(makeFrameConfig(frame,outputFile))], AbortSignal.any([frameSignal, AbortSignal.timeout(60_000)]));
        const buffer = await awaitPreviewOperation(sandbox.readFileToBuffer({ path: outputFile }, {signal:frameSignal}), frameSignal);
        if (!buffer) throw new Error('Rendered file not found in Sandbox');
        buffers.push(buffer);
        metrics.frameMs.push(Date.now()-t0);
      }
      if (options.onMetrics || readEnv('REMOTION_PREVIEW_METRICS') === 'true') {
        metrics.memory = await readPreviewMemory(sandbox).catch(() => undefined);
        options.onMetrics?.(metrics);
        console.log('[remotion-preview-metrics]',JSON.stringify(metrics));
      }
      return buffers;
    };
    try {
      const result = lease
        ? await pool.run(lease.session, render, frameSignal)
        : await render(await awaitPreviewOperation(entry.promise, frameSignal));
      successful = true;
      console.log('[remotion-preview-session]', JSON.stringify({reused:lease?.reused || false, frames:frames.length, scoped:Boolean(key)}));
      return result;
    } catch (err) {
      frameSignal.throwIfAborted();
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && (msg.includes('410') || msg.includes('gone') || msg.includes('not ok'))) {
        console.warn(`⚠️ [remotion-server] Sandbox expired, recreating...`);
        continue; // retry with fresh sandbox
      }
      throw err;
    } finally {
      if (lease && key) await pool.release(key, lease.session, successful);
      else await stopSandboxSession(entry);
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
    const entry = await createSandboxSession('export');
    const scale = Number.isFinite(options.scale) && options.scale && options.scale > 0 ? options.scale : 1;
    const outputWidth = Math.max(2, Math.round((design.width || 1080) * scale / 2) * 2);
    const outputHeight = Math.max(2, Math.round((design.height || 1920) * scale / 2) * 2);
    console.log(`🎬 [remotion-server] Rendering video ${durationInFrames} frames (${design.width}x${design.height} -> ${outputWidth}x${outputHeight})${attempt > 0 ? ' [retry]' : ''}...`);
    const t0 = Date.now();

    try {
      const sandbox = await entry.promise;
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
        continue;
      }
      throw err;
    } finally {
      await stopSandboxSession(entry);
    }
  }

  throw new Error('renderDesignVideo: all attempts failed');
}
