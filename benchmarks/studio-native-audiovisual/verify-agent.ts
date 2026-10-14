/** Verify persisted real Agent receipts AND final media, without new paid calls.
 * Usage: node --import tsx .../verify-agent.ts <private-dir>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

type Tool = { tool_name: string; input: Record<string, unknown> };
const root = path.resolve(process.argv[2]);
const json = (name: string) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const native: Tool[] = json('agent-tools.json');
const captions: Tool[] = json('caption-agent-tools.json');
const count = (items: Tool[], name: string) => items.filter(t => t.tool_name === name).length;
for (const items of [native, captions]) {
  assert.equal(items.filter(t => t.tool_name.startsWith('studio_run')).length, 0);
  assert.equal(count(items, 'generate_audio'), 0);
}
assert.equal(count(native, 'generate_animation'), 1);
const generation = native.find(t => t.tool_name === 'generate_animation')!.input;
assert.equal(generation.model, 'seedance-2.5-eco');
assert.equal(generation.generate_audio, true);
assert.equal(generation.duration, 25);
assert.equal(count(captions, 'generate_animation'), 0);
for (const name of ['run_code', 'publish_draft', 'materialize_media']) assert.equal(count(captions, name), 1);
assert.ok(count(captions, 'preview_frame') >= 1);
for (const name of ['agent-status.json', 'caption-agent-status.json']) {
  const status = json(name);
  assert.equal(status.status, 'completed');
  assert.equal(status.incomplete, false);
  assert.equal(status.progress.delivery_status, 'ready');
}
const job = json('caption-export-job.json');
assert.equal(job.status, 'completed');
assert.equal(job.error, null);
const media = ['agent-native-final.mp4', 'caption-agent-final.mp4'].map(name => {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(root, name)], { encoding: 'utf8' }));
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  assert.equal(video.width, 720); assert.equal(video.height, 1280);
  assert.ok(probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(video.duration) - 25) < 0.2);
  return { name, width: video.width, height: video.height, duration: Number(video.duration), hasAudio: true };
});
// Hosted export re-encodes AAC. Verify waveform content, not binary equality.
const pcm = (name: string) => {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, name), '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 8 * 1024 * 1024 });
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};
const source = pcm('eco-tt04s-crop-post.mp4'), exported = pcm('caption-agent-final.mp4');
function correlation(shift: number, stride = 1, length = source.length) {
  let xy = 0, xx = 0, yy = 0;
  for (let i = Math.max(0, -shift); i < Math.min(length, exported.length - shift); i += stride) {
    xy += source[i] * exported[i + shift]; xx += source[i] ** 2; yy += exported[i + shift] ** 2;
  }
  return xy / Math.sqrt(xx * yy);
}
// AAC adds encoder padding; align within 200ms before comparing waveforms.
let coarseShift = 0, coarseCorrelation = -Infinity;
for (let shift = -3200; shift <= 3200; shift += 8) {
  const value = correlation(shift, 8, 64000);
  if (value > coarseCorrelation) { coarseCorrelation = value; coarseShift = shift; }
}
let audioCorrelation = -Infinity, audioOffsetSamples = 0;
for (let shift = coarseShift - 8; shift <= coarseShift + 8; shift++) {
  const value = correlation(shift);
  if (value > audioCorrelation) { audioCorrelation = value; audioOffsetSamples = shift; }
}
assert.ok(audioCorrelation > 0.98, 'Export must preserve the native soundtrack content.');
assert.ok(Math.abs(audioOffsetSamples / 16000) < 0.08, 'Export must keep speech aligned with the source.');
const acceptance = { native: { model: generation.model, generations: 1, studioRuns: 0, separateAudio: 0 }, captions: { compositions: 1, studioRuns: 0, generations: 0, exportCompleted: true }, audioCorrelation, audioOffsetMs: audioOffsetSamples / 16, media };
fs.writeFileSync(path.join(root, 'agent-acceptance.json'), JSON.stringify(acceptance, null, 2));
console.log(JSON.stringify(acceptance));
