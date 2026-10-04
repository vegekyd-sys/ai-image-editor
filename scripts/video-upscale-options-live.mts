/** Same-source upscaler benchmark; never submits Seedance. Receipts prevent paid retries. */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fal } from '@fal-ai/client';

const root = resolve('test-results/seedance25-mascot-ab');
const dir = join(root, 'upscale-options');
await mkdir(dir, { recursive: true });
const save = async (name: string, value: unknown) => writeFile(join(dir, name), JSON.stringify(value, null, 2));
const exists = async (name: string) => access(join(dir, name)).then(() => true, () => false);
const sourcePath = join(root, 'mascot-480p.mp4');
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
const sourceMeta = probe(sourcePath);
const video = sourceMeta.streams.find((s: any) => s.codec_type === 'video');
const fps = Number(video.r_frame_rate.split('/')[0]) / Number(video.r_frame_rate.split('/')[1]);
const seconds = Number(sourceMeta.format.duration);
const sourceBytes = await readFile(sourcePath);
const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (video.width !== 854 || video.height !== 480 || fps !== 24 || seconds > 10.2) throw new Error('Expected saved 10s mascot 480p source');

const filters = 'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1';
for (const [name, filter] of [['lanczos', filters], ['lanczos-sharp', `${filters},unsharp=5:5:0.35:5:5:0.0`]]) {
  if (await exists(`${name}.mp4`)) continue;
  const start = Date.now();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', sourcePath, '-vf', filter, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', join(dir, `${name}.mp4`)]);
  await save(`${name}.metrics.json`, { status: 'completed', readySeconds: (Date.now() - start) / 1000, providerSeconds: 0, costUsdEstimate: 0, aiSuperResolution: false, sha256, media: probe(join(dir, `${name}.mp4`)) });
  console.log(`[upscale-options] ${name} ready (local, no AI fee)`);
}

if (!process.env.FAL_KEY) throw new Error('FAL_KEY not configured');
let videoUrl: string;
if (await exists('source.private.json')) {
  const saved = JSON.parse(await readFile(join(dir, 'source.private.json'), 'utf8'));
  if (saved.sha256 !== sha256) throw new Error('Existing experiments belong to another input');
  videoUrl = saved.videoUrl;
} else {
  videoUrl = await fal.storage.upload(new File([sourceBytes], 'makaron-mascot-480p.mp4', { type: 'video/mp4' }));
  await save('source.private.json', { sha256, videoUrl, uploadedAt: new Date().toISOString() });
}

const models = [
  { id: 'topaz-proteus', endpoint: 'topaz/upscale/video/precision', budgetUsd: 0.66, input: { video_url: videoUrl, model: 'Proteus', upscale_factor: 2.25, target_fps: 24, H264_output: true } },
  { id: 'topaz-gaia-cg', endpoint: 'topaz/upscale/video/precision', budgetUsd: 0.66, input: { video_url: videoUrl, model: 'Gaia CG', upscale_factor: 2.25, target_fps: 24, H264_output: true } },
  { id: 'bytedance-fast', endpoint: 'fal-ai/bytedance-upscaler/upscale/video', budgetUsd: 0.08, input: { video_url: videoUrl, target_resolution: '1080p', target_fps: 24, enhancement_preset: 'aigc', enhancement_tier: 'fast', fidelity: 'high', bit_depth: 8 } },
];
if (models.reduce((sum, m) => sum + m.budgetUsd, 0) > 1.5) throw new Error('Benchmark cost estimate exceeds scope');
await save('experiment.json', { sha256, sourcePath, sourceMeta, newSeedanceGenerations: 0, estimatedUpperBudgetUsd: 1.4, models: models.map(m => ({ ...m, input: { ...m.input, video_url: '[private source URL]' } })) });

async function run(model: typeof models[number]) {
  const { id, endpoint, input } = model;
  const receiptName = `${id}.receipt.private.json`;
  let receipt: any;
  if (await exists(receiptName)) {
    receipt = JSON.parse(await readFile(join(dir, receiptName), 'utf8'));
    if (!receipt.requestId) throw new Error(`${id}: uncertain submission, do not repeat`);
    if (receipt.sha256 !== sha256) throw new Error('Input mismatch');
  } else {
    if (await exists(`${id}.submit.private.json`)) throw new Error(`${id}: uncertain submission, do not repeat`);
    const startedAt = new Date().toISOString();
    await writeFile(join(dir, `${id}.submit.private.json`), JSON.stringify({ startedAt, sha256, endpoint, input }, null, 2), { flag: 'wx' });
    const result = await fal.queue.submit(endpoint, { input });
    receipt = { startedAt, acceptedAt: new Date().toISOString(), requestId: result.request_id, endpoint, input, sha256 };
    await save(receiptName, receipt);
    console.log(`[upscale-options] ${id} accepted ${receipt.requestId}`);
  }
  if (await exists(`${id}.metrics.json`)) {
    const saved = JSON.parse(await readFile(join(dir, `${id}.metrics.json`), 'utf8'));
    if (['completed', 'failed', 'cancelled'].includes(saved.status)) return;
  }
  let firstProgressAt: string | undefined;
  const deadline = Date.now() + 12 * 60_000;
  try {
    let status: any;
    while (Date.now() < deadline) {
      try { status = await fal.queue.status(endpoint, { requestId: receipt.requestId, logs: true }); }
      catch (error: any) {
        if ([422, 499].includes(error.status)) throw error;
        console.log(`[upscale-options] ${id} status unavailable; retain receipt`);
        await new Promise(done => setTimeout(done, 10_000)); continue;
      }
      if (status.status === 'IN_PROGRESS' && !firstProgressAt) firstProgressAt = new Date().toISOString();
      await save(`${id}.status.private.json`, { observedAt: new Date().toISOString(), ...status });
      console.log(`[upscale-options] ${id} ${status.status}${status.queue_position == null ? '' : ` position=${status.queue_position}`}`);
      if (status.status === 'COMPLETED') break;
      if (!firstProgressAt && Date.now() - Date.parse(receipt.acceptedAt) > 180_000) {
        await fal.queue.cancel(endpoint, { requestId: receipt.requestId });
        await save(`${id}.cancel.private.json`, { requestedAt: new Date().toISOString(), requestId: receipt.requestId });
        // A confirmed 499 from the result endpoint is cancellation; an unknown query is not.
        try { await fal.queue.result(endpoint, { requestId: receipt.requestId }); }
        catch (error: any) { if (error.status === 499) { await save(`${id}.metrics.json`, { status: 'cancelled', queuedSeconds: (Date.now() - Date.parse(receipt.acceptedAt)) / 1000, cancellationConfirmed: true, requestId: receipt.requestId }); console.log(`[upscale-options] ${id} cancellation confirmed`); return; } throw error; }
      }
      await new Promise(done => setTimeout(done, 10_000));
    }
    if (status?.status !== 'COMPLETED') throw new Error('Polling deadline reached; resume saved receipt');
    const result = await fal.queue.result(endpoint, { requestId: receipt.requestId });
    const completedAt = new Date().toISOString();
    await save(`${id}.result.private.json`, { ...receipt, completedAt, data: result.data });
    const data = result.data as { video?: { url?: string }; duration?: number };
    if (!data.video?.url) throw new Error('Missing result video');
    const response = await fetch(data.video.url);
    if (!response.ok) throw new Error(`Download HTTP ${response.status}`);
    const rawPath = join(dir, `${id}-raw.mp4`);
    await writeFile(rawPath, new Uint8Array(await response.arrayBuffer()));
    const rawMeta = probe(rawPath);
    const rawVideo = rawMeta.streams.find((s: any) => s.codec_type === 'video');
    if (rawVideo.height < 1080) throw new Error('Result shorter than 1080p');
    const normalize = `${filters},fps=24`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', rawPath, '-i', sourcePath, '-map', '0:v:0', '-map', '1:a:0', '-vf', normalize, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', join(dir, `${id}.mp4`)]);
    const readyAt = new Date().toISOString();
    const costUsdEstimate = id === 'bytedance-fast' ? seconds * .0072 : seconds / 10 * .20;
    await save(`${id}.metrics.json`, { status: 'completed', requestId: receipt.requestId, endpoint, sha256, startedAt: receipt.startedAt, acceptedAt: receipt.acceptedAt, firstProgressAt, completedAt, readyAt, providerSeconds: (Date.parse(completedAt) - Date.parse(receipt.startedAt)) / 1000, readySeconds: (Date.parse(readyAt) - Date.parse(receipt.startedAt)) / 1000, observedQueueSeconds: firstProgressAt ? (Date.parse(firstProgressAt) - Date.parse(receipt.acceptedAt)) / 1000 : undefined, costUsdEstimate, costIsLedger: false, billingWarning: id.startsWith('topaz') ? '1080p/30fps public-rate estimate; output rounding and credit rounding need ledger verification' : '1080p/30fps public-rate estimate; 24fps price requires ledger verification', raw: rawMeta, final: probe(join(dir, `${id}.mp4`)) });
    console.log(`[upscale-options] ${id} ready`);
  } catch (error: any) {
    await save(`${id}.failure.private.json`, { requestId: receipt.requestId, recordedAt: new Date().toISOString(), httpStatus: error.status, message: error.message, body: error.body });
    await save(`${id}.metrics.json`, { status: [422, 499].includes(error.status) ? error.status === 499 ? 'cancelled' : 'failed' : 'uncertain', requestId: receipt.requestId, httpStatus: error.status });
    console.log(`[upscale-options] ${id} stopped; HTTP ${error.status ?? 'unknown'}, inspect private receipt`);
  }
}
await Promise.all(models.map(run));
