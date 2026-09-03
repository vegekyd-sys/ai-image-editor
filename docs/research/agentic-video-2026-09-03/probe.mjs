// Research only: Google public sample, no Makaron project writes or credit charges.
// API inference is billed to the supplied Google key. Node >= 22 required.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
  return args[index + 1];
}
if (args.includes('--help')) {
  console.log('node probe.mjs --env /path/to/.env.local [--model gemini-3.7-flash] [--out /path/to/results.json]');
  process.exit(0);
}
const envFile = option('--env');
if (envFile) process.loadEnvFile(envFile);
const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!key) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY required');
const model = option('--model', 'gemini-3.7-flash');
const outputPath = resolve(option('--out', fileURLToPath(new URL('./results.json', import.meta.url))));
const source = 'https://storage.googleapis.com/cloud-samples-data/generative-ai/video/pixel8.mp4';
const prompt = 'Describe the entire video chronologically for a creative editor. Cover subjects, setting, actions, scene changes, notable text, framing, mood, and the most useful moments. Be concise but specific.';
const base = 'https://generativelanguage.googleapis.com/v1beta';
const redact = text => String(text).replaceAll(key, '[REDACTED]');
async function request(path, body) {
  const start = performance.now();
  try {
    const response = await fetch(`${base}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { error: { message: redact(raw.slice(0, 1500)) } }; }
    return { httpStatus: response.status, elapsedMs: Math.round(performance.now() - start), data };
  } catch (error) {
    return { httpStatus: null, elapsedMs: Math.round(performance.now() - start), data: { error: { message: redact(error.message) } } };
  }
}
const result = { checkedAt: new Date().toISOString(), source, prompt, candidateModel: model, purpose: 'Availability and one short-video smoke; not a quality benchmark', runs: [] };
async function persist() {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, redact(JSON.stringify(result, null, 2)) + '\n');
}
const models = await request('models?pageSize=1000');
result.discovery = {
  httpStatus: models.httpStatus,
  error: models.data.error,
  flashModels: models.data.models?.filter(m => /gemini-3.*flash/.test(m.name)).map(m => m.name),
};
await persist();

const downloadStart = performance.now();
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Sample download HTTP ${response.status}`);
// This fixed Google sample is ~5 MB; cap encoded payload below the documented 20 MB limit.
const buffer = Buffer.from(await response.arrayBuffer());
if (buffer.length > 14_000_000) throw new Error('Public sample exceeds inline probe budget');
result.sourceDownload = { elapsedMs: Math.round(performance.now() - downloadStart), bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
const inlineData = { mimeType: 'video/mp4', data: buffer.toString('base64') };

// Reproduce the current helper's URL-first -> inline-on-error behavior.
const currentStart = performance.now();
let current = await request('models/gemini-3-flash-preview:generateContent', {
  contents: [{ role: 'user', parts: [{ fileData: { mimeType: 'video/mp4', fileUri: source } }, { text: prompt }] }],
});
const attempts = [{ transport: 'url', httpStatus: current.httpStatus, elapsedMs: current.elapsedMs, error: current.data.error }];
if (current.httpStatus !== 200) {
  current = await request('models/gemini-3-flash-preview:generateContent', {
    contents: [{ role: 'user', parts: [{ inlineData }, { text: prompt }] }],
  });
  attempts.push({ transport: 'inline', httpStatus: current.httpStatus, elapsedMs: current.elapsedMs, error: current.data.error });
}
const currentText = current.data.candidates?.[0]?.content?.parts?.filter(p => p.text && !p.thought).map(p => p.text).join('\n') || '';
result.runs.push({
  arm: 'current-static', model: 'gemini-3-flash-preview', api: 'generateContent',
  httpStatus: current.httpStatus, elapsedMs: Math.round(performance.now() - currentStart), attempts,
  text: currentText, completedWithText: current.httpStatus === 200 && Boolean(currentText),
  usage: current.data.usageMetadata, finishReason: current.data.candidates?.[0]?.finishReason, error: current.data.error,
});
console.log(JSON.stringify({ arm: 'current-static', httpStatus: current.httpStatus, elapsedMs: result.runs.at(-1).elapsedMs, textChars: currentText.length }));
await persist();

// Matched pair: same model, bytes, prompt, reasoning, output cap, storage policy.
for (const processing of ['static', 'agentic']) {
  const reply = await request('interactions', {
    model, store: false,
    input: [{ type: 'video', mime_type: 'video/mp4', data: inlineData.data, processing }, { type: 'text', text: prompt }],
    generation_config: { thinking_level: 'medium', max_output_tokens: 4096 },
  });
  const data = reply.data;
  const steps = data.steps || [];
  const text = data.output_text || steps.filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') || (data.outputs || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const stepTypes = steps.map(s => s.type);
  const processingObserved = stepTypes.includes('processing_call') && stepTypes.includes('processing_result');
  result.runs.push({
    arm: `candidate-${processing}`, model, api: 'interactions', transport: 'inline',
    config: { thinking_level: 'medium', max_output_tokens: 4096, store: false },
    httpStatus: reply.httpStatus, elapsedMs: reply.elapsedMs, status: data.status,
    text, completedWithText: reply.httpStatus === 200 && data.status === 'completed' && Boolean(text),
    processingObserved, stepTypes, usage: data.usage, error: data.error,
    responseKeys: Object.keys(data),
  });
  console.log(JSON.stringify({ arm: `candidate-${processing}`, httpStatus: reply.httpStatus, elapsedMs: reply.elapsedMs, processingObserved, textChars: text.length, error: data.error }));
  await persist();
}
console.log(`Saved ${outputPath}`);
if (result.runs.some(run => !run.completedWithText) || !result.runs.at(-1).processingObserved) process.exitCode = 1;
