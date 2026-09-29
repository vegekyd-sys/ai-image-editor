#!/usr/bin/env node
// Direct Image API benchmark. No app database, billing, or fallback writes.
// Load credentials through the environment; never pass them on the command line.
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';

const models = (process.env.IMAGE_BENCH_MODELS || 'gpt-image-2,gpt-image-2.5-flare,gpt-image-2.5-sunburst').split(',');
const base = (process.env.IMAGE_BENCH_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const key = process.env.OPENAI_API_KEY;
const quality = process.env.IMAGE_BENCH_QUALITY || 'low';
const size = process.env.IMAGE_BENCH_SIZE || '1024x1024';
const prompt = process.env.IMAGE_BENCH_PROMPT || 'Create a refined studio product photograph of a red ceramic coffee cup on pale limestone. The cup has the exact printed word MAKARON. Include realistic glaze texture, a soft window shadow, and a small folded linen napkin. No other text.';
const inputPaths = process.argv.slice(2);
const output = path.resolve(process.env.IMAGE_BENCH_OUTPUT || `test-output/image25/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const background = process.env.IMAGE_BENCH_BACKGROUND || 'opaque';
const repeats = Number(process.env.IMAGE_BENCH_REPEATS || '1');
if (!key) throw new Error('Set OPENAI_API_KEY in the environment before running this paid benchmark.');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('IMAGE_BENCH_REPEATS must be 1–5.');
if (!models.every(m => /^gpt-image-(2|2\.5-(flare|sunburst))$/.test(m))) throw new Error('Unsupported benchmark model.');
if (!['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality)) throw new Error('Unsupported quality.');
if (models.includes('gpt-image-2') && ['xhigh', 'max'].includes(quality)) throw new Error('Image 2 does not support xhigh/max; use low/medium/high for a matched comparison.');
if (!['opaque', 'transparent', 'auto'].includes(background)) throw new Error('Unsupported background.');
const inputs = await Promise.all(inputPaths.map(async p => ({ name: path.basename(p), buffer: await fs.readFile(p) })));
await fs.mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), prompt, quality, size, background, inputs: inputs.map(i => i.name), results: [] };
for (let repeat = 0; repeat < repeats; repeat++) {
  // Rotate execution order to reduce systematic order bias. No automatic retries.
  const order = [...models.slice(repeat % models.length), ...models.slice(0, repeat % models.length)];
  for (const model of order) {
    const headers = { Authorization: `Bearer ${key}` };
    const fields = { model, prompt, quality, size, background, output_format: 'png', n: 1 };
    let body;
    if (inputs.length) {
      body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.append(k, String(v));
      for (const input of inputs) {
        const format = (await sharp(input.buffer).metadata()).format;
        body.append('image[]', new Blob([input.buffer], { type: `image/${format}` }), input.name);
      }
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(fields);
    }
    const result = { model, repeat: repeat + 1 };
    const started = performance.now();
    console.log(`Starting ${model}, repeat ${repeat + 1}, quality=${quality}`);
    try {
      const res = await fetch(`${base}/images/${inputs.length ? 'edits' : 'generations'}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(300_000) });
      result.headersMs = Math.round(performance.now() - started);
      result.status = res.status;
      const data = await res.json();
      result.responseMs = Math.round(performance.now() - started);
      if (!res.ok || !data.data?.[0]?.b64_json) {
        result.error = data.error?.code || data.error?.type || 'missing_image';
      } else {
        const buffer = Buffer.from(data.data[0].b64_json, 'base64');
        const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
        await sharp(buffer, { failOn: 'error' }).raw().toBuffer();
        const alpha = metadata.hasAlpha ? (await sharp(buffer).stats()).channels[3] : null;
        result.hasTransparency = Boolean(alpha && alpha.min < 255);
        result.file = `${model}-${repeat + 1}.${metadata.format}`;
        await fs.writeFile(path.join(output, result.file), buffer);
        Object.assign(result, { readyMs: Math.round(performance.now() - started), width: metadata.width, height: metadata.height, bytes: buffer.length, usage: data.usage });
        if (background === 'transparent' && !result.hasTransparency) result.error = 'missing_real_alpha';
      }
    } catch (error) {
      result.error = error.name;
      result.elapsedMs = Math.round(performance.now() - started);
    }
    report.results.push(result);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(result));
  }
}
console.log(`Report: ${path.join(output, 'report.json')}`);
if (report.results.some(r => r.error)) process.exitCode = 1;
