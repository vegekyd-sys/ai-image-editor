/** Frozen Image 2.5 acceptance scenes, explicitly paired against Image 2.6.
 * Run: node --env-file=<private-env> --import tsx scripts/gpt-image-regression.ts
 * Optional: IMAGE_REGRESSION_CASES=poster,sticker IMAGE_REGRESSION_VERSIONS=2.5,2.6
 * Journals before every paid POST. Resume only accepted IDs; unknown POST outcomes stop.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { buildFalImage25Request, falImage25Cost } from '../src/lib/models/fal-image25';
import type { FalGptImageId } from '../src/lib/models/types';

const root = path.resolve('testcases/gpt-image-regression');
const suite = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.resolve(process.env.IMAGE_REGRESSION_OUTPUT ?? 'evidence/gpt-image26-regression/paired');
const headers = { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' };
if (!process.env.FAL_KEY) throw new Error('FAL_KEY required');
const hash = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const write = (file: string, data: unknown) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(file + '.tmp', file); };
function fixture(file?: string) {
  if (!file) return undefined;
  const bytes = fs.readFileSync(path.join(root, 'fixtures', file));
  if (hash(bytes) !== suite.fixtures[file]?.sha256) throw new Error(`Fixture changed: ${file}`);
  return `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`;
}
const selected = process.env.IMAGE_REGRESSION_CASES?.split(',');
const versions = (process.env.IMAGE_REGRESSION_VERSIONS ?? '2.5,2.6').split(',');
async function main() {
for (const [index, c] of suite.cases.entries()) {
  if (selected && !selected.includes(c.id)) continue;
  for (const version of index % 2 ? [...versions].reverse() : versions) {
    if (!['2.5', '2.6'].includes(version)) throw new Error('Unsupported comparison version');
    const model = `gpt-image-${version}-flare` as FalGptImageId;
    const dir = path.join(out, c.id, version); fs.mkdirSync(dir, { recursive: true });
    const receipt = path.join(dir, 'receipt.json');
    let s: any = fs.existsSync(receipt) ? JSON.parse(fs.readFileSync(receipt, 'utf8')) : null;
    if (s?.stage === 'complete' || s?.stage === 'rejected') { console.log(c.id, version, s.stage); continue; }
    if (s && !s.request_id) throw new Error(`Unknown submission outcome for ${c.id}/${version}; do not re-POST`);
    const { endpoint, body } = buildFalImage25Request({ prompt: c.prompt, image: fixture(c.image), references: c.refs?.map((f: string, i: number) => ({ url: fixture(f)!, role: `Reference image ${i + 1}` })), aspectRatio: c.aspect, background: c.background, imageQuality: 'low', ...(version === '2.6' ? { imageReasoningEffort: 'high' as const } : {}) }, model);
    if (!s) {
      const priceRes = await fetch(`https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(endpoint)}`, { headers, signal: AbortSignal.timeout(15000) });
      const p = (await priceRes.json()).prices?.find((p: any) => p.endpoint_id === endpoint);
      if (!priceRes.ok || p?.currency !== 'USD' || !(p.unit_price > 0)) throw new Error('Pricing unavailable before POST');
      s = { case_id: c.id, model, endpoint, stage: 'submitting', started_at: new Date().toISOString(), started_ms: Date.now(), price: p, submission_count: 1, request: { ...body, ...(body.image_urls ? { image_urls: [c.image, ...(c.refs ?? [])].map(f => ({ fixture: f, sha256: suite.fixtures[f].sha256 })) } : {}) } };
      write(receipt, s);
      const response = await fetch(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
      const task = await response.json();
      if (!response.ok) { s.stage = 'rejected'; s.http_status = response.status; s.error = task; write(receipt, s); continue; }
      if (!task.request_id || !task.response_url) throw new Error('Unknown POST outcome');
      const url = new URL(task.response_url);
      if (url.protocol !== 'https:' || url.hostname !== 'queue.fal.run' || url.search || url.username) throw new Error('Unexpected receipt URL');
      Object.assign(s, { request_id: task.request_id, result_url: url.href, stage: 'accepted', accepted_ms: Date.now() }); write(receipt, s);
    }
    const timeout = Date.now() + 600000;
    while (true) {
      if (Date.now() > timeout) throw new Error(`Accepted request remains pending: ${s.request_id}`);
      const r = await fetch(`${s.result_url}/status`, { headers, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`Read-only status HTTP ${r.status}; rerun to resume original ID`);
      const status = await r.json();
      if (status.status === 'COMPLETED') break;
      if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw new Error('Unexpected provider status');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    const response = await fetch(s.result_url, { headers, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) { Object.assign(s, { stage: 'rejected', http_status: response.status, error: data, cost_usd: null, elapsed_ms: Date.now() - s.started_ms }); write(receipt, s); console.log(c.id, version, 'rejected', response.status); continue; }
    s.cost_usd = falImage25Cost(response.headers.get('x-fal-billable-units'), s.price.unit_price);
    s.provider_result_ms = Date.now() - s.started_ms; write(receipt, s);
    const url = new URL(data.images[0].url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.fal.media')) throw new Error('Unexpected media host');
    const download = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!download.ok) throw new Error('Download failed; rerun original ID only');
    const bytes = Buffer.from(await download.arrayBuffer());
    const m = await sharp(bytes).metadata(); const stats = await sharp(bytes).stats();
    fs.writeFileSync(path.join(dir, 'output.png'), bytes);
    Object.assign(s, { stage: 'complete', elapsed_ms: Date.now() - s.started_ms, media: { format: m.format, width: m.width, height: m.height, alpha: m.hasAlpha ? stats.channels[3] : null }, sha256: hash(bytes), bytes: bytes.length, fallback: false });
    write(receipt, s); console.log(c.id, version, `${s.elapsed_ms}ms`, `$${s.cost_usd}`);
  }
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
