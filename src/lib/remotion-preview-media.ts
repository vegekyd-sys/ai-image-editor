import { createHash } from 'node:crypto';
import type { DesignPayload } from '@/types';

export interface PreviewMediaSource { url: string; path: string }
const URL_PATTERN = /https?:\/\/[^\s"'`<>)}\]]+/g;

function isVideoSource(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(mp4|mov|webm|m4v)$/i.test(url.pathname)
      || (url.hostname === 'scenes-ai.com' && /^\/v1\/assets\/[^/]+\/media$/.test(url.pathname));
  } catch { return false; }
}

export function collectPreviewMediaSources(design: Pick<DesignPayload, 'code' | 'props'>): PreviewMediaSource[] {
  const urls = new Set<string>();
  function collect(value: unknown): void {
    if (typeof value === 'string') {
      for (const match of value.matchAll(URL_PATTERN)) if (isVideoSource(match[0])) urls.add(match[0]);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(design.code); collect(design.props);
  return [...urls].sort().map(url => ({
    url,
    path: `/makaron-preview-media/${createHash('sha256').update(url).digest('hex')}.mp4`,
  }));
}

/** Only the server-render copy changes; authored sources, trims and timing stay intact. */
export function localizePreviewMedia(design: DesignPayload, sources: PreviewMediaSource[]): DesignPayload {
  const replacements = new Map(sources.map(source => [source.url, source.path]));
  function replace(value: unknown): unknown {
    if (typeof value === 'string') {
      for (const [url, path] of replacements) value = (value as string).split(url).join(path);
      return value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  }
  return { ...design, code: replace(design.code) as string, props: replace(design.props) as DesignPayload['props'] };
}

// Runs inside the Sandbox, streaming to disk rather than into the Agent heap.
// Completed cache files are atomic and shared by all frames in this Sandbox.
export const PREVIEW_MEDIA_PREFETCH_SCRIPT = String.raw`
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
const sources = JSON.parse(process.argv[2]);
const root = process.argv[3] || '/vercel/sandbox/remotion-bundle';
const maxBytes = Number(process.argv[4] || 2 * 1024 ** 3);
const maxCacheBytes = Number(process.argv[5] || 4 * 1024 ** 3);
const timeoutMs = Number(process.argv[6] || 120000);
const lifetime = new AbortController();
process.once('SIGTERM', () => lifetime.abort());
const cacheDir = path.join(root, 'makaron-preview-media');
await fs.mkdir(cacheDir, {recursive:true});
let cacheBytes = 0;
for (const name of await fs.readdir(cacheDir)) cacheBytes += (await fs.stat(path.join(cacheDir,name))).size;
for (const source of sources) {
  lifetime.signal.throwIfAborted();
  if (!/^\/makaron-preview-media\/[a-f0-9]{64}\.mp4$/.test(source.path)) throw new Error('Invalid preview cache path');
  const dest = path.join(root, source.path.slice(1));
  try { if ((await fs.stat(dest)).size > 0) continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const tmp = dest + '.tmp-' + process.pid;
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const response = await fetch(source.url, {signal});
    if (!response.ok || !response.body) throw new Error('Preview source HTTP ' + response.status);
    const declared = Number(response.headers.get('content-length'));
    if (declared > maxBytes || cacheBytes + declared > maxCacheBytes) {
      await response.body.cancel(); throw new Error('Preview source exceeds disk cache budget');
    }
    let bytes = 0;
    const limit = new Transform({transform(chunk,encoding,done) {
      bytes += chunk.length;
      done(bytes > maxBytes || cacheBytes + bytes > maxCacheBytes ? new Error('Preview source exceeds disk cache budget') : null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(tmp), {signal});
    if (!bytes) throw new Error('Preview source is empty');
    await fs.rename(tmp,dest); cacheBytes += bytes;
  } catch (error) {
    await fs.rm(tmp,{force:true});
    // Fetch errors can contain signed source URLs. Keep those out of renderer errors.
    throw new Error(signal.aborted ? 'Preview source download timed out' : 'Preview source could not be cached safely');
  }
}
console.log(JSON.stringify({cachedSources:sources.length,cacheBytes}));
`;
