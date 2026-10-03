/** Experimental post-generation upscale. No app billing/timeline mutation.
 * Usage: DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx
 *   scripts/seedance25-upscale-live.mts <seedance25-live.result.json> [bytedance|flashvsr]
 * Saves the queue ID before polling; reruns resume the same job.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fal } from '@fal-ai/client';

const engine = process.argv[3] || 'bytedance';
if (engine !== 'bytedance' && engine !== 'flashvsr') throw new Error('Engine must be bytedance or flashvsr.');
// Use the current documented API schema; bundled SDK enums still describe an older FPS contract.
const endpoint: string = engine === 'bytedance' ? 'fal-ai/bytedance-upscaler/upscale/video' : 'fal-ai/flashvsr/upscale/video';
const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: seedance25-upscale-live.mts <seedance25-live.result.json>');
if (!process.env.FAL_KEY) throw new Error('FAL_KEY not configured');
const source = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
if (source.result?.status !== 'completed' || !source.result?.videoUrl) throw new Error('Source generation must be completed.');
const outputDir = dirname(resolve(reportPath));
const sourcePath = resolve(outputDir, `${source.config.name}.mp4`);
const probe = (path: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }));
const sourceMeta = probe(sourcePath);
const video = sourceMeta.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
const jobPath = resolve(outputDir, `${engine}-upscale.task.json`);
let job: { requestId: string; input: Record<string, unknown>; startedAt: string };
const hasJob = await access(jobPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
if (hasJob) {
  job = JSON.parse(await readFile(jobPath, 'utf8'));
  if (job.input.video_url !== source.result.videoUrl) throw new Error('Saved queue job belongs to another source; use a separate output directory.');
} else {
  const input = engine === 'bytedance'
    ? { video_url: source.result.videoUrl, target_resolution: '1080p', target_fps: 30, enhancement_preset: 'aigc', enhancement_tier: 'standard', fidelity: 'high', bit_depth: 8 }
    : { video_url: source.result.videoUrl, upscale_factor: 1080 / Math.min(video.width, video.height), acceleration: 'regular', color_fix: true, quality: 80, preserve_audio: true, output_format: 'X264 (.mp4)', output_quality: 'maximum' };
  const { request_id } = await fal.queue.submit(endpoint, { input });
  job = { requestId: request_id, input, startedAt: new Date().toISOString() };
  await writeFile(jobPath, JSON.stringify(job, null, 2));
}
console.log(JSON.stringify({ endpoint, requestId: job.requestId }));
try {
const deadline = Date.now() + 20 * 60_000;
let status = await fal.queue.status(endpoint, { requestId: job.requestId });
while (status.status !== 'COMPLETED' && Date.now() < deadline) {
  console.log(`[upscale-live] ${status.status}`);
  await new Promise(done => setTimeout(done, 10_000));
  status = await fal.queue.status(endpoint, { requestId: job.requestId });
}
if (status.status !== 'COMPLETED') throw new Error('Upscale polling timed out; rerun to resume the same job.');
const result = await fal.queue.result(endpoint, { requestId: job.requestId });
const data = result.data as { video?: { url?: string }; duration?: number };
if (!data.video?.url) throw new Error('Upscaler completed without a video URL.');
await writeFile(resolve(outputDir, `${engine}-upscale.result.json`), JSON.stringify({ ...job, completedAt: new Date().toISOString(), data }, null, 2));
const response = await fetch(data.video.url);
if (!response.ok) throw new Error(`Upscaled video download failed: ${response.status}`);
const rawPath = resolve(outputDir, `${engine}-1080p-raw.mp4`);
await writeFile(rawPath, new Uint8Array(await response.arrayBuffer()));
// Preserve the Seedance soundtrack explicitly, even if the provider drops it.
const final1080 = resolve(outputDir, `seedance25-${engine}-1080p.mp4`);
const rawVideo = probe(rawPath).streams.find((s: { codec_type: string }) => s.codec_type === 'video');
if (Math.min(rawVideo.width, rawVideo.height) < 1080) throw new Error('Upscale result did not reach 1080p.');
const deliveryScale = (shortEdge: number) => {
  const aspect = source.config.aspectRatio;
  if (aspect === '16:9' || aspect === '9:16') {
    const longEdge = shortEdge * 16 / 9;
    const width = aspect === '16:9' ? longEdge : shortEdge;
    const height = aspect === '16:9' ? shortEdge : longEdge;
    return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1`;
  }
  return video.width >= video.height ? `scale=-2:${shortEdge}:flags=lanczos` : `scale=${shortEdge}:-2:flags=lanczos`;
};
const scale1080 = deliveryScale(1080);
const videoArgs = Math.min(rawVideo.width, rawVideo.height) === 1080 && !['16:9', '9:16'].includes(source.config.aspectRatio) ? ['-c:v', 'copy'] : ['-vf', scale1080, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium'];
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', rawPath, '-i', sourcePath, '-map', '0:v:0', '-map', '1:a:0?', ...videoArgs, '-c:a', 'copy', '-movflags', '+faststart', final1080]);
const final720 = resolve(outputDir, `seedance25-${engine}-720p.mp4`);
// fal's preset minimum is 1080p; derive an exact 720p delivery locally.
const scale = deliveryScale(720);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', final1080, '-vf', scale, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', final720]);
const metadata = { source: sourceMeta, provider: probe(rawPath), final1080: probe(final1080), final720: probe(final720) };
await writeFile(resolve(outputDir, `${engine}-media-metadata.json`), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ requestId: job.requestId, final1080, final720 }));

} catch (error) {
  const failure = error as { status?: number; body?: unknown; message?: string };
  await writeFile(resolve(outputDir, `${engine}-upscale.failed.json`), JSON.stringify({
    requestId: job.requestId, failedAt: new Date().toISOString(), status: failure.status,
    body: failure.body, error: failure.message || String(error),
  }, null, 2));
  throw error;
}
