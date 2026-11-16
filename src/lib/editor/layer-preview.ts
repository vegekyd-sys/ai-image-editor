import type { DesignPayload, Snapshot } from '@/types';
import { getOriginFormatThumbnailUrl, getThumbnailUrl } from '@/lib/supabase/storage';
import { hasCompleteRasterLayerManifest } from '@/lib/layerize-design';
import { isFixedCanvasDesign } from './design-layer-state';

export function isLayerSnapshot(snapshot?: Snapshot): boolean {
  return !!snapshot && !snapshot.design?.animation && (
    !!snapshot.design?.layerizeManifestPath ||
    (!!snapshot.designPath && (snapshot.description === 'Layerized image' || /\/layerize\/[^/]+\/poster\./.test(snapshot.imageUrl ?? ''))) ||
    (!!snapshot.design && isFixedCanvasDesign(snapshot.design) && !!snapshot.design.editables?.some(field => /^layer_\d+/.test(field.id))) ||
    // Agent-authored revisions can omit the original manifest and sizing tags.
    // Retained layer image bindings still identify their Layerize origin.
    !!snapshot.design?.editables?.some(field => field.type === 'image' && /^layer_\d+(?:_|$)/.test(field.id)
      && typeof snapshot.design?.props?.[field.propKey] === 'string'
      && (snapshot.design.props[field.propKey] as string).includes('/layerize/'))
  );
}

// Keep original URLs in saved designs and exports. On a touch screen, a tiny
// object on a poster does not need a full provider-sized bitmap in the Player.
export function layerPreviewSources(design: DesignPayload, viewportWidth: number, dpr: number, webp = false): Map<string, string> {
  const sources = new Map<string, string>();
  if (!isFixedCanvasDesign(design) || design.animation) return sources;
  const scale = Math.min(1, viewportWidth * Math.min(dpr, 3) / design.width);
  const images = /<Img data-editable="layer_\d+" src=\{props\.(layer_\d+)\} style=\{\{([^{}]+)\}\}/g;
  for (const match of design.code.matchAll(images)) {
    const source = design.props?.[match[1]];
    if (typeof source !== 'string' || !source.includes('/layerize/')) continue;
    const width = Number(/"width":(\d+(?:\.\d+)?)/.exec(match[2])?.[1]);
    const height = Number(/"height":(\d+(?:\.\d+)?)/.exec(match[2])?.[1]);
    if (!width || !height) continue;
    const size = Math.min(1600, Math.max(64, Math.ceil(Math.max(width, height) * scale / 64) * 64));
    const thumbnail = webp ? getThumbnailUrl(source, size, 95, size, 'contain')
      : getOriginFormatThumbnailUrl(source, size, 95, size, 'contain');
    sources.set(source, webp && thumbnail.includes('/storage/v1/render/image/public/') ? thumbnail + '&format=webp' : thumbnail);
  }
  return sources;
}

// A single transparent rendition per generated layer lets the SSR resource hint
// and the Player request the same URL before the editor knows its viewport.
export function playerLayerSources(design: DesignPayload): Map<string, string> | undefined {
  if (hasCompleteRasterLayerManifest(design)) return layerPreviewSources(design, design.width, 1, true);
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
    return layerPreviewSources(design, window.innerWidth, window.devicePixelRatio || 1);
  }
}

const openingImages = new Map<string, Promise<Blob>>();

export async function fetchPreviewImageBlob(url: string): Promise<Blob> {
  const opening = openingImages.get(url);
  if (opening) return opening;
  const response = await fetch(url, url.includes('/layerize/') ? { signal: AbortSignal.timeout(20_000) } : undefined);
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Image fetch returned ${contentType || 'an unknown content type'}`);
  }
  return response.blob();
}

// Share the actual download with the Player, even when the HTTP cache is cold.
// Evict failed requests immediately so the usual retry/fallback can run.
export function preloadLayerImages(design: DesignPayload): void {
  const previews = playerLayerSources(design);
  const sources = new Set<string>();
  for (const field of design.editables ?? []) {
    const source = design.props?.[field.type === 'image' ? field.propKey : field.propKey + '_source'];
    if (typeof source === 'string' && /^https?:\/\//.test(source)) sources.add(previews?.get(source) ?? source);
  }
  for (const source of sources) {
    if (openingImages.has(source)) continue;
    const request = fetchPreviewImageBlob(source);
    openingImages.set(source, request);
    const release = () => {
      if (openingImages.get(source) === request) openingImages.delete(source);
    };
    void request.then(() => window.setTimeout(release, 10_000), release);
  }
}
