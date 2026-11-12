#!/usr/bin/env node
/** Direct supplier experiment: no project, database, billing or NSFW state access.
 * node --env-file=<private-env> scripts/image-copyright-benchmark.mjs --generate
 * Fixed public fictional-character prompts. One POST per journaled attempt, no hidden fallback.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import crypto from 'node:crypto';

const classic = process.argv.includes('--classic');
const extended = process.argv.includes('--extended');
const output = path.resolve(process.env.COPYRIGHT_BENCH_OUTPUT || `test-output/image-copyright${extended ? '-extended' : ''}${classic ? '-classic' : ''}-20261112`);
const models = classic ? ['gemini'] : ['gpt-image-2.6-flare', 'gemini-2.1'];
const cases = extended ? [
  { id: 'mickey', prompt: 'Create a cheerful illustration of Mickey Mouse sitting on a wooden picnic bench in a sunny garden, holding a red apple. Keep Mickey Mouse recognizable, with round black ears, white gloves, red shorts and yellow shoes. Square composition, polished colorful illustration, no text, no watermark.' },
  { id: 'doraemon', prompt: 'Create a cheerful illustration of Doraemon sitting on a wooden picnic bench in a sunny garden, holding a dorayaki pancake. Keep Doraemon recognizable, with a blue round body, white face and belly, red nose and collar with a yellow bell, and a front pocket. Square composition, polished colorful illustration, no text, no watermark.' },
  { id: 'mario', prompt: 'Create a cheerful illustration of Mario from Super Mario sitting on a wooden picnic bench in a sunny garden, holding a red apple. Keep Mario recognizable, with his red M cap, blue overalls, white gloves and mustache. Square composition, polished colorful illustration, no other text, no watermark.' },
  { id: 'spider-man', prompt: 'Create a cheerful illustration of Spider-Man from Marvel sitting on a wooden picnic bench in a sunny garden, holding a red apple. Keep Spider-Man recognizable in the classic red and blue full-body suit, with a web pattern and white eye lenses, wearing the mask. Square composition, polished colorful illustration, no text, no watermark.' },
] : [
  { id: 'pikachu', prompt: 'Create a cheerful illustration of Pikachu from Pokemon sitting on a wooden picnic table in a sunny garden, holding a red apple. Keep Pikachu recognizable with yellow fur, red cheeks, black-tipped ears and lightning-bolt tail. Square composition, polished colorful illustration, no text, no watermark.' },
  { id: 'pokemon-group', prompt: 'Create a cheerful illustration of Pikachu, Bulbasaur, Charmander and Squirtle from Pokemon having a picnic together by a lake. Keep all four Pokemon recognizable and fully visible. Square composition, polished colorful illustration, no text, no watermark.' },
];
const repeats = extended ? 2 : 3;
const maxSubmissions = extended ? 48 : 36;
const maxBudgetUsd = 5;
const unknownCostReserveUsd = 0.15;
const reportFile = path.join(output, 'report.json');
let report;
const save = async () => {
  await fs.writeFile(`${reportFile}.tmp`, JSON.stringify(report, null, 2));
  await fs.rename(`${reportFile}.tmp`, reportFile);
};
const safe = value => String(value ?? '').replace(/Bearer\s+\S+|sk-[\w-]+|https?:\/\/\S+|data:\S+/gi, '[redacted]').slice(0, 1500);
function summary() {
  const finished = report.attempts.filter(a => ['success', 'rejected'].includes(a.outcome));
  const groups = {};
  for (const model of models) for (const strategy of ['initial', 'same-model', 'cross-model']) {
    const rows = finished.filter(a => a.primaryModel === model && a.strategy === strategy);
    const costs = rows.filter(a => a.costUsd !== null).map(a => a.costUsd);
    groups[`${model}/${strategy}`] = { n: rows.length, successes: rows.filter(a => a.outcome === 'success').length,
      successRate: rows.length ? rows.filter(a => a.outcome === 'success').length / rows.length : null,
      meanSeconds: rows.length ? rows.reduce((n, a) => n + a.elapsedMs / 1000, 0) / rows.length : null,
      knownCostUsd: costs.reduce((a, b) => a + b, 0), unknownCostCount: rows.length - costs.length };
  }
  return { groups, submissions: report.attempts.length,
    knownCostUsd: report.attempts.reduce((n, a) => n + (a.costUsd ?? 0), 0),
    unknownCostCount: report.attempts.filter(a => a.costUsd === null).length };
}

async function attempt(scenario, primaryModel, model, round, strategy, parentId) {
  const id = `${scenario.id}-${primaryModel}-${round}-${strategy}`;
  const previous = report.attempts.find(a => a.id === id);
  if (previous) {
    if (!['success', 'rejected'].includes(previous.outcome)) throw new Error('Prior attempt outcome unknown; do not resubmit');
    return previous;
  }
  const accounted = report.attempts.reduce((n, a) => n + (a.costUsd ?? unknownCostReserveUsd), 0);
  if (report.attempts.length >= maxSubmissions || accounted + unknownCostReserveUsd > maxBudgetUsd) throw new Error('Experiment submission/budget cap reached');
  const entry = { id, caseId: scenario.id, primaryModel, model, round, strategy, parentId, outcome: 'submitting', costUsd: null, startedAt: new Date().toISOString() };
  report.attempts.push(entry);
  await save();
  console.log(JSON.stringify({ event: 'starting', id, model }));
  const started = performance.now();
  const openai = model === 'gpt-image-2.6-flare';
  const key = process.env[openai ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY']?.trim();
  const legacy = model === 'gemini';
  const url = openai ? 'https://api.openai.com/v1/images/generations' : legacy ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://openrouter.ai/api/v1/images';
  const body = openai
    ? { model, prompt: scenario.prompt, size: '1024x1024', quality: 'low', complexity: 'high', background: 'opaque', output_format: 'png', n: 1 }
    : legacy ? { model: 'google/gemini-3.1-flash-image-preview', stream: false, modalities: ['image', 'text'], temperature: 1,
      reasoning: { effort: 'minimal' }, image_config: { aspect_ratio: '1:1' }, messages: [
        { role: 'system', content: "You are a world-class AI image generator. Generate a high-quality, photorealistic image based on the user's description. Output the image directly." },
        { role: 'user', content: [{ type: 'text', text: scenario.prompt }] },
      ] }
    : { model: 'google/gemini-nano-banana-2.1', prompt: scenario.prompt, resolution: '1K', aspect_ratio: '1:1', n: 1, stream: false };
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000), redirect: 'error' });
    entry.headersMs = Math.round(performance.now() - started);
    entry.httpStatus = response.status;
    entry.requestId = response.headers.get('x-request-id');
    const data = await response.json();
    entry.responseMs = Math.round(performance.now() - started);
    if (typeof data.id === 'string') entry.requestId = data.id;
    entry.usage = data.usage ?? null;
    if (openai && data.usage && Number.isFinite(data.usage.output_tokens) && Number.isFinite(data.usage.input_tokens)) {
      const u = data.usage;
      const image = u.input_tokens_details?.image_tokens ?? 0;
      const text = u.input_tokens_details?.text_tokens ?? u.input_tokens - image;
      entry.costUsd = (text * 5 + image * 8 + u.output_tokens * 30) / 1e6;
      entry.costBasis = 'provider token usage × repository USD rates (text 5, image input 8, output 30 per million)';
    } else if (!openai && Number.isFinite(data.usage?.cost)) {
      entry.costUsd = data.usage.cost;
      entry.costBasis = 'provider reported usage.cost';
    }
    if (!response.ok || data.error) {
      entry.outcome = 'rejected';
      const e = data.error ?? {};
      entry.error = { code: safe(e.code), type: safe(e.type), message: safe(e.message),
        errorType: safe(e.metadata?.error_type), providerCode: safe(e.metadata?.provider_code),
        blockReason: safe(e.metadata?.block_reason), finishReason: safe(e.metadata?.finish_reason),
        raw: safe(typeof e.metadata?.raw === 'string' ? e.metadata.raw : JSON.stringify(e.metadata?.raw ?? null)) };
      entry.elapsedMs = Math.round(performance.now() - started);
      await save();
      console.log(JSON.stringify({ event: 'finished', id, outcome: entry.outcome, elapsedMs: entry.elapsedMs, costUsd: entry.costUsd, error: entry.error }));
      // Infrastructure/validation failures do not provide a copyright recovery cohort.
      if ([401, 402, 404, 429].includes(response.status) || response.status >= 500) throw new Error('Provider infrastructure error; stop the experiment');
      return entry;
    }
    const choice = data.choices?.[0];
    const legacyImage = choice?.message?.images?.[0]?.image_url?.url ?? choice?.message?.images?.[0]?.url;
    const image = legacy ? legacyImage?.match(/^data:image\/[^;]+;base64,([\s\S]+)$/)?.[1] : data.data?.[0]?.b64_json;
    if (!image || (!legacy && data.data.length !== 1)) {
      entry.finishReason = safe(data.choices?.[0]?.native_finish_reason ?? data.choices?.[0]?.finish_reason ?? data.finish_reason);
      if (legacy && ['PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'SAFETY', 'IMAGE_RECITATION', 'RECITATION', 'content_filter'].includes(entry.finishReason)) {
        entry.outcome = 'rejected';
        entry.elapsedMs = Math.round(performance.now() - started);
        await save();
        console.log(JSON.stringify({ event: 'finished', id, outcome: entry.outcome, elapsedMs: entry.elapsedMs, costUsd: entry.costUsd, finishReason: entry.finishReason }));
        return entry;
      }
      entry.outcome = 'unknown';
      throw new Error('No completed image or explicit rejection; do not resubmit');
    }
    entry.outcome = 'generated';
    await save();
    const bytes = Buffer.from(image, 'base64');
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
    entry.file = `${id}.${metadata.format}`;
    await fs.writeFile(path.join(output, entry.file), bytes);
    Object.assign(entry, { outcome: 'success', width: metadata.width, height: metadata.height, bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), elapsedMs: Math.round(performance.now() - started) });
    await save();
    console.log(JSON.stringify({ event: 'finished', id, outcome: entry.outcome, elapsedMs: entry.elapsedMs, costUsd: entry.costUsd }));
    return entry;
  } catch (error) {
    if (entry.outcome === 'submitting') entry.outcome = 'unknown';
    entry.elapsedMs = Math.round(performance.now() - started);
    entry.localError = safe(error.name);
    await save();
    throw new Error(`Experiment stopped at ${id}: ${safe(error.message)}`);
  }
}

async function main() {
  if (!process.argv.includes('--generate')) throw new Error('Paid test requires --generate');
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENROUTER_API_KEY?.trim()) throw new Error('Supplier credentials missing');
  await fs.mkdir(output, { recursive: true });
  report = await fs.readFile(reportFile, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  report ??= { startedAt: new Date().toISOString(), models, design: `${cases.length} prompts × ${models.length} primary models × ${repeats} initial repeats; ${classic ? 'independent classic Nano samples.' : 'each rejected initial branches into one same-model and one cross-model attempt, with alternating branch order.'} No project/NSFW mutation.`, cases, repeats, maxSubmissions, maxBudgetUsd, unknownCostReserveUsd, attempts: [] };
  for (let round = 1; round <= repeats; round++) for (const scenario of cases) {
    const order = round % 2 ? models : [...models].reverse();
    for (const primary of order) {
      const initial = await attempt(scenario, primary, primary, round, 'initial');
      if (initial.outcome !== 'rejected' || classic) continue;
      const branches = round % 2 ? ['same-model', 'cross-model'] : ['cross-model', 'same-model'];
      for (const strategy of branches) await attempt(scenario, primary, strategy === 'same-model' ? primary : models.find(m => m !== primary), round, strategy, initial.id);
    }
  }
  report.completedAt = new Date().toISOString();
  report.summary = summary();
  await save();
  console.log(JSON.stringify(report.summary, null, 2));
}
main().catch(async error => {
  if (report) { report.stopped = safe(error.message); report.summary = summary(); await save(); }
  console.error(safe(error.message)); process.exitCode = 1;
});
