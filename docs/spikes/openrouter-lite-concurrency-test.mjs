#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SOURCE_DEFAULT = path.join(ROOT, 'test-results/nano-banana-lite-vs-nb2-v1/results.json');
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-3.1-flash-lite-image';

function parseArgs(argv) {
  const args = {
    source: SOURCE_DEFAULT,
    levels: [1, 2, 4],
    out: 'openrouter-lite-concurrency-v1',
    limit: Infinity,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = path.resolve(argv[++i] || args.source);
    else if (arg === '--levels') args.levels = (argv[++i] || '').split(',').map((n) => Number(n.trim())).filter(Boolean);
    else if (arg === '--out') args.out = argv[++i] || args.out;
    else if (arg === '--limit') args.limit = Number(argv[++i] || args.limit);
    else if (arg === '--help' || arg === '-h') {
      console.log(`OpenRouter Lite concurrency test

Usage:
  node docs/spikes/openrouter-lite-concurrency-test.mjs
  node docs/spikes/openrouter-lite-concurrency-test.mjs --levels 1,3,5

Reuses original images and editPrompts from a previous results.json. It only
tests OpenRouter Lite image edits; it does not generate tips, run NB2, or score.`);
      process.exit(0);
    }
  }
  return args;
}

function loadEnv() {
  const candidates = [
    path.join(ROOT, '.env.local'),
    '/Users/tianyicai/ai-image-editor/.env.local',
  ];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] ||= value;
  }
  console.log(`Loaded env from ${envPath}`);
}

function openrouterHeaders() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://www.makaron.app',
    'X-Title': 'Makaron OpenRouter Lite Concurrency Test',
  };
}

function buildJobs(sourcePath, limit) {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const sourceDir = path.dirname(sourcePath);
  const jobs = [];
  for (const image of source.images) {
    for (const comparison of image.comparisons) {
      const originalPath = path.join(sourceDir, comparison.originalImage);
      const imageBase64 = fs.readFileSync(originalPath).toString('base64');
      jobs.push({
        id: `${jobs.length}_${comparison.category}_${image.file}`,
        file: image.file,
        category: comparison.category,
        label: comparison.tip.label,
        desc: comparison.tip.desc,
        prompt: comparison.tip.editPrompt,
        promptChars: comparison.tip.editPrompt.length,
        imageBytes: fs.statSync(originalPath).size,
        dataUrl: `data:image/jpeg;base64,${imageBase64}`,
      });
    }
  }
  return jobs.slice(0, Math.min(limit, jobs.length));
}

async function runOne(job, level, runDir, index) {
  const body = {
    model: MODEL,
    stream: false,
    modalities: ['image', 'text'],
    temperature: 1,
    reasoning: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: job.dataUrl } },
          { type: 'text', text: job.prompt },
        ],
      },
    ],
  };
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const res = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: openrouterHeaders(),
      body: JSON.stringify(body),
    });
    const ttfbMs = Date.now() - started;
    const text = await res.text();
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      return {
        ...jobMeta(job),
        level,
        index,
        startedAt,
        elapsedMs,
        ttfbMs,
        ok: false,
        status: res.status,
        error: text.slice(0, 1000),
      };
    }
    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message;
    const imageUrl = message?.images?.[0]?.image_url?.url || message?.images?.[0]?.url || null;
    let outputImage = null;
    let outputBytes = 0;
    if (imageUrl?.startsWith('data:')) {
      const match = imageUrl.match(/^data:(.*?);base64,(.*)$/);
      if (match) {
        const ext = match[1].includes('jpeg') || match[1].includes('jpg') ? 'jpg' : 'png';
        outputImage = `images/c${level}_${index}_${job.category}.` + ext;
        const outputPath = path.join(runDir, outputImage);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, Buffer.from(match[2], 'base64'));
        outputBytes = Buffer.byteLength(match[2], 'base64');
      }
    }
    return {
      ...jobMeta(job),
      level,
      index,
      startedAt,
      elapsedMs,
      ttfbMs,
      ok: Boolean(outputImage),
      status: res.status,
      resolvedModel: data.model,
      usage: data.usage || null,
      outputImage,
      outputBytes,
      text: message?.content || '',
      error: outputImage ? null : 'No image returned',
    };
  } catch (error) {
    return {
      ...jobMeta(job),
      level,
      index,
      startedAt,
      elapsedMs: Date.now() - started,
      ttfbMs: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function jobMeta(job) {
  return {
    id: job.id,
    file: job.file,
    category: job.category,
    label: job.label,
    desc: job.desc,
    promptChars: job.promptChars,
    imageBytes: job.imageBytes,
  };
}

async function runPool(jobs, level, runDir) {
  const results = new Array(jobs.length);
  let next = 0;
  const waveStart = Date.now();
  async function worker(workerIndex) {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      const job = jobs[index];
      console.log(`  c${level} w${workerIndex}: [${index + 1}/${jobs.length}] ${job.category} ${job.label}`);
      results[index] = await runOne(job, level, runDir, index);
      const result = results[index];
      console.log(`    ${result.ok ? 'ok' : 'fail'} total ${(result.elapsedMs / 1000).toFixed(2)}s · ttfb ${result.ttfbMs == null ? '-' : (result.ttfbMs / 1000).toFixed(2) + 's'} ${result.error ? result.error.slice(0, 90) : ''}`);
    }
  }
  await Promise.all(Array.from({ length: level }, (_, index) => worker(index + 1)));
  return {
    level,
    wallMs: Date.now() - waveStart,
    results,
  };
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarizeRun(run) {
  const elapsed = run.results.map((result) => result.elapsedMs).filter(Boolean);
  const ttfb = run.results.map((result) => result.ttfbMs).filter((value) => typeof value === 'number');
  const ok = run.results.filter((result) => result.ok).length;
  const costs = run.results.map((result) => result.usage?.cost).filter((value) => typeof value === 'number');
  const byCat = {};
  for (const result of run.results) {
    const cat = byCat[result.category] ||= { count: 0, ok: 0, elapsed: [] };
    cat.count += 1;
    if (result.ok) cat.ok += 1;
    if (result.elapsedMs) cat.elapsed.push(result.elapsedMs);
  }
  for (const cat of Object.values(byCat)) {
    cat.avgMs = avg(cat.elapsed);
    cat.p50Ms = percentile(cat.elapsed, 50);
    cat.p90Ms = percentile(cat.elapsed, 90);
  }
  return {
    level: run.level,
    wallMs: run.wallMs,
    count: run.results.length,
    ok,
    fail: run.results.length - ok,
    avgMs: avg(elapsed),
    p50Ms: percentile(elapsed, 50),
    p90Ms: percentile(elapsed, 90),
    avgTtfbMs: avg(ttfb),
    p50TtfbMs: percentile(ttfb, 50),
    p90TtfbMs: percentile(ttfb, 90),
    minMs: elapsed.length ? Math.min(...elapsed) : 0,
    maxMs: elapsed.length ? Math.max(...elapsed) : 0,
    totalCost: costs.reduce((sum, value) => sum + value, 0),
    avgCost: avg(costs),
    byCat,
  };
}

function writeMarkdown(summaryPath, payload) {
  const lines = [];
  lines.push('# OpenRouter Lite Concurrency Test');
  lines.push('');
  lines.push(`Date: ${payload.timestamp}`);
  lines.push(`Model: \`${MODEL}\``);
  lines.push(`Source prompts: \`${payload.source}\``);
  lines.push('');
  lines.push('| Concurrency | Success | Wall time | Avg total | P50 total | P90 total | Avg TTFB | P90 TTFB | Min total | Max total | Total cost |');
  lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const summary of payload.summaries) {
    lines.push(`| ${summary.level} | ${summary.ok}/${summary.count} | ${(summary.wallMs / 1000).toFixed(2)}s | ${(summary.avgMs / 1000).toFixed(2)}s | ${(summary.p50Ms / 1000).toFixed(2)}s | ${(summary.p90Ms / 1000).toFixed(2)}s | ${(summary.avgTtfbMs / 1000).toFixed(2)}s | ${(summary.p90TtfbMs / 1000).toFixed(2)}s | ${(summary.minMs / 1000).toFixed(2)}s | ${(summary.maxMs / 1000).toFixed(2)}s | $${summary.totalCost.toFixed(4)} |`);
  }
  lines.push('');
  lines.push('## Category Breakdown');
  for (const summary of payload.summaries) {
    lines.push('');
    lines.push(`### Concurrency ${summary.level}`);
    lines.push('');
    lines.push('| Category | Success | Avg | P50 | P90 |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const [category, cat] of Object.entries(summary.byCat)) {
      lines.push(`| ${category} | ${cat.ok}/${cat.count} | ${(cat.avgMs / 1000).toFixed(2)}s | ${(cat.p50Ms / 1000).toFixed(2)}s | ${(cat.p90Ms / 1000).toFixed(2)}s |`);
    }
  }
  lines.push('');
  lines.push('## Failures');
  let failures = 0;
  for (const run of payload.runs) {
    for (const result of run.results) {
      if (result.ok) continue;
      failures += 1;
      lines.push(`- c${run.level} ${result.file} / ${result.category} / ${result.label}: ${result.error || 'unknown error'}`);
    }
  }
  if (!failures) lines.push('- None.');
  fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const jobs = buildJobs(args.source, args.limit);
  const outDir = path.join(ROOT, 'test-results', args.out);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Output: ${outDir}`);
  console.log(`Jobs: ${jobs.length}`);
  console.log(`Levels: ${args.levels.join(', ')}`);

  const payload = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    source: args.source,
    levels: args.levels,
    jobCount: jobs.length,
    runs: [],
    summaries: [],
  };

  for (const level of args.levels) {
    console.log(`\n== Concurrency ${level} ==`);
    const runDir = path.join(outDir, `c${level}`);
    fs.mkdirSync(path.join(runDir, 'images'), { recursive: true });
    const run = await runPool(jobs, level, runDir);
    const summary = summarizeRun(run);
    payload.runs.push(run);
    payload.summaries.push(summary);
    console.log(`c${level}: ${summary.ok}/${summary.count}, wall ${(summary.wallMs / 1000).toFixed(2)}s, avg total ${(summary.avgMs / 1000).toFixed(2)}s, p90 total ${(summary.p90Ms / 1000).toFixed(2)}s, avg ttfb ${(summary.avgTtfbMs / 1000).toFixed(2)}s`);
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(payload, null, 2));
  }

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(payload, null, 2));
  writeMarkdown(path.join(outDir, 'summary.md'), payload);
  console.log(`\nDone.`);
  console.log(`Results: ${path.join(outDir, 'results.json')}`);
  console.log(`Summary: ${path.join(outDir, 'summary.md')}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
