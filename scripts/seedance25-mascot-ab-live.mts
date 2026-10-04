/** Two paid 10s generations only. Reruns resume receipts; uncertain submissions never resubmit. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fal } from '@fal-ai/client';
import { validateSeedanceImageReferences } from '../src/lib/provider-image-reference';

const dir = resolve('test-results/seedance25-mascot-ab');
await mkdir(dir, { recursive: true });
const save = async (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2));
const exists = async (path: string) => access(path).then(() => true, () => false);
const key = process.env.EVOLINK_API_KEY;
if (!key || !process.env.FAL_KEY) throw new Error('Provider credentials missing');
const prompt = `Create a spectacular, playful 10-second Makaron brand film, cinematic 16:9, premium stylized 3D animation, one flowing camera journey with clear readable action.
Use @image1 as the Makaron Spark + Pixel Wizard character identity reference only, not as a storyboard: do not reproduce its contact-sheet layout, panel numbers or captions. Use @image2 and @image3 only for Makaron product identity, deep-purple interface, logo and visual palette; do not include the photographed humans, browser chrome or account information from those references.
Spark is Makaron's creative source and editing signature: living magenta/cyan energy that emerges from the product UI and shows transformation. Pixel Wizard is the small purple bubble-ghost mascot and the mischievous, slightly scared guide/personification of Spark. Preserve his translucent squishy purple body, square pixel eyes and mouth, pixel blush, floppy dark-purple pixel-edged wizard hat and neon magenta/cyan edge light. Exactly one mascot, about 20 percent of the frame, actively interacting with Spark using his whole body. No magic wand.
0-2s: In a dark-purple creative studio, a large elegant glass Makaron editor floats above a glossy desk. Its preview contains a charming miniature candy-colored city, initially soft and low-detail. Pixel Wizard sneaks out from behind the preview frame, smugly reaches for a tiny Spark pulse from the creation button, then gets adorably startled when it springs to life; his floppy hat briefly lifts.
2-6s: Spark becomes a flowing magenta/cyan ribbon. Pixel Wizard grabs it with both little arms, gets pulled into a graceful surfing arc around the preview, and stretches and wobbles comically. The ribbon sweeps precisely across the image like a creative edit, opening a luminous portal. The miniature city blooms into jewel-like clarity: beveled glass towers, tiny warm windows, reflective water, woven silk banners and sparkling star particles. Smooth camera dolly with a short orbit, strong parallax, coherent reflections, fine stable materials. Spark causes the transformation; the product preview remains the visual hero.
6-8.5s: The camera settles back into a handsome product hero view. Pixel Wizard lands beside the now crystal-clear preview, bounces proudly, adjusts his floppy hat with a cheeky grin, and gives one little wink. The Spark ribbon resolves into the familiar radiant magenta creative signature beside the display.
8.5-10s: Hold a polished composition with the product and mascot in the left two-thirds and clean dark-purple negative space on the right for a title to be added in post. Gentle particles and mascot breathing only. No generated subtitles, no panel grid, no watermark, no extra creatures, no unreadable typography.
Audio: bright modern electronic brand music, playful elastic plucks, sparkling sweep and soft comic pop, synchronized to the action, ending with a satisfying musical resolve. A warm confident Mandarin voice at about 6 seconds says exactly: “高清创意，也可以很轻松。马卡龙。” No other speech. Beautiful clean lighting, vivid restrained magenta and cyan, appealing expressive animation, physically coherent motion and consistent character identity throughout.`;

const refsPath = join(dir, 'references.private.json');
let refs: string[];
if (await exists(refsPath)) refs = JSON.parse(await readFile(refsPath, 'utf8'));
else {
  const paths = [
    '/Users/tianyicai/.codex/skills/makaron-mascot-spark/assets/makaron-spark-pixel-wizard-concepts.png',
    '/Users/tianyicai/Downloads/IMG_4668.PNG',
    '/Users/tianyicai/Downloads/截屏2026-06-22 19.16.33.png',
  ];
  refs = [];
  for (const path of paths) refs.push(await fal.storage.upload(new Blob([await readFile(path)], { type: 'image/png' })));
  await save(refsPath, refs);
}
const failure = await validateSeedanceImageReferences(refs);
if (failure) throw new Error(`Reference preflight failed: ${failure.code}`);
await writeFile(join(dir, 'prompt.txt'), prompt);
const common = { model: 'seedance-2.5-reference-to-video', prompt, image_urls: refs, duration: 10, aspect_ratio: '16:9', generate_audio: true, content_filter: true, output_format: 'mp4' };
const fingerprint = createHash('sha256').update(JSON.stringify(common)).digest('hex');
await save(join(dir, 'brief.json'), { fingerprint, requestedSeconds: 10, generationsAllowed: 2, estimatedTotalUsd: 9.02, prompt, referenceCount: refs.length });

async function api(path: string, body?: unknown) {
  const response = await fetch(`https://api.evolink.ai${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`EvoLink HTTP ${response.status}`);
  return response.json();
}
function upscale(report: string) {
  return new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, ['--import', 'dotenv/config', '--import', 'tsx', 'scripts/seedance25-upscale-live.mts', report, 'flashvsr'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    child.stdout.on('data', chunk => { const lines = String(chunk).split('\n').filter(line => line.startsWith('[upscale-live]')); for (const line of lines) console.log(line); });
    let error = '';
    child.stderr.on('data', chunk => { error += String(chunk); });
    child.on('close', code => code === 0 ? done() : reject(new Error(`Upscale exited ${code}; inspect saved failure receipt (${error.length} diagnostic bytes)`)));
    child.on('error', reject);
  });
}
async function run(name: string, quality: string) {
  const startedPath = join(dir, `${name}.submit.private.json`);
  const taskPath = join(dir, `${name}.task.private.json`);
  const payload = { ...common, quality };
  let receipt: any;
  if (await exists(taskPath)) {
    receipt = JSON.parse(await readFile(taskPath, 'utf8'));
    if (receipt.fingerprint !== fingerprint) throw new Error('Existing task belongs to another prompt');
  } else {
    if (await exists(startedPath)) throw new Error(`${name} submission uncertain; do not submit again`);
    const startedAt = new Date().toISOString();
    await writeFile(startedPath, JSON.stringify({ startedAt, fingerprint, payload }, null, 2), { flag: 'wx' });
    const created = await api('/v1/videos/generations', payload);
    if (!created.id) throw new Error(`${name}: missing task ID; do not resubmit`);
    receipt = { taskId: created.id, startedAt, acceptedAt: new Date().toISOString(), fingerprint, created };
    await save(taskPath, receipt);
    console.log(`[mascot-ab] ${name} accepted ${receipt.taskId}`);
  }
  const deadline = Date.now() + 45 * 60_000;
  let result: any;
  while (Date.now() < deadline) {
    try { result = await api(`/v1/tasks/${receipt.taskId}`); }
    catch { console.log(`[mascot-ab] ${name} query unavailable; retaining same receipt`); await new Promise(done => setTimeout(done, 10_000)); continue; }
    await save(join(dir, `${name}.status.private.json`), result);
    console.log(`[mascot-ab] ${name} ${result.status} ${result.progress ?? ''}`);
    if (result.status === 'completed' || result.status === 'failed') break;
    await new Promise(done => setTimeout(done, 10_000));
  }
  if (result?.status !== 'completed' || !result.results?.[0]) throw new Error(`${name}: not completed; resume same receipt only`);
  const completedAt = new Date().toISOString();
  const videoUrl = typeof result.results[0] === 'string' ? result.results[0] : result.results[0].url;
  const reportPath = join(dir, `${name}.result.json`);
  const config = { name, quality, aspectRatio: '16:9', duration: 10, outputFormat: 'mp4' };
  await save(reportPath, { taskId: receipt.taskId, startedAt: receipt.startedAt, completedAt, result: { status: 'completed', videoUrl }, config });
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`${name}: download HTTP ${response.status}`);
  await writeFile(join(dir, `${name}.mp4`), new Uint8Array(await response.arrayBuffer()));
  const downloadedAt = new Date().toISOString();
  await save(join(dir, `${name}.timing.json`), { startedAt: receipt.startedAt, acceptedAt: receipt.acceptedAt, completedAt, downloadedAt, generationSeconds: (Date.parse(completedAt) - Date.parse(receipt.startedAt)) / 1000, readySeconds: (Date.parse(downloadedAt) - Date.parse(receipt.startedAt)) / 1000, usage: result.usage, taskId: receipt.taskId });
  console.log(`[mascot-ab] ${name} downloaded`);
  if (quality === '480p') {
    const upscaleStartedAt = new Date().toISOString();
    await upscale(reportPath);
    const readyAt = new Date().toISOString();
    await save(join(dir, 'economy-pipeline.timing.json'), { startedAt: receipt.startedAt, upscaleStartedAt, readyAt, upscaleWithDownloadAndEncodeSeconds: (Date.parse(readyAt) - Date.parse(upscaleStartedAt)) / 1000, totalSeconds: (Date.parse(readyAt) - Date.parse(receipt.startedAt)) / 1000 });
    console.log('[mascot-ab] economy 1080p ready');
  }
}

const outcomes = await Promise.allSettled([run('mascot-480p', '480p'), run('mascot-native-1080p', '1080p')]);
for (let i = 0; i < outcomes.length; i++) {
  const outcome = outcomes[i];
  if (outcome.status === 'rejected') console.error(`[mascot-ab] route ${i}: ${outcome.reason.message}`);
}
if (outcomes.some(item => item.status === 'rejected')) process.exitCode = 1;
