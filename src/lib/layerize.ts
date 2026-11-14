import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { getSupabaseAdmin } from './supabase/service';
import * as workspace from './workspace';
import { readProviderImage } from './provider-image-preflight';
import { layerizeRequest, submitLayerize, queryLayerize, LayerizeProviderError, LAYERIZE_MODEL, type LayerizeInput, type LayerizeProviderTask } from './layerize-provider';
import { buildLayerizeDesign, layerizeSupplierCost, type LayerizeLayer, type LayerizeManifest } from './layerize-design';
import { getTokenRate, providerCostToCredits } from './billing/token-rates';
import { isBillingEnabled, requireCredits } from './billing/credits';
import { resolveBillingAttribution, type BillingAttribution } from './billing/attribution';
import { chargeCompletedProviderTask } from './billing/completed-provider-task';
import { publishDesignSnapshot } from './publish-design';
import { validateDesign } from './design-harness';
import type { DesignPayload } from '@/types';
import { prepareLayerizeSource } from './layerize-source';
import { renderLayerizeRasterPoster } from './layerize-poster';
import { inferLayerizeStack } from './layerize-reconstruction';

export interface LayerizeOwner { userId: string; projectId: string; origin: string; attribution?: BillingAttribution }
export interface LayerizeJob {
  id: string; projectId: string; status: 'preparing' | 'processing' | 'uncertain' | 'failed' | 'completed';
  input: LayerizeInput; fingerprint: string; sourceSha256: string; createdAt: string; updatedAt: string;
  taskId?: string; error?: string; markup: number; attribution: BillingAttribution;
  snapshotId?: string; designPath?: string; posterUrl?: string; manifestPath?: string; credits?: number;
  providerImageUrl?: string;
}
export interface LayerizeResult { jobId: string; projectId: string; status: LayerizeJob['status']; projectUrl: string; taskId?: string; snapshotId?: string; designPath?: string; posterUrl?: string; credits?: number; message?: string; design?: DesignPayload; newlyPublished?: boolean }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function assertId(id: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid project/job ID'); }
const pathFor = (projectId: string, id: string) => `${projectId}/layerize/${id}/job.json`;
function receiptSignature(owner: LayerizeOwner, job: LayerizeJob) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Task receipt signing is not configured.');
  // Workspace is user-editable: never trust a modified task, markup or attribution.
  return createHmac('sha256', key).update(`layerize-v1:${owner.userId}:${owner.projectId}:`).update(JSON.stringify(job)).digest('hex');
}
async function ownerCheck(owner: LayerizeOwner) {
  assertId(owner.projectId);
  const { data, error } = await getSupabaseAdmin().from('projects').select('user_id').eq('id', owner.projectId).maybeSingle();
  if (error || data?.user_id !== owner.userId) throw new Error('Layerize project is not accessible.');
}
async function readFresh(owner: LayerizeOwner, path: string): Promise<unknown | null> {
  const admin = getSupabaseAdmin();
  const index = await admin.from('workspace_files').select('storage_url,updated_at').eq('user_id', owner.userId).eq('path', path).maybeSingle();
  if (index.error) throw new Error('Task receipt lookup pending; do not resubmit.');
  if (!index.data?.storage_url) return null;
  // Receipts are mutable state, unlike media: bypass the workspace size-only mirror/cache.
  // Derive the server-owned URL instead of fetching a user-editable index URL.
  const url = new URL(admin.storage.from('images').getPublicUrl(`${owner.userId}/workspace/${path}`).data.publicUrl);
  // GUI props saves can update Storage without changing the workspace index.
  url.searchParams.set('receipt_version', `${index.data.updated_at}:${randomUUID()}`);
  const file = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!file.ok) throw new Error('Task receipt read pending; do not resubmit.');
  return file.json();
}
async function load(owner: LayerizeOwner, id: string): Promise<LayerizeJob | null> {
  assertId(id);
  const stored = await readFresh(owner, pathFor(owner.projectId, id));
  if (!stored) return null;
  const { receiptSignature: signature, ...job } = stored as LayerizeJob & { receiptSignature: string };
  const expected = receiptSignature(owner, job);
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('Task receipt integrity check failed. Retain the original job; do not submit again.');
  if (job.id !== id || job.projectId !== owner.projectId) throw new Error('Task receipt identity mismatch');
  return job;
}
async function save(owner: LayerizeOwner, job: LayerizeJob) {
  if (job.taskId && job.status !== 'completed') {
    const current = await load(owner, job.id);
    if (current?.status === 'completed') {
      Object.assign(job, current); delete job.error; return;
    }
  }
  job.updatedAt = new Date().toISOString();
  const stored = await workspace.writeFile(pathFor(owner.projectId, job.id), JSON.stringify({ ...job, receiptSignature: receiptSignature(owner, job) }), getSupabaseAdmin(), owner.userId, 'application/json');
  if (!stored.success) throw new Error(`Task receipt persistence pending. Retain job ${job.id}; do not submit again.`);
}
function response(owner: LayerizeOwner, job: Pick<LayerizeJob, 'id' | 'status'> & Partial<LayerizeJob>): LayerizeResult {
  return { jobId: job.id, projectId: owner.projectId, status: job.status,
    projectUrl: `${owner.origin.replace(/\/$/, '')}/projects/${owner.projectId}${job.snapshotId ? `?snapshot=${job.snapshotId}` : ''}`,
    taskId: job.taskId, snapshotId: job.snapshotId, designPath: job.designPath, posterUrl: job.posterUrl,
    credits: job.credits, message: job.error };
}

/** One unique workspace index row claims a submission before its single paid POST. */
export async function startLayerize(owner: LayerizeOwner, id: string, input: LayerizeInput): Promise<LayerizeResult> {
  await ownerCheck(owner); assertId(id);
  const request = layerizeRequest(input);
  // Fingerprint the user's scope, not the versioned provider instructions. Old
  // request IDs must remain recoverable after the appearance contract improves.
  const normalized: LayerizeInput = { imageUrl: input.imageUrl, prompt: input.prompt?.trim() ?? '', maxOutputs: request.n, quality: request.quality as LayerizeInput['quality'], editableText: input.editableText === true };
  const fingerprint = sha(JSON.stringify(normalized));
  const previous = await load(owner, id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('Layerize request ID already belongs to different parameters.');
    return response(owner, previous);
  }
  const settled = await getSupabaseAdmin().from('mcp_video_reservations').select('id').eq('id', id).maybeSingle();
  if (settled.error || settled.data) throw new Error('This task ID needs receipt reconciliation. No new provider submission was made.');
  const rate = await getTokenRate(LAYERIZE_MODEL);
  if (!rate || rate.model_id !== LAYERIZE_MODEL || !Number.isFinite(rate.markup) || rate.markup <= 0) throw new Error('Layerize pricing is not configured. No provider task was submitted.');
  if (!process.env.EVOLINK_API_KEY?.trim()) throw new Error('EvoLink is not configured. No provider task was submitted.');
  if (await isBillingEnabled()) {
    const maxCredits = providerCostToCredits(0.0064 + request.n * 0.028, rate.markup);
    const check = await requireCredits(owner.userId, maxCredits);
    if (!check.ok) throw new Error(`Insufficient credits for the maximum ${request.n} outputs: need ${maxCredits}, have ${check.balance}.`);
  }
  const source = await readProviderImage(input.imageUrl, 30 * 1024 * 1024);
  const prepared = await prepareLayerizeSource(source);
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin().from('workspace_files').insert({ user_id: owner.userId, path: pathFor(owner.projectId, id), content_type: 'application/json', size_bytes: 0, storage_url: '', updated_at: now });
  if (error?.code === '23505') return response(owner, { id, status: 'preparing' });
  if (error) throw new Error('Could not claim the Layerize request; nothing was submitted.');
  const job: LayerizeJob = { id, projectId: owner.projectId, status: 'preparing', input: normalized,
    fingerprint, sourceSha256: sha(source), createdAt: now, updatedAt: now, markup: rate.markup,
    attribution: { ...resolveBillingAttribution(), ...owner.attribution, projectId: owner.projectId } };
  await save(owner, job);
  let task: LayerizeProviderTask;
  try {
    if (prepared.normalized) {
      job.providerImageUrl = await permanent(owner, `${owner.projectId}/layerize/${id}/source-normalized.${prepared.extension}`, prepared.bytes, prepared.contentType);
      await save(owner, job);
    }
    task = await submitLayerize({ ...normalized, imageUrl: job.providerImageUrl || normalized.imageUrl });
  } catch (error) {
    job.status = error instanceof LayerizeProviderError && error.uncertain ? 'uncertain' : 'failed';
    job.error = error instanceof Error ? error.message : 'Submission did not complete. Do not submit again.';
    await save(owner, job);
    return response(owner, job);
  }
  job.taskId = task.id; job.status = 'processing';
  await save(owner, job);
  return response(owner, job);
}

async function claimPublication(owner: LayerizeOwner, id: string): Promise<string | null> {
  const admin = getSupabaseAdmin(), path = `${owner.projectId}/layerize/${id}/publish.lock`;
  const now = new Date().toISOString();
  const inserted = await admin.from('workspace_files').insert({ user_id: owner.userId, path, content_type: 'application/octet-stream', size_bytes: 0, storage_url: '', updated_at: now });
  if (!inserted.error) return now;
  if (inserted.error.code !== '23505') throw new Error('Could not claim design publication');
  const { data: previous } = await admin.from('workspace_files').select('updated_at').eq('user_id', owner.userId).eq('path', path).maybeSingle();
  if (!previous || Date.now() - Date.parse(previous.updated_at) < 600_000) return null;
  const renewed = await admin.from('workspace_files').update({ updated_at: now }).eq('user_id', owner.userId).eq('path', path).eq('updated_at', previous.updated_at).select('path');
  return !renewed.error && renewed.data?.length === 1 ? now : null;
}
function bounds(value: unknown, width: number, height: number): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || value.some(n => !Number.isInteger(n)) || value[0] < 0 || value[1] < 0 || value[2] > width || value[3] > height || value[0] >= value[2] || value[1] >= value[3]) throw new Error('Provider layer bounds are invalid. Retain this task.');
  return value as [number, number, number, number];
}
async function permanent(owner: LayerizeOwner, path: string, data: string | Buffer, contentType: string) {
  const file = await workspace.writeFile(path, data, getSupabaseAdmin(), owner.userId, contentType);
  if (!file.success || !file.storageUrl) throw new Error('Layer asset persistence pending; recover this task rather than generating again.');
  return file.storageUrl;
}
async function mapLayers<T, R>(items: T[], operation: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) return; output[index] = await operation(items[index]); }
  }));
  return output;
}
async function makeDesign(owner: LayerizeOwner, job: LayerizeJob, task: LayerizeProviderTask) {
  const deliveryStarted = Date.now();
  const rows = [...(task.result_data ?? [])].sort((a, b) => a.z_index - b.z_index);
  if (rows.length < 2 || rows.length > job.input.maxOutputs! || rows[0].z_index !== 0 || new Set(rows.map(r => r.z_index)).size !== rows.length || rows.some(r => !Number.isInteger(r.z_index) || r.z_index < 0)) throw new Error('Provider output inventory does not satisfy the layer contract.');
  const [decoded, source] = await Promise.all([mapLayers(rows, async row => {
    const bytes = await readProviderImage(row.url, 50 * 1024 * 1024, { evolinkAsset: true });
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: 4_624_220 });
    const meta = await image.metadata();
    if (meta.format !== 'png' || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw new Error('Layer output is not a valid PNG.');
    if (row.z_index > 0 && (!meta.hasAlpha || (await image.stats()).channels.at(-1)!.min === 255)) throw new Error('Foreground layer did not contain native alpha.');
    const url = await permanent(owner, `${owner.projectId}/layerize/${job.id}/layer-${row.z_index}.png`, bytes, 'image/png');
    return { row, bytes, url, width: meta.width, height: meta.height };
  }), readProviderImage(job.input.imageUrl, 30 * 1024 * 1024)]);
  const width = decoded[0].width, height = decoded[0].height;
  const layers: LayerizeLayer[] = await mapLayers(decoded, async item => {
    const { row } = item;
    const url = item.url;
    const box = row.z_index === 0 ? [0, 0, width, height] as [number, number, number, number] : bounds(row.bounding_box?.absolute, width, height);
    const layer: LayerizeLayer = { z: row.z_index, url, width: item.width, height: item.height, bounds: box, name: String(row.name || row.description || `Layer ${row.z_index}`).slice(0, 120) };
    if (row.text_recognition?.lines?.length) {
      try {
        layer.text = { lines: row.text_recognition.lines.map(line => {
          const style = line.runs?.[0]?.style ?? {};
          return { text: (line.runs ?? []).map(run => run.text ?? '').join(''), bounds: bounds(line.bounding_box?.absolute, width, height),
            font: /^[\w -]{1,80}$/.test(String(style.similar_font_family)) ? String(style.similar_font_family) : 'Arial',
            color: /^#[a-f\d]{6}$/i.test(String(style.foreground_color)) ? String(style.foreground_color) : '#000000', bold: style.bold === true, italic: style.italic === true };
        }) };
      } catch { /* Preserve the original PNG when OCR geometry is incomplete. */ }
    }
    return layer;
  });
  if (job.input.editableText) {
    const { prepareLayerizeTextLayers } = await import('./layerize-text');
    await prepareLayerizeTextLayers(layers, new Map(decoded.map(item => [item.row.z_index, item.bytes])),
      (name, pixels) => permanent(owner, `${owner.projectId}/layerize/${job.id}/${name}`, pixels, 'image/png'), { matchFonts: false });
  }
  const supplierCostUsd = layerizeSupplierCost(layers);
  if (sha(source) !== job.sourceSha256) throw new Error('Source image changed; retain this task for reconciliation.');
  const { order: stackOrder, ...reconstruction } = await inferLayerizeStack(source, width, height,
    layers.map((layer, index) => ({ ...layer, bytes: decoded[index].bytes })));
  const manifest: LayerizeManifest = { version: 1, taskId: task.id, width, height, sourceSha256: job.sourceSha256, supplierCostUsd, layers, stackOrder, reconstruction };
  const manifestPath = `${owner.projectId}/layerize/${job.id}/manifest.json`;
  const fontsUrl = new URL(getSupabaseAdmin().storage.from('images').getPublicUrl(`${owner.userId}/workspace/${owner.projectId}/layerize/${job.id}/text-fonts.json`).data.publicUrl);
  const fontMatching = job.input.editableText && layers.some(layer => !layer.text?.preserveRaster && layer.text?.lines.some(line => line.appearance))
    ? { version: 1 as const, projectId: owner.projectId, snapshotId: job.id, storageOrigin: fontsUrl.origin, storagePath: fontsUrl.pathname } : undefined;
  const design = buildLayerizeDesign(manifest, job.input.editableText, fontMatching);
  const invalid = validateDesign(design); if (invalid) throw new Error(`Design validation failed: ${invalid}`);
  const posterStarted = Date.now();
  let poster: Buffer;
  const usesOriginalTextPixels = layers.every(layer => !layer.text?.lines.length || layer.text.preserveRaster || layer.text.lines.every(line => line.appearance));
  const usesRasterPoster = design.editables?.every(field => field.type === 'image') || usesOriginalTextPixels;
  if (usesRasterPoster) {
    // Raster Layerize results already contain everything needed for the exact
    // initial composition, including original glyph pixels for editable text.
    poster = await renderLayerizeRasterPoster(manifest, new Map(decoded.map(item => [item.row.z_index, item.bytes])));
  } else {
    const { renderDesignFrame } = await import('./remotion-server');
    const signal = AbortSignal.timeout(120_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      poster = await Promise.race([
        renderDesignFrame(design, 0, { signal, sandboxScope: `${owner.userId}:${owner.projectId}` }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Design preview timed out; recover this same task.')), 120_000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  console.info('[layerize-delivery]', JSON.stringify({ jobId: job.id, stage: 'poster', renderer: usesRasterPoster ? 'raster' : 'remotion', elapsedMs: Date.now() - posterStarted, layers: layers.length }));
  const [posterUrl] = await Promise.all([
    permanent(owner, `${owner.projectId}/layerize/${job.id}/poster.jpg`, poster, 'image/jpeg'),
    permanent(owner, manifestPath, JSON.stringify(manifest), 'application/json'),
  ]);
  const credits = await chargeCompletedProviderTask({ id: job.id, userId: owner.userId, model: LAYERIZE_MODEL, tool: 'decompose_image',
    fingerprint: job.fingerprint, taskId: task.id, supplierCostUsd, credits: providerCostToCredits(supplierCostUsd, job.markup), attribution: job.attribution });
  const published = await publishDesignSnapshot({ supabase: getSupabaseAdmin(), userId: owner.userId, projectId: owner.projectId,
    snapshotId: job.id, design: { ...design, layerizeManifestPath: manifestPath }, description: 'Layerized image', posterUrl, preserveExisting: true });
  job.status = 'completed'; job.snapshotId = published.snapshotId; job.designPath = published.designPath;
  job.posterUrl = published.posterUrl; job.manifestPath = manifestPath; job.credits = credits; job.error = undefined;
  await save(owner, job);
  console.info('[layerize-delivery]', JSON.stringify({ jobId: job.id, stage: 'published', elapsedMs: Date.now() - deliveryStarted, layers: layers.length }));
  return { ...response(owner, job), design, newlyPublished: true };
}

export async function getLayerize(owner: LayerizeOwner, id: string): Promise<LayerizeResult> {
  await ownerCheck(owner);
  const job = await load(owner, id);
  if (!job) throw new Error('Layerize job not found. Use the original project and job ID.');
  if (job.status === 'completed' && job.designPath) {
    const design = await readFresh(owner, job.designPath);
    return { ...response(owner, job), ...(design ? { design: design as DesignPayload } : {}) };
  }
  if (!job.taskId || job.status === 'failed' || job.status === 'uncertain') return response(owner, job);
  try {
    const task = await queryLayerize(job.taskId);
    if (task.status === 'failed' || task.status === 'cancelled') {
      job.status = 'failed'; job.error = `Provider task ${task.status}: ${String(task.error?.code ?? '')}. No product image charge.`;
      await save(owner, job); return response(owner, job);
    }
    if (task.status !== 'completed') return response(owner, job);
    // A previous publisher may have finished immediately before its receipt write failed.
    const existing = await getSupabaseAdmin().from('snapshots').select('design_path,image_url').eq('id', job.id).eq('project_id', owner.projectId).maybeSingle();
    if (existing.data?.design_path) {
      const ledger = await getSupabaseAdmin().from('mcp_video_reservations').select('credits,status,fingerprint,model_id,user_id').eq('id', id).maybeSingle();
      if (await isBillingEnabled() && (ledger.error || ledger.data?.user_id !== owner.userId || ledger.data?.fingerprint !== job.fingerprint || ledger.data?.model_id !== LAYERIZE_MODEL || ledger.data?.status !== 'completed')) throw new Error('Existing snapshot has no matching settled task. Publication requires reconciliation.');
      job.status = 'completed'; job.snapshotId = job.id; job.designPath = existing.data.design_path; job.posterUrl = existing.data.image_url;
      job.credits = ledger.data?.credits ?? 0;
      await save(owner, job); return getLayerize(owner, id);
    }
    const lease = await claimPublication(owner, id);
    if (!lease) return response(owner, job);
    try { return await makeDesign(owner, job, task); }
    finally {
      await getSupabaseAdmin().from('workspace_files').delete().eq('user_id', owner.userId)
        .eq('path', `${owner.projectId}/layerize/${id}/publish.lock`).eq('updated_at', lease);
    }
  } catch (error) {
    // A completed provider result is recoverable; never generate again or charge twice.
    job.error = `${error instanceof Error ? error.message : 'Task query or delivery pending.'} Retain job ${id}; query this same job only.`;
    await save(owner, job); return response(owner, job);
  }
}

export async function waitLayerize(owner: LayerizeOwner, id: string, maxMs = 240_000): Promise<LayerizeResult> {
  const deadline = Date.now() + maxMs;
  let result = await getLayerize(owner, id);
  while (['preparing', 'processing'].includes(result.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2500)); result = await getLayerize(owner, id);
  }
  return result;
}
