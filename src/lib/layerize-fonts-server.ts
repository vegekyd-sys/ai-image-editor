import { getSupabaseAdmin } from './supabase/service';
import * as workspace from './workspace';
import { readProviderImage } from './provider-image-preflight';
import { layerizeFontsReference, parseLayerizeFontsResult, resolveLayerizeFontsForRender, type LayerizeFontsResult } from './layerize-fonts';
import type { DesignPayload } from '@/types';
import type { LayerizeManifest } from './layerize-design';

const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export interface LayerizeFontsOwner { userId: string; projectId: string }
async function accessible(owner: LayerizeFontsOwner, snapshotId: string) {
  if (!idPattern.test(owner.projectId) || !idPattern.test(snapshotId)) throw new Error('Invalid font matching reference');
  const admin = getSupabaseAdmin();
  const { data: project } = await admin.from('projects').select('user_id').eq('id', owner.projectId).maybeSingle();
  if (project?.user_id !== owner.userId) throw new Error('Font matching project is not accessible');
  const { data: snapshot } = await admin.from('snapshots').select('design_path').eq('id', snapshotId).eq('project_id', owner.projectId).maybeSingle();
  if (!snapshot?.design_path) return null;
  const file = await workspace.readFile(snapshot.design_path, admin, owner.userId, { fresh: true });
  if (!file) return null;
  const design = JSON.parse(file.content) as DesignPayload;
  const ref = layerizeFontsReference(design);
  return ref?.projectId === owner.projectId && ref.snapshotId === snapshotId ? ref : null;
}
export async function readLayerizeFonts(owner: LayerizeFontsOwner, snapshotId: string): Promise<LayerizeFontsResult | null> {
  if (!await accessible(owner, snapshotId)) return null;
  const file = await workspace.readFile(`${owner.projectId}/layerize/${snapshotId}/text-fonts.json`, getSupabaseAdmin(), owner.userId, { fresh: true });
  return file ? parseLayerizeFontsResult(JSON.parse(file.content)) : null;
}
/** Independent resumable task. It only writes the font sidecar, never a design or snapshot. */
export async function finishLayerizeFonts(owner: LayerizeFontsOwner, snapshotId: string): Promise<void> {
  if (!await accessible(owner, snapshotId)) return;
  const admin = getSupabaseAdmin(), base = `${owner.projectId}/layerize/${snapshotId}`, lock = `${base}/text-fonts.lock`, now = new Date().toISOString();
  const inserted = await admin.from('workspace_files').insert({ user_id: owner.userId, path: lock, content_type: 'application/octet-stream', size_bytes: 0, storage_url: '', updated_at: now });
  if (inserted.error) {
    if (inserted.error.code !== '23505') throw new Error('Font matching could not claim its task');
    const { data: previous } = await admin.from('workspace_files').select('updated_at').eq('user_id', owner.userId).eq('path', lock).maybeSingle();
    if (!previous || Date.now() - Date.parse(previous.updated_at) < 120_000) return;
    const renewed = await admin.from('workspace_files').update({ updated_at: now }).eq('user_id', owner.userId).eq('path', lock).eq('updated_at', previous.updated_at).select('path');
    if (renewed.error || renewed.data?.length !== 1) return;
  }
  try {
    const existing = await workspace.readFile(`${base}/text-fonts.json`, admin, owner.userId, { fresh: true });
    if (existing) { parseLayerizeFontsResult(JSON.parse(existing.content)); return; }
    const recipe = await workspace.readFile(`${base}/manifest.json`, admin, owner.userId, { fresh: true });
    if (!recipe) throw new Error('Font matching source is not ready');
    const manifest = JSON.parse(recipe.content) as LayerizeManifest;
    const lines = manifest.layers.filter(l => !l.text?.preserveRaster).flatMap(l => (l.text?.lines || []).flatMap((line, i) => line.appearance ? [{ id: `layer_${l.z}_text_${i}`, line }] : []));
    const { fitLayerizeText, layerizeMatchingFaces } = await import('./layerize-text-fit');
    const faces = await layerizeMatchingFaces(lines.map(l => l.line.font));
    const fits: LayerizeFontsResult['fits'] = {};
    // Bound both media decoding and matching when many text rows are recognized.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, lines.length) }, async () => {
      for (;;) {
        const entry = lines[next++]; if (!entry) break;
        const pixels = await readProviderImage(entry.line.appearance!.rasterUrl, 30 * 1024 * 1024);
        const fit = await fitLayerizeText(pixels, entry.line.text, entry.line.font, entry.line.color, faces);
        if (fit) fits[entry.id] = fit;
      }
    }));
    const result: LayerizeFontsResult = { version: 1, status: 'ready', fits };
    parseLayerizeFontsResult(result);
    const saved = await workspace.writeFile(`${base}/text-fonts.json`, JSON.stringify(result), admin, owner.userId, 'application/json');
    if (!saved.success) throw new Error('Font matching result persistence failed');
    console.info('[layerize-fonts]', JSON.stringify({ snapshotId, status: 'ready', matched: Object.keys(fits).length }));
  } catch (error) {
    // Do not touch the published design, bill or provider task. A future GET resumes this task.
    console.warn('[layerize-fonts]', JSON.stringify({ snapshotId, status: 'retryable', message: error instanceof Error ? error.message : 'Font matching pending' }));
  } finally {
    await admin.from('workspace_files').delete().eq('user_id', owner.userId).eq('path', lock).eq('updated_at', now);
  }
}

/** CLI/worker exports can request matching without an open browser or a Next request scope. */
export async function resolveLayerizeFontsForServerRender(design: DesignPayload, signal?: AbortSignal): Promise<DesignPayload> {
  return resolveLayerizeFontsForRender(design, signal, async () => {
    const ref = layerizeFontsReference(design);
    if (!ref) return;
    const userId = ref.storagePath.split('/images/')[1]?.split('/')[0];
    if (!userId || !idPattern.test(userId)) throw new Error('Invalid font matching owner');
    await finishLayerizeFonts({ userId, projectId: ref.projectId }, ref.snapshotId);
  });
}
