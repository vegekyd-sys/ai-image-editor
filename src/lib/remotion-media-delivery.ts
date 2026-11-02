import {createHmac} from 'node:crypto';
import type {DesignPayload} from '@/types';
import {mapDesignMedia, mediaDeliveryUrl} from './media-delivery';
import {nativeR2Credentials, nativeR2Ready, signNativeR2Url} from './remotion-r2-delivery';

const ORIGINAL = 'https://sdyrtztrjgmmpnirswxt.supabase.co';
const TOKEN = '__mk_render';
const RAW_MEDIA = /\/object\/public\/images\/.+\.(?:wav|mp3|m4a|aac|ogg|mp4|mov|webm|m4v)$/i;
export interface Metadata {etag: string; size: number; type: string; freshness: number; modified?: string}
interface Options {origin?: string; secret?: string; userId: string; budgetMs?: number; fetch?: typeof fetch; now?: number; readySignal?: Promise<unknown>;
  mode?: 'worker' | 'r2-native'; nativeSigner?: typeof signNativeR2Url}
export interface RenderDeliveryPlan {
  sources(design: DesignPayload): Record<string, string>;
  summary: {enabled: boolean; eligible: number; versioned: number; bypassed: number; lookupMs: number; mode: 'worker' | 'r2-native'};
}
interface PendingDelivery {promise: Promise<RenderDeliveryPlan>; release(): void; createdAt: number}
const pendingDeliveries = new Map<string, PendingDelivery>();
const queueKey = (userId: string, projectId: string, fingerprint: string) => JSON.stringify([userId, projectId, fingerprint]);

/** Start before existing job lookup/insert/claim work; no job waits for this prefetch. */
export function beginQueuedMediaDelivery(design: DesignPayload, userId: string, projectId: string, fingerprint: string): void {
  if (!process.env.REMOTION_MEDIA_DELIVERY_ORIGIN || (process.env.REMOTION_MEDIA_DELIVERY_SECRET?.length || 0) < 32) return;
  for (const [key, value] of pendingDeliveries) if (Date.now() - value.createdAt > 30_000) {value.release(); pendingDeliveries.delete(key);}
  const key = queueKey(userId, projectId, fingerprint);
  if (pendingDeliveries.has(key)) return;
  if (pendingDeliveries.size >= 64) {
    const oldest = pendingDeliveries.keys().next().value;
    if (oldest) {pendingDeliveries.get(oldest)?.release(); pendingDeliveries.delete(oldest);}
  }
  let release: () => void = () => {};
  const readySignal = new Promise<void>(resolve => {release = resolve;});
  pendingDeliveries.set(key, {createdAt: Date.now(), release,
    promise: resolveRemotionMediaDelivery(design, {userId, readySignal})});
}

export function takeQueuedMediaDelivery(userId: string, projectId: string, fingerprint?: string): PendingDelivery | null {
  if (!fingerprint) return null;
  const key = queueKey(userId, projectId, fingerprint); const value = pendingDeliveries.get(key);
  pendingDeliveries.delete(key);
  if (!value) return null;
  if (Date.now() - value.createdAt > 30_000) {value.release(); return null;}
  return value;
}

function eligible(url: string): boolean {
  if (mediaDeliveryUrl(url, 'https://media-cache.makaron.app') === url) return false;
  try {return RAW_MEDIA.test(new URL(url).pathname);} catch {return false;}
}

/** Signs only a temporary render copy; the token never enters saved compositions. */
export function signRenderMediaUrl(url: string, origin: string, secret: string, metadata?: Metadata, now = Date.now(), delivery?: 'native'): string {
  if (!eligible(url) || secret.length < 32 || !['https://cdn.makaron.app', 'https://media-cache.makaron.app'].includes(origin)) return url;
  const target = mediaDeliveryUrl(url, origin);
  if (target === url && new URL(origin).origin !== new URL(url).origin) return url;
  const canonical = new URL(url); canonical.hostname = new URL(ORIGINAL).hostname;
  canonical.hash = ''; canonical.search = canonical.searchParams.toString();
  // Stable within the hour so renderer/browser HTTP caches can be reused.
  const expires = Math.floor(now / 3600_000) * 3600_000 + 6 * 3600_000;
  const payload = Buffer.from(JSON.stringify({v: 1, expires, ...(delivery ? {delivery} : {}), ...(metadata ? {metadata} : {bypass: true})})).toString('base64url');
  const signature = createHmac('sha256', secret).update(canonical.href + '\n' + payload).digest('base64url');
  const output = new URL(target); output.searchParams.set(TOKEN, payload + '.' + signature);
  return output.href;
}

async function metadata(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Metadata | null> {
  const source = new URL(url); source.hostname = new URL(ORIGINAL).hostname; source.hash = '';
  const response = await fetcher(source.href, {headers: {Range: 'bytes=0-0', Accept: '*/*', 'Accept-Encoding': 'identity'}, cache: 'no-store', redirect: 'error', signal});
  try {
    const full = /^bytes 0-0\/(\d+)$/.exec(response.headers.get('content-range') || '');
    const size = Number(full?.[1]);
    const etag = response.headers.get('etag') || '';
    const type = response.headers.get('content-type') || '';
    const policy = response.headers.get('cache-control') || '';
    const userCookie = (response.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/)
      .some(cookie => cookie.trim() && !/^\s*(?:__cf_bm|_cfuvid)=/.test(cookie));
    if (response.status !== 206 || !full || !Number.isSafeInteger(size) || size <= 0 || size > 500 * 1024 ** 2
      || !/^"[^"\r\n]{1,128}"$/.test(etag) || !/^(audio|video)\//i.test(type) || type.length > 128
      || /private|no-store/i.test(policy) || userCookie || (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')) return null;
    const age = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(policy);
    return {etag, size, type, freshness: /(?:^|,)\s*no-cache\b/i.test(policy) ? 0 : Math.min(3600, age ? Number(age[1]) : 60),
      ...(Number.isFinite(Date.parse(response.headers.get('last-modified') || '')) ? {modified: response.headers.get('last-modified')!} : {})};
  } finally {await response.body?.cancel();}
}

/** Begin alongside existing design resolution/preparation; never wait for a replica fill. */
export async function resolveRemotionMediaDelivery(design: Pick<DesignPayload, 'code' | 'props'>, options: Options): Promise<RenderDeliveryPlan> {
  const origin = options.origin || process.env.REMOTION_MEDIA_DELIVERY_ORIGIN;
  const secret = options.secret || process.env.REMOTION_MEDIA_DELIVERY_SECRET;
  const mode = options.mode || (process.env.REMOTION_MEDIA_DELIVERY_MODE === 'r2-native' ? 'r2-native' : 'worker');
  const summary = {enabled: false, eligible: 0, versioned: 0, bypassed: 0, lookupMs: 0, mode};
  if (!origin || !secret || secret.length < 32 || !['https://cdn.makaron.app', 'https://media-cache.makaron.app'].includes(origin)
    || (mode === 'r2-native' && !options.nativeSigner && !nativeR2Credentials())) {
    return {summary, sources: () => ({})};
  }
  summary.enabled = true;
  const urls = new Set<string>();
  mapDesignMedia(design as DesignPayload, url => {if (eligible(url)) urls.add(url); return url;});
  const candidates = [...urls].filter(url => {
    try {return Boolean(options.userId) && !/[\\/%]/.test(options.userId)
      && new URL(url).pathname.startsWith(`/storage/v1/object/public/images/${options.userId}/`);} catch {return false;}
  }).slice(0, 64);
  summary.eligible = candidates.length;
  const versions = new Map<string, Metadata>();
  const nativeSources = new Map<string, string>();
  const start = Date.now(); const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolve => {timer = setTimeout(() => {controller.abort(); resolve();}, options.budgetMs ?? (options.readySignal ? 2000 : 75));});
  let cursor = 0;
  const work = Promise.all(Array.from({length: Math.min(4, candidates.length)}, async () => {
    while (!controller.signal.aborted && cursor < candidates.length) {
      const url = candidates[cursor++];
      try {
        const value = await metadata(url, options.fetch || fetch, controller.signal);
        if (value && !controller.signal.aborted) {
          versions.set(url, value);
          if (mode === 'r2-native') {
            const fetcher = options.fetch || fetch;
            const warm = signRenderMediaUrl(url, origin, secret, value, options.now, 'native');
            // Start the disposable copy independently. Neither copy completion
            // nor a failed warm request owns the current export's latency.
            void fetcher(warm, {headers: {Range: 'bytes=0-0', Accept: '*/*'}, cache: 'no-store', signal: AbortSignal.timeout(2000)})
              .then(response => response.body?.cancel()).catch(() => {});
            const signed = await (options.nativeSigner || signNativeR2Url)(url, value, options.now);
            if (signed && await nativeR2Ready(signed, value, fetcher, controller.signal) && !controller.signal.aborted) nativeSources.set(url, signed);
          }
        }
      } catch { /* A slow/unavailable source retains the existing origin path. */ }
    }
  }));
  await Promise.race([work, deadline, ...(options.readySignal ? [options.readySignal] : [])]); clearTimeout(timer); controller.abort();
  summary.lookupMs = Date.now() - start; summary.versioned = mode === 'r2-native' ? nativeSources.size : versions.size; summary.bypassed = urls.size - summary.versioned;
  return {summary, sources: value => {
    const sources: Record<string, string> = Object.create(null);
    mapDesignMedia(value, url => {
      if (eligible(url)) {
        const version = versions.get(url);
        const original = new URL(url); original.hostname = new URL(ORIGINAL).hostname;
        sources[url] = mode === 'r2-native' ? nativeSources.get(url) || original.href
          : version ? signRenderMediaUrl(url, origin, secret, version, options.now) : original.href;
      }
      return url;
    });
    return sources;
  }};
}
