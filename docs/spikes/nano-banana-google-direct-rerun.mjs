#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SOURCE_DEFAULT = path.join(ROOT, 'test-results/nano-banana-lite-vs-nb2-v1/results.json');

const MODELS = [
  {
    key: 'nb2-direct',
    label: 'Nano Banana 2 Direct',
    model: 'gemini-3.1-flash-image',
    thinkingLevel: 'high',
    color: '#22c55e',
  },
  {
    key: 'lite-direct',
    label: 'Nano Banana 2 Lite Direct',
    model: 'gemini-3.1-flash-lite-image',
    thinkingLevel: 'low',
    color: '#f59e0b',
  },
];

function parseArgs(argv) {
  const args = {
    source: SOURCE_DEFAULT,
    out: 'nano-banana-google-direct-v1',
    limit: Infinity,
    finalizeOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = path.resolve(argv[++i] || args.source);
    else if (arg === '--out') args.out = argv[++i] || args.out;
    else if (arg === '--limit') args.limit = Number(argv[++i] || args.limit);
    else if (arg === '--finalize-only') args.finalizeOnly = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  node docs/spikes/nano-banana-google-direct-rerun.mjs
  node docs/spikes/nano-banana-google-direct-rerun.mjs --limit 3
  node docs/spikes/nano-banana-google-direct-rerun.mjs --out nano-banana-google-direct-v1 --finalize-only

Reuses editPrompts from an existing OpenRouter batch results.json and reruns the
same original image + same prompt through Google direct Interactions API.`);
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function extractImage(interaction) {
  for (const step of interaction.steps || []) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (part.type === 'image' && part.data) {
        return { data: part.data, mimeType: part.mime_type || 'image/jpeg' };
      }
    }
  }
  return null;
}

async function callGoogleDirect(imageBase64, prompt, model) {
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY missing');
  const body = {
    model: model.model,
    input: [
      { type: 'image', data: imageBase64, mime_type: 'image/jpeg' },
      { type: 'text', text: prompt },
    ],
    store: false,
    generation_config: {
      thinking_level: model.thinkingLevel,
    },
    response_format: {
      type: 'image',
      mime_type: 'image/jpeg',
      aspect_ratio: '1:1',
      image_size: '1K',
    },
  };
  const started = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Revision': '2026-05-20',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const elapsed = Date.now() - started;
  if (!res.ok) return { elapsed, error: `${res.status}: ${text.slice(0, 800)}` };
  const data = JSON.parse(text);
  const image = extractImage(data);
  return {
    elapsed,
    status: data.status,
    usage: data.usage || null,
    imageData: image?.data || null,
    mimeType: image?.mimeType || null,
    error: image?.data ? null : `No image returned; status=${data.status}`,
  };
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeStats(results) {
  const stats = {};
  for (const model of MODELS) stats[model.key] = { count: 0, success: 0, elapsed: [], byCat: {} };
  for (const image of results.images) {
    for (const comparison of image.comparisons) {
      for (const model of MODELS) {
        const output = comparison.outputs[model.key];
        const stat = stats[model.key];
        stat.count += 1;
        if (output?.image) stat.success += 1;
        if (output?.elapsed) stat.elapsed.push(output.elapsed);
        const cat = stat.byCat[comparison.category] ||= { count: 0, success: 0, elapsed: [] };
        cat.count += 1;
        if (output?.image) cat.success += 1;
        if (output?.elapsed) cat.elapsed.push(output.elapsed);
      }
    }
  }
  for (const stat of Object.values(stats)) {
    stat.avgMs = avg(stat.elapsed);
    stat.medianMs = median(stat.elapsed);
    stat.minMs = stat.elapsed.length ? Math.min(...stat.elapsed) : 0;
    stat.maxMs = stat.elapsed.length ? Math.max(...stat.elapsed) : 0;
    for (const cat of Object.values(stat.byCat)) {
      cat.avgMs = avg(cat.elapsed);
      cat.medianMs = median(cat.elapsed);
    }
  }
  return stats;
}

async function makeContactSheet(results, outDir) {
  const cols = 3;
  const cellW = 320;
  const cellH = 320;
  const labelH = 56;
  const gap = 12;
  const rowH = cellH + labelH;
  const width = cols * cellW + (cols + 1) * gap;
  let y = gap;
  const composites = [];
  for (const image of results.images) {
    for (const comparison of image.comparisons) {
      const files = [
        { path: path.join(outDir, comparison.originalImage), label: `${image.file} / ${comparison.category}` },
        { path: path.join(outDir, comparison.outputs['nb2-direct']?.image || ''), label: `NB2 direct ${Math.round(comparison.outputs['nb2-direct']?.elapsed || 0)}ms` },
        { path: path.join(outDir, comparison.outputs['lite-direct']?.image || ''), label: `Lite direct ${Math.round(comparison.outputs['lite-direct']?.elapsed || 0)}ms` },
      ];
      for (let col = 0; col < cols; col += 1) {
        const x = gap + col * (cellW + gap);
        const labelSvg = Buffer.from(`<svg width="${cellW}" height="${rowH}">
          <rect width="100%" height="100%" fill="#111"/>
          <text x="12" y="22" fill="#fff" font-size="16" font-family="Arial">${escapeHtml(files[col].label).slice(0, 44)}</text>
          <text x="12" y="44" fill="#aaa" font-size="13" font-family="Arial">${escapeHtml(comparison.tip.label || '')}</text>
        </svg>`);
        composites.push({ input: labelSvg, left: x, top: y });
        if (files[col].path && fs.existsSync(files[col].path) && fs.statSync(files[col].path).isFile()) {
          const imageBuffer = await sharp(files[col].path).resize(cellW, cellH, { fit: 'contain', background: '#050505' }).jpeg({ quality: 88 }).toBuffer();
          composites.push({ input: imageBuffer, left: x, top: y + labelH });
        }
      }
      y += rowH + gap;
    }
  }
  const out = path.join(outDir, 'contact-sheet.jpg');
  await sharp({
    create: { width, height: y, channels: 3, background: '#050505' },
  }).composite(composites).jpeg({ quality: 90 }).toFile(out);
  return out;
}

function writeReport(results, outDir) {
  const stats = results.stats;
  const header = MODELS.map((model) => `<th style="border-color:${model.color}">${escapeHtml(model.label)}</th>`).join('');
  const statRows = MODELS.map((model) => {
    const stat = stats[model.key];
    return `<div class="stat"><b style="color:${model.color}">${escapeHtml(model.label)}</b><br>${stat.success}/${stat.count} · avg ${(stat.avgMs / 1000).toFixed(1)}s · median ${(stat.medianMs / 1000).toFixed(1)}s</div>`;
  }).join('');
  const rows = results.images.flatMap((image, imageIndex) => image.comparisons.map((comparison) => {
    const cells = MODELS.map((model) => {
      const output = comparison.outputs[model.key];
      const body = output?.image
        ? `<img src="${escapeHtml(output.image)}">`
        : `<div class="error">${escapeHtml(output?.error || 'No image')}</div>`;
      return `<td><div class="model" style="color:${model.color}">${escapeHtml(model.label)} · ${((output?.elapsed || 0) / 1000).toFixed(1)}s</div>${body}<div class="meta">status ${escapeHtml(output?.status || '')} · thought ${escapeHtml(output?.usage?.total_thought_tokens ?? '')}</div></td>`;
    }).join('');
    return `<tr><td class="original"><b>${imageIndex + 1}. ${escapeHtml(image.file)}</b><img src="${escapeHtml(comparison.originalImage)}"><span class="badge">${escapeHtml(comparison.category)}</span><h3>${escapeHtml(comparison.tip.emoji || '')} ${escapeHtml(comparison.tip.label || '')}</h3><p>${escapeHtml(comparison.tip.desc || '')}</p><details><summary>editPrompt</summary><pre>${escapeHtml(comparison.tip.editPrompt || '')}</pre></details></td>${cells}</tr>`;
  })).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Google Direct Nano Banana Compare</title><style>
body{margin:0;background:#090909;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
.stats{display:flex;gap:16px;margin:16px 0 24px}.stat{background:#151515;border:1px solid #333;border-radius:10px;padding:12px 16px}
table{width:100%;border-collapse:separate;border-spacing:0 18px}th{text-align:left;padding:10px;border-bottom:2px solid #333;position:sticky;top:0;background:#090909}
td{vertical-align:top;background:#151515;border:1px solid #2a2a2a;padding:12px;width:28%}td.original{width:16%;background:#101010}
img{width:100%;max-height:420px;object-fit:contain;background:#050505;border-radius:8px;display:block}.model{font-weight:700;margin-bottom:8px}.meta{font-size:11px;color:#777;margin-top:8px}
.badge{display:inline-block;margin-top:10px;background:#333;border-radius:999px;padding:3px 8px;font-size:12px}h3{font-size:15px;margin:10px 0 4px}p{font-size:13px;color:#bbb}
pre{white-space:pre-wrap;font-size:11px;color:#aaa}.error{min-height:220px;display:flex;align-items:center;justify-content:center;color:#f87171;background:#1f1111;border-radius:8px;padding:16px}
</style></head><body><h1>Google Direct Interactions: NB2 vs Lite</h1><p>Same source prompts from ${escapeHtml(results.source)} · ${escapeHtml(results.timestamp)}</p><div class="stats">${statRows}</div><table><thead><tr><th>Original / Prompt</th>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  fs.writeFileSync(path.join(outDir, 'report.html'), html);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();
  const source = JSON.parse(fs.readFileSync(args.source, 'utf8'));
  const sourceDir = path.dirname(args.source);
  const outDir = path.join(ROOT, 'test-results', args.out);
  const imageDir = path.join(outDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });

  if (args.finalizeOnly) {
    const existingPath = path.join(outDir, 'results.json');
    const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    existing.stats = computeStats(existing);
    fs.writeFileSync(existingPath, JSON.stringify(existing, null, 2));
    writeReport(existing, outDir);
    const contactSheet = await makeContactSheet(existing, outDir);
    console.log(`Finalized existing results.`);
    console.log(`Results: ${existingPath}`);
    console.log(`Report: ${path.join(outDir, 'report.html')}`);
    console.log(`Contact sheet: ${contactSheet}`);
    for (const model of MODELS) {
      const stat = existing.stats[model.key];
      console.log(`${model.key}: ${stat.success}/${stat.count}, avg ${(stat.avgMs / 1000).toFixed(1)}s, median ${(stat.medianMs / 1000).toFixed(1)}s`);
    }
    return;
  }

  const results = {
    timestamp: new Date().toISOString(),
    source: args.source,
    models: MODELS,
    images: [],
  };

  let comparisonCount = 0;
  outer:
  for (const sourceImage of source.images) {
    const image = { file: sourceImage.file, comparisons: [] };
    for (const sourceComparison of sourceImage.comparisons) {
      if (comparisonCount >= args.limit) break outer;
      const originalSource = path.join(sourceDir, sourceComparison.originalImage);
      const originalRel = `images/${comparisonCount}_original.jpg`;
      fs.copyFileSync(originalSource, path.join(outDir, originalRel));
      const imageBase64 = fs.readFileSync(originalSource).toString('base64');
      const comparison = {
        category: sourceComparison.category,
        tip: sourceComparison.tip,
        originalImage: originalRel,
        outputs: {},
      };
      console.log(`\n[${comparisonCount + 1}] ${sourceImage.file} / ${sourceComparison.category} / ${sourceComparison.tip.label}`);
      await Promise.all(MODELS.map(async (model) => {
        console.log(`  ${model.key}: ${model.model} (${model.thinkingLevel})`);
        const output = await callGoogleDirect(imageBase64, sourceComparison.tip.editPrompt, model);
        if (output.imageData) {
          const filename = `images/${comparisonCount}_${sourceComparison.category}_${model.key}.jpg`;
          fs.writeFileSync(path.join(outDir, filename), Buffer.from(output.imageData, 'base64'));
          output.image = filename;
        }
        delete output.imageData;
        comparison.outputs[model.key] = output;
        console.log(`  ${model.key}: ${output.image ? 'ok' : 'fail'} ${output.status || ''} (${(output.elapsed / 1000).toFixed(1)}s)`);
      }));
      image.comparisons.push(comparison);
      comparisonCount += 1;
      fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    }
    if (image.comparisons.length) results.images.push(image);
  }

  results.stats = computeStats(results);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  writeReport(results, outDir);
  const contactSheet = await makeContactSheet(results, outDir);
  console.log(`\nDone.`);
  console.log(`Results: ${path.join(outDir, 'results.json')}`);
  console.log(`Report: ${path.join(outDir, 'report.html')}`);
  console.log(`Contact sheet: ${contactSheet}`);
  for (const model of MODELS) {
    const stat = results.stats[model.key];
    console.log(`${model.key}: ${stat.success}/${stat.count}, avg ${(stat.avgMs / 1000).toFixed(1)}s, median ${(stat.medianMs / 1000).toFixed(1)}s`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
