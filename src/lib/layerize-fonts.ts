import type { DesignPayload } from '@/types';
import type { LayerizeTextFit } from './layerize-text-fit';

export const ASYNC_LAYERIZE_FONTS_MARKER = '/* makaron-layerize-async-fonts-v1 */';
export interface LayerizeFontsReference {
  version: 1; projectId: string; snapshotId: string; storageOrigin: string; storagePath: string;
  originals: Record<string, string>; status: 'pending' | 'ready' | 'failed';
}
export interface LayerizeFontsResult { version: 1; status: 'ready' | 'failed'; fits: Record<string, LayerizeTextFit> }
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export function layerizeFontsReference(design: DesignPayload): LayerizeFontsReference | null {
  if (!design.code.includes(ASYNC_LAYERIZE_FONTS_MARKER)) return null;
  const ref = design.props?._layerizeTextFonts as LayerizeFontsReference | undefined;
  if (!ref || ref.version !== 1 || !['pending', 'ready', 'failed'].includes(ref.status)
    || !new RegExp(`^${uuid}$`, 'i').test(ref.projectId) || !new RegExp(`^${uuid}$`, 'i').test(ref.snapshotId)
    || !/^https:\/\/(?:cdn\.makaron\.app|[a-z0-9-]+\.supabase\.co)$/.test(ref.storageOrigin)
    || !new RegExp(`^/storage/v1/object/public/images/${uuid}/workspace/${ref.projectId}/layerize/${ref.snapshotId}/text-fonts\\.json$`, 'i').test(ref.storagePath)
    || !ref.originals || Object.entries(ref.originals).some(([id, text]) => !/^layer_\d+_text_\d+$/.test(id) || typeof text !== 'string')) return null;
  return ref;
}
export function layerizeUsesOriginalGlyphs(design: DesignPayload): boolean {
  const ref = layerizeFontsReference(design);
  return !!ref && (ref.status === 'pending' || Object.entries(ref.originals).every(([key, text]) => design.props?.[key] === text));
}
export function parseLayerizeFontsResult(value: unknown): LayerizeFontsResult {
  const r = value as LayerizeFontsResult;
  if (!r || r.version !== 1 || !['ready', 'failed'].includes(r.status) || !r.fits || typeof r.fits !== 'object') throw new Error('Invalid font match result');
  for (const [key, fit] of Object.entries(r.fits)) {
    if (!/^layer_\d+_text_\d+$/.test(key) || !fit || !/^[\w -]{1,80}$/.test(fit.family)
      || !Number.isFinite(fit.fontSize) || fit.fontSize <= 0 || fit.fontSize > 10000
      || ![400,500,600,700,800,900].includes(fit.weight) || !/^#[a-f\d]{6}$/i.test(fit.color)
      || !Array.isArray(fit.matrix) || fit.matrix.length !== 6 || fit.matrix.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)
      || !Number.isFinite(fit.score) || fit.score < 0 || fit.score > 1) throw new Error('Invalid font match fit');
  }
  return r;
}
/** Only system font metadata is replaced. Text, geometry, layer order and edit history stay local. */
export function applyLayerizeFonts(design: DesignPayload, result: LayerizeFontsResult): DesignPayload {
  const ref = layerizeFontsReference(design); if (!ref) return design;
  const fits = Object.fromEntries(Object.entries(result.fits).filter(([key]) => Object.hasOwn(ref.originals, key)));
  return { ...design, props: { ...design.props, _layerizeTextFonts: { ...ref, status: result.status }, _layerizeTextFontFits: fits } };
}
export function layerizeFontRenderKey(design: DesignPayload): string {
  return layerizeFontsReference(design) && !layerizeUsesOriginalGlyphs(design)
    ? JSON.stringify([design.props?._layerizeTextFonts, design.props?._layerizeTextFontFits]) : '';
}
/** Export waits only when changed wording actually needs the matched font. */
export async function resolveLayerizeFontsForRender(design: DesignPayload, signal?: AbortSignal): Promise<DesignPayload> {
  const ref = layerizeFontsReference(design);
  if (!ref || ref.status !== 'pending' || Object.entries(ref.originals).every(([key, text]) => design.props?.[key] === text)) return design;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const response = await fetch(`${ref.storageOrigin}${ref.storagePath}?font_version=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]) });
    if (response.ok) return applyLayerizeFonts(design, parseLayerizeFontsResult(await response.json()));
    if (response.status !== 404) throw new Error('Font match result is unavailable');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Font matching is still pending; retry this export shortly.');
}
