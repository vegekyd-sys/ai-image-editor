// Run sequentially so baselines and warm cache tests do not compete for bandwidth.
// Usage: node benchmark.mjs manifest.json https://candidate.workers.dev output-dir
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const [manifestPath, candidate, output] = process.argv.slice(2);
if (!manifestPath || !candidate || !output) throw new Error('Usage: node benchmark.mjs manifest.json candidate-url output-dir');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const items = manifest.items || manifest.videos || manifest.files;
if (!Array.isArray(items)) throw new Error('Manifest items missing');
await fs.mkdir(output, { recursive: true });
function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args); let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('close', code => code ? reject(new Error(`curl ${code}: ${err}`)) : resolve(out));
  });
}
async function download(url, label, range) {
  const body = path.join(output, label + '.bin'), headers = path.join(output, label + '.headers');
  const args = ['-sS', '--fail', '--connect-timeout', '15', '--max-time', '180', '-H', 'Origin: https://makaron.app', '-D', headers, '-o', body, '-w', '%{json}', url];
  if (range) args.push('-H', `Range: bytes=${range[0]}-${range[1]}`);
  const stats = JSON.parse(await command(args));
  const raw = await fs.readFile(headers, 'utf8');
  const get = name => [...raw.matchAll(new RegExp(`^${name}:\\s*(.*)$`, 'gmi'))].at(-1)?.[1].trim() || null;
  const data = await fs.readFile(body);
  if (range && (stats.http_code !== 206 || get('content-range') !== `bytes ${range[0]}-${range[1]}/${range[2]}` || data.length !== range[1] - range[0] + 1)) throw new Error('Invalid range response');
  return { label, http: stats.http_code, seconds: stats.time_total, ttfb: stats.time_starttransfer, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), cache: get('x-makaron-cache'), cfCache: get('cf-cache-status'), ray: get('cf-ray'), etag: get('etag'), body };
}
const results = { host: os.hostname(), started: new Date().toISOString(), candidate, results: [] };
async function record(fn, label) {
  try { const result = await fn(); results.results.push(result); console.log(JSON.stringify(result)); }
  catch (e) { results.results.push({ label, error: e.message }); console.error(label, e.message); }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
// One large video and one small video make cold/warm and per-connection effects visible.
for (const index of [0, 4]) {
  const item = items[index], original = item.url || item.source_url || item.videoUrl;
  const target = new URL(original); const candidateUrl = new URL(target.pathname + target.search, candidate).href;
  for (const [mode, url] of [['baseline', original], ['cold', candidateUrl], ['warm', candidateUrl]]) await record(() => download(url, `${index + 1}-${mode}`), `${index + 1}-${mode}`);
  const total = results.results.find(r => r.label === `${index + 1}-baseline`)?.bytes;
  if (!total) continue;
  await record(async () => {
    const start = performance.now(), chunk = Math.ceil(total / 4);
    const parts = await Promise.all(Array.from({ length: 4 }, (_, i) => download(candidateUrl, `${index + 1}-parallel-${i}`, [i * chunk, Math.min(total - 1, (i + 1) * chunk - 1), total])));
    if (new Set(parts.map(p => p.etag)).size !== 1) throw new Error('Changed ETag');
    const hash = createHash('sha256'); for (const part of parts) hash.update(await fs.readFile(part.body));
    return { label: `${index + 1}-parallel`, seconds: (performance.now() - start) / 1000, bytes: total, sha256: hash.digest('hex'), parts };
  }, `${index + 1}-parallel`);
}
