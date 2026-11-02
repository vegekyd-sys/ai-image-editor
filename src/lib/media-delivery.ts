import type {DesignPayload} from '@/types';

const SOURCES = new Set(['sdyrtztrjgmmpnirswxt.supabase.co', 'cdn.makaron.app']);
const DESTINATIONS = new Set(['cdn.makaron.app', 'media-cache.makaron.app']);
const URL_TOKEN = /https?:\/\/[^\s"'`<>)}\]]+/g;
const PUBLIC_MEDIA = /^\/storage\/v1\/(?:object\/public|render\/image\/public)\/images\/.+\.(?:png|jpe?g|webp|gif|avif|svg|wav|mp3|m4a|aac|ogg|mp4|mov|webm|m4v)$/i;
const QUERY_KEYS = new Set(['width', 'height', 'quality', 'resize', 'format', 'download']);

/** Transport-only routing. Canonical saved media, trims and encoding stay intact. */
export function mediaDeliveryUrl(value: string, destination?: string): string {
  if (!destination || /%2f|%5c|%2e/i.test(value)) return value;
  try {
    const target = new URL(destination);
    const source = new URL(value);
    if (target.protocol !== 'https:' || !DESTINATIONS.has(target.hostname) || target.port || target.username || target.password
      || target.pathname !== '/' || target.search || target.hash
      || source.protocol !== 'https:' || source.port || source.username || source.password
      || !SOURCES.has(source.hostname) || !PUBLIC_MEDIA.test(source.pathname)
      || /%2f|%5c|%2e/i.test(source.pathname)
      || [...source.searchParams.keys()].some(key => !QUERY_KEYS.has(key))) return value;
    source.hostname = target.hostname;
    return source.href;
  } catch {return value;}
}

export function mapDesignMedia(design: DesignPayload, transform: (url: string) => string): DesignPayload {
  function route(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(URL_TOKEN, transform);
    if (Array.isArray(value)) return value.map(route);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, route(item)]));
    return value;
  }
  return {...design, code: route(design.code) as string, props: route(design.props) as DesignPayload['props']};
}

export function routeDesignMedia(design: DesignPayload, destination?: string): DesignPayload {
  return destination ? mapDesignMedia(design, url => mediaDeliveryUrl(url, destination)) : design;
}
