import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import type {DesignPayload} from '@/types';
import {collectPreviewMediaSources, localizePreviewMedia} from './remotion-preview-media';
import {EXPORT_MEDIA_PREPARATION_SCRIPT} from './remotion-export-media-script';
import {awaitPreviewOperation, runPreviewCommand} from './remotion-preview-command';

export const EXPORT_MEDIA_RECIPE = 'h264-source-size-crf18-aac-v1';
const MAX_MANIFEST_AGE_MS = 6 * 24 * 60 * 60 * 1000;
const exec = promisify(execFile);
interface Probe {
  codec: string; width: number; height: number; fps: number; duration: number;
  audioStreams: number; hdr: boolean; alpha: boolean;
}
export interface ExportMediaManifest {
  prepared: boolean; original: Probe; output?: Probe; bytes?: number; reason?: string;
}
interface CacheManifest extends ExportMediaManifest {recipe: string; createdAt: number}
export interface ExportMediaSummary {sources: number; prepared: number; cacheHits: number; recipe: string}
export interface ExportMediaRunner {
  prepare(url: string, fps: number): Promise<ExportMediaManifest>;
  upload(url: string): Promise<void>;
  stop(): Promise<void>;
}
export interface ExportMediaStore {
  read(key: string): Promise<ExportMediaManifest | null>;
  uploadUrl(key: string): Promise<string>;
  commit(key: string, manifest: ExportMediaManifest): Promise<void>;
  renderUrl(key: string): Promise<string>;
}

function env(name: string): string | undefined {
  return process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim() || undefined;
}
export function exportMediaCacheKey(userId: string, sourceUrl: string, fps: number): string {
  // Include the complete authorized source URL and owner; never share private media across accounts.
  const hash = createHash('sha256').update(JSON.stringify([userId, sourceUrl, fps, EXPORT_MEDIA_RECIPE])).digest('hex');
  // Reuse the existing Remotion 7-day bucket lifecycle, without changing bucket configuration.
  return `renders/7-days-media-${hash}`;
}
function notFound(error: unknown): boolean {
  const e = error as {name?: string; $metadata?: {httpStatusCode?: number}};
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}
function mediaStore(): ExportMediaStore {
  const serveUrl = env('REMOTION_LAMBDA_SERVE_URL');
  const bucket = env('REMOTION_LAMBDA_BUCKET_NAME') || (serveUrl && new URL(serveUrl).hostname.split('.s3.')[0]);
  if (!bucket || bucket.includes('amazonaws.com')) throw new Error('Remotion media cache bucket is not configured');
  const accessKeyId = env('REMOTION_AWS_ACCESS_KEY_ID') || env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('REMOTION_AWS_SECRET_ACCESS_KEY') || env('AWS_SECRET_ACCESS_KEY');
  const sessionToken = env('REMOTION_AWS_SESSION_TOKEN') || env('AWS_SESSION_TOKEN');
  const client = new S3Client({
    region: env('REMOTION_LAMBDA_REGION') || env('AWS_REGION') || 'us-east-1',
    credentials: accessKeyId && secretAccessKey ? {accessKeyId, secretAccessKey, sessionToken} : undefined,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  return {
    async read(key) {
      try {
        const response = await client.send(new GetObjectCommand({Bucket: bucket, Key: `${key}/manifest.json`}));
        const value = JSON.parse(await response.Body!.transformToString()) as CacheManifest;
        if (value.recipe !== EXPORT_MEDIA_RECIPE || !Number.isFinite(value.createdAt)
          || Date.now() - value.createdAt > MAX_MANIFEST_AGE_MS || typeof value.prepared !== 'boolean') return null;
        if (value.prepared) {
          const object = await client.send(new HeadObjectCommand({Bucket: bucket, Key: `${key}/source.mp4`}));
          if (!value.bytes || object.ContentLength !== value.bytes) return null;
        }
        return value;
      } catch (error) { if (notFound(error)) return null; throw error; }
    },
    uploadUrl: key => getSignedUrl(client, new PutObjectCommand({
      Bucket: bucket, Key: `${key}/source.mp4`, ContentType: 'video/mp4', ACL: 'private',
    }), {expiresIn: 3600}),
    async commit(key, manifest) {
      // Publish the manifest only after the complete validated video was uploaded.
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: `${key}/manifest.json`, ContentType: 'application/json', ACL: 'private',
        Body: JSON.stringify({...manifest, recipe: EXPORT_MEDIA_RECIPE, createdAt: Date.now()}),
      }));
    },
    renderUrl: key => getSignedUrl(client, new GetObjectCommand({Bucket: bucket, Key: `${key}/source.mp4`}), {expiresIn: 6 * 3600}),
  };
}

/** One VM per export, serial bounded preparation; large files never pass through the app heap. */
export async function createExportMediaRunner(signal: AbortSignal): Promise<ExportMediaRunner> {
  const useSandbox = Boolean(env('VERCEL') || env('MEDIA_SANDBOX_SNAPSHOT_ID')) && env('MEDIA_SANDBOX_EXECUTOR') !== 'local';
  if (!useSandbox) {
    const root = await mkdtemp(path.join(tmpdir(), 'makaron-export-media-'));
    const script = path.join(root, 'prepare.cjs');
    await writeFile(script, EXPORT_MEDIA_PREPARATION_SCRIPT);
    const run = async (request: Record<string, unknown>) => {
      await writeFile(path.join(root, 'request.json'), JSON.stringify({...request, timeoutMs: 240_000}), {mode: 0o600});
      await exec(process.execPath, [script], {cwd: root, signal, timeout: 250_000, maxBuffer: 1024 ** 2});
    };
    return {
      async prepare(url, fps) { await run({action: 'prepare', url, fps}); return JSON.parse(await readFile(path.join(root, 'result.json'), 'utf8')); },
      upload: uploadUrl => run({action: 'upload', uploadUrl}),
      stop: () => rm(root, {recursive: true, force: true}),
    };
  }
  const {Sandbox} = await import('@vercel/sandbox');
  const snapshotId = env('MEDIA_SANDBOX_SNAPSHOT_ID');
  const sandbox = await Sandbox.create({
    ...(snapshotId ? {source: {type: 'snapshot', snapshotId}} : {runtime: 'node24'}),
    resources: {vcpus: 4}, timeout: 15 * 60_000, signal,
  });
  const root = '/vercel/sandbox/export-media';
  try {
    await sandbox.mkDir(root);
    // A fresh runtime can bootstrap the same pinned binary packages as the media snapshot.
    if (!snapshotId) {
      const installed = await sandbox.runCommand({cmd: 'npm', args: ['install', '--no-audit', '--no-fund', '--prefix', '/vercel/sandbox', 'ffmpeg-static@5.3.0', 'ffprobe-static@3.1.0'], signal});
      if (installed.exitCode !== 0) throw new Error('Export media binary setup failed');
    }
    const script = `${root}/prepare.cjs`;
    await sandbox.writeFiles([{path: script, content: Buffer.from(EXPORT_MEDIA_PREPARATION_SCRIPT)}], {signal});
    const run = async (request: Record<string, unknown>) => {
      // runPreviewCommand uses detached process exit + cancellation, not the unreliable log stream.
      await sandbox.writeFiles([{path: `${root}/request.json`, content: Buffer.from(JSON.stringify({...request, timeoutMs: 240_000}))}], {signal});
      await runPreviewCommand(sandbox, ['-e', `process.chdir(${JSON.stringify(root)});require(${JSON.stringify(script)})`], signal);
    };
    return {
      async prepare(url, fps) {
        await run({action: 'prepare', url, fps});
        const result = await awaitPreviewOperation(sandbox.readFileToBuffer({path: `${root}/result.json`}), signal);
        if (!result) throw new Error('Export media worker returned no manifest');
        return JSON.parse(result.toString());
      },
      upload: uploadUrl => run({action: 'upload', uploadUrl}),
      async stop() { await sandbox.stop(); },
    };
  } catch (error) { await sandbox.stop().catch(() => undefined); throw error; }
}

const pending = new Map<string, Promise<ExportMediaManifest>>();
export async function prepareRemotionExportMedia(design: DesignPayload, options: {
  userId: string;
  onHeartbeat?: () => Promise<void>;
  // Internal seams for real local-runtime and cache/ownership regression tests.
  store?: ExportMediaStore;
  createRunner?: (signal: AbortSignal) => Promise<ExportMediaRunner>;
}): Promise<{design: DesignPayload; summary: ExportMediaSummary}> {
  const sources = collectPreviewMediaSources(design);
  const summary = {sources: sources.length, prepared: 0, cacheHits: 0, recipe: EXPORT_MEDIA_RECIPE};
  if (!sources.length || env('REMOTION_EXPORT_PREPARE_MEDIA') === 'false') return {design, summary};
  const fps = design.animation?.fps || 30;
  const store = options.store || mediaStore();
  const signal = AbortSignal.timeout(12 * 60_000);
  let runner: ExportMediaRunner | undefined;
  let stoppedHeartbeat = false;
  const heartbeat = setInterval(() => { if (!stoppedHeartbeat) void options.onHeartbeat?.().catch(() => undefined); }, 15_000);
  heartbeat.unref?.();
  const replacements: Array<{url: string; path: string}> = [];
  try {
    await options.onHeartbeat?.();
    for (const source of sources) {
      const key = exportMediaCacheKey(options.userId, source.url, fps);
      let manifest = await store.read(key);
      if (manifest) summary.cacheHits++;
      else {
        let preparation = pending.get(key);
        if (!preparation) {
          preparation = (async () => {
            runner ||= await (options.createRunner || createExportMediaRunner)(signal);
            const value = await runner.prepare(source.url, fps);
            if (value.prepared) await runner.upload(await store.uploadUrl(key));
            await store.commit(key, value);
            return value;
          })();
          pending.set(key, preparation);
          void preparation.finally(() => pending.delete(key)).catch(() => undefined);
        } else summary.cacheHits++;
        manifest = await preparation;
      }
      if (manifest.prepared) {
        summary.prepared++;
        replacements.push({url: source.url, path: await store.renderUrl(key)});
      }
    }
    return {design: localizePreviewMedia(design, replacements), summary};
  } catch (error) {
    // Keep credentials and signed source/upload URLs out of persisted errors and progress.
    const message = error instanceof Error ? error.message : 'unknown preparation failure';
    throw new Error(`Export media preparation failed: ${message.replace(/https?:\/\/[^\s"'<>]+/g, '[URL]').slice(0, 1000)}`);
  } finally {
    stoppedHeartbeat = true; clearInterval(heartbeat);
    await runner?.stop().catch(() => undefined);
  }
}
