import type { SupabaseClient } from '@supabase/supabase-js';
import type { DesignPayload } from '@/types';
import type { SelectedElement } from './editor/element-edit';
import { resolveElement } from './editor/element-edit';
import * as workspace from './workspace';
import sharp from 'sharp';
import { readProviderImage } from './provider-image-preflight';

export async function loadSelectedElement(input: {
  supabase: SupabaseClient; userId: string; projectId: string; selection: SelectedElement;
}) {
  const { data: project } = await input.supabase.from('projects').select('user_id').eq('id', input.projectId).maybeSingle();
  if (project?.user_id !== input.userId) throw new Error('Selected element requires an owned project.');
  const { data: snapshot } = await input.supabase.from('snapshots').select('design_path').eq('project_id', input.projectId).eq('id', input.selection.snapshotId).maybeSingle();
  if (!snapshot?.design_path) throw new Error('Selected composition was not found.');
  const file = await workspace.readFile(snapshot.design_path, input.supabase, input.userId, { fresh: true });
  if (!file) throw new Error('Selected composition could not be read.');
  const design = JSON.parse(file.content) as DesignPayload;
  const field = resolveElement(design, input.selection.fieldId);
  return { design, field, path: snapshot.design_path as string };
}
export interface ElementRegion { x: number; y: number; width: number; height: number }
/** Region is in original asset pixels. Outside it is copied from the source, never generated. */
export async function prepareElementImage(source: string, region?: ElementRegion) {
  const bytes = await readProviderImage(source, 25 * 1024 * 1024);
  const hasAlpha = Boolean((await sharp(bytes).metadata()).hasAlpha);
  const image = await sharp(bytes).rotate().ensureAlpha().png().toBuffer();
  const meta = await sharp(image).metadata();
  const width = meta.width!, height = meta.height!;
  const box = region ? { left: Math.round(region.x), top: Math.round(region.y), width: Math.round(region.width), height: Math.round(region.height) }
    : { left: 0, top: 0, width, height };
  if (![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.left < 0 || box.top < 0 || box.width < 1 || box.height < 1 || box.left + box.width > width || box.top + box.height > height) throw new Error(`Region must fit the source asset (${width}×${height} pixels).`);
  const crop = await sharp(image).extract(box).png().toBuffer();
  return { image, crop, box, width, height, hasAlpha };
}
export async function finishElementImage(prepared: Awaited<ReturnType<typeof prepareElementImage>>, generated: string) {
  const bytes = generated.startsWith('data:') ? Buffer.from(generated.split(',')[1], 'base64')
    : /^https?:/.test(generated) ? await readProviderImage(generated, 25 * 1024 * 1024) : Buffer.from(generated, 'base64');
  const { box, width, height } = prepared;
  const patch = await sharp(bytes).rotate().resize(box.width, box.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  // Copy raw rows: compositing partially transparent pixels would round RGB values
  // outside the requested region. Preserve those bytes exactly, including alpha.
  const pixels = await sharp(prepared.image).ensureAlpha().raw().toBuffer();
  for (let row = 0; row < box.height; row++) {
    patch.copy(pixels, ((box.top + row) * width + box.left) * 4, row * box.width * 4, (row + 1) * box.width * 4);
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
