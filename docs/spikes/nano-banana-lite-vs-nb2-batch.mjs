#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MAIN_ROOT = '/Users/tianyicai/ai-image-editor';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS = [
  {
    key: 'nb2',
    label: 'Nano Banana 2',
    model: 'google/gemini-3.1-flash-image',
    color: '#22c55e',
    reasoning: 'minimal',
  },
  {
    key: 'lite',
    label: 'Nano Banana 2 Lite',
    model: 'google/gemini-3.1-flash-lite-image',
    color: '#f59e0b',
    reasoning: 'low',
  },
];

const CATEGORIES = ['enhance', 'creative', 'wild'];
const CATEGORY_LABELS = {
  enhance: 'Enhance',
  creative: 'Creative',
  wild: 'Wild',
};

function parseArgs(argv) {
  const args = {
    count: 5,
    images: null,
    seed: 'nano-lite-vs-nb2-2026-07-02',
    tipsModel: process.env.TIPS_MODEL || 'google/gemini-3.1-flash-image',
    outName: null,
    skipTips: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--count') args.count = Number(argv[++i] || args.count);
    else if (arg === '--images') args.images = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--seed') args.seed = argv[++i] || args.seed;
    else if (arg === '--tips-model') args.tipsModel = argv[++i] || args.tipsModel;
    else if (arg === '--out') args.outName = argv[++i] || args.outName;
    else if (arg === '--skip-tips') args.skipTips = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Nano Banana 2 vs Lite batch compare

Usage:
  node docs/spikes/nano-banana-lite-vs-nb2-batch.mjs
  node docs/spikes/nano-banana-lite-vs-nb2-batch.mjs --count 3
  node docs/spikes/nano-banana-lite-vs-nb2-batch.mjs --images IMG_8149.JPG,child-stairs.jpg

This generates one shared editPrompt per image/category, then runs the same prompt
through Nano Banana 2 and Nano Banana 2 Lite via OpenRouter.
`);
}

function loadEnv() {
  const candidates = [
    path.join(ROOT, '.env.local'),
    path.join(MAIN_ROOT, '.env.local'),
  ];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value;
  }
  console.log(`Loaded env from ${envPath}`);
}

function seededRandom(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += h << 13; h ^= h >>> 7;
    h += h << 3; h ^= h >>> 17;
    h += h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

function pickFiles(testcaseDir, args) {
  const files = fs.readdirSync(testcaseDir).filter((file) => /\.(png|jpe?g|heic|webp)$/i.test(file));
  if (args.images?.length) {
    const selected = args.images.filter((file) => files.includes(file));
    if (!selected.length) throw new Error(`None of --images found in ${testcaseDir}`);
    return selected;
  }
  const rand = seededRandom(args.seed);
  return [...files].sort(() => rand() - 0.5).slice(0, Math.min(args.count, files.length));
}

async function loadImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let inputPath = filePath;
  let cleanupPath = null;
  if (ext === '.heic') {
    cleanupPath = `${filePath}.tmp-batch.jpg`;
    execFileSync('sips', ['-s', 'format', 'jpeg', filePath, '--out', cleanupPath, '-s', 'formatOptions', '85'], { stdio: 'ignore' });
    inputPath = cleanupPath;
  }
  try {
    const buffer = await sharp(inputPath)
      .rotate()
      .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
    return {
      buffer,
      base64: buffer.toString('base64'),
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      mimeType: 'image/jpeg',
    };
  } finally {
    if (cleanupPath && fs.existsSync(cleanupPath)) fs.unlinkSync(cleanupPath);
  }
}

function openrouterHeaders() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://www.makaron.app',
    'X-Title': 'Makaron Nano Banana Lite Batch Review',
  };
}

function readPrompt(category) {
  return fs.readFileSync(path.join(ROOT, 'src/lib/prompts', `${category}.md`), 'utf8');
}

const JSON_FORMAT_SUFFIX = `

Output one JSON object only, no markdown:
{"emoji":"one emoji","label":"2-4 Chinese words","desc":"Chinese description under 20 chars","editPrompt":"Detailed English editing prompt. Must preserve identity and composition unless the category explicitly requires transformation.","category":"enhance|creative|wild"}`;

function buildTipPrompt(category) {
  const template = readPrompt(category);
  const analysis = category === 'enhance'
    ? 'Focus on professional photographic enhancement that preserves the scene and all people.'
    : 'First reason about the concrete objects, mood, and story opportunities in this specific image.';
  return `${analysis}

Generate exactly one ${category} editing suggestion for this image.
The editPrompt is the only instruction the image model will see, so include all necessary preservation and placement details in it.

Rules:
${template}
${JSON_FORMAT_SUFFIX}`;
}

async function generateSharedTip(image, category, tipsModel) {
  const system = `Photo editing expert. Generate exactly one ${category} tip. The editPrompt must be English, concrete, and executable by an image-editing model.`;
  const body = {
    model: tipsModel,
    stream: false,
    reasoning: { effort: category === 'enhance' ? 'minimal' : 'high' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image.dataUrl } },
          { type: 'text', text: buildTipPrompt(category) },
        ],
      },
    ],
  };
  const started = Date.now();
  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Tip ${category} failed ${res.status}: ${text.slice(0, 600)}`);
  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON tip for ${category}: ${content.slice(0, 300)}`);
  const tip = JSON.parse(match[0]);
  tip.category = category;
  return {
    ...tip,
    tipsTimeMs: Date.now() - started,
    tipsUsage: data.usage || null,
    tipsModel: data.model || tipsModel,
  };
}

async function editWithModel(image, tip, model) {
  const body = {
    model: model.model,
    stream: false,
    modalities: ['image', 'text'],
    temperature: 1,
    reasoning: { effort: model.reasoning },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image.dataUrl } },
          { type: 'text', text: tip.editPrompt },
        ],
      },
    ],
  };
  const started = Date.now();
  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const elapsed = Date.now() - started;
  if (!res.ok) {
    return { error: `${res.status}: ${text.slice(0, 700)}`, elapsed };
  }
  const data = JSON.parse(text);
  const message = data.choices?.[0]?.message;
  const imageUrl = message?.images?.[0]?.image_url?.url || message?.images?.[0]?.url || null;
  return {
    imageUrl,
    text: message?.content || '',
    elapsed,
    usage: data.usage || null,
    resolvedModel: data.model || model.model,
  };
}

function saveDataUrlImage(dataUrl, outPath) {
  const match = dataUrl?.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return false;
  fs.writeFileSync(outPath, Buffer.from(match[2], 'base64'));
  return true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function makeContactSheet(results, outDir) {
  const rows = [];
  const cellW = 320;
  const cellH = 320;
  const labelH = 56;
  const gap = 12;
  const rowH = cellH + labelH;
  const cols = 3;
  const width = cols * cellW + (cols + 1) * gap;
  const composites = [];
  let y = gap;

  const font = 'Arial';
  for (const imageResult of results.images) {
    for (const comparison of imageResult.comparisons) {
      const files = [
        { path: path.join(outDir, comparison.originalImage), label: `${imageResult.file} / ${comparison.category}` },
        { path: path.join(outDir, comparison.outputs.nb2?.image || ''), label: `NB2 ${Math.round(comparison.outputs.nb2?.elapsed || 0)}ms` },
        { path: path.join(outDir, comparison.outputs.lite?.image || ''), label: `Lite ${Math.round(comparison.outputs.lite?.elapsed || 0)}ms` },
      ];
      for (let col = 0; col < cols; col += 1) {
        const x = gap + col * (cellW + gap);
        const bg = Buffer.from(`<svg width="${cellW}" height="${rowH}">
          <rect width="100%" height="100%" fill="#111"/>
          <text x="12" y="22" fill="#fff" font-size="16" font-family="${font}">${escapeHtml(files[col].label).slice(0, 42)}</text>
          <text x="12" y="44" fill="#aaa" font-size="13" font-family="${font}">${escapeHtml(comparison.tip.label || '')}</text>
        </svg>`);
        composites.push({ input: bg, left: x, top: y });
        if (fs.existsSync(files[col].path)) {
          const img = await sharp(files[col].path)
            .resize(cellW, cellH, { fit: 'contain', background: '#050505' })
            .jpeg({ quality: 88 })
            .toBuffer();
          composites.push({ input: img, left: x, top: y + labelH });
        }
      }
      rows.push(comparison);
      y += rowH + gap;
    }
  }

  const height = Math.max(y, 1);
  const output = path.join(outDir, 'contact-sheet.jpg');
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#050505',
    },
  }).composite(composites).jpeg({ quality: 90 }).toFile(output);
  return output;
}

function writeHtml(results, outDir) {
  const modelHeaders = MODELS.map((model) => `<th style="border-color:${model.color}">${escapeHtml(model.label)}</th>`).join('');
  const rows = results.images.flatMap((imageResult, imageIndex) => imageResult.comparisons.map((comparison) => {
    const cells = MODELS.map((model) => {
      const output = comparison.outputs[model.key];
      const image = output?.image ? `<img src="${escapeHtml(output.image)}" alt="${model.key}">` : `<div class="error">${escapeHtml(output?.error || 'No image')}</div>`;
      return `<td>
        <div class="model-name" style="color:${model.color}">${escapeHtml(model.label)} · ${((output?.elapsed || 0) / 1000).toFixed(1)}s</div>
        ${image}
        <div class="meta">cost ${escapeHtml(output?.usage?.cost ?? '')} · ${escapeHtml(output?.resolvedModel || model.model)}</div>
      </td>`;
    }).join('');
    return `<tr>
      <td class="original">
        <div class="file">${imageIndex + 1}. ${escapeHtml(imageResult.file)}</div>
        <img src="${escapeHtml(comparison.originalImage)}" alt="original">
        <div class="badge ${comparison.category}">${escapeHtml(CATEGORY_LABELS[comparison.category])}</div>
        <h3>${escapeHtml(comparison.tip.emoji || '')} ${escapeHtml(comparison.tip.label || '')}</h3>
        <p>${escapeHtml(comparison.tip.desc || '')}</p>
        <details><summary>editPrompt</summary><pre>${escapeHtml(comparison.tip.editPrompt || '')}</pre></details>
      </td>
      ${cells}
    </tr>`;
  })).join('\n');

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nano Banana 2 vs Lite Batch Review</title>
<style>
body{margin:0;background:#090909;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}
h1{margin:0 0 8px;font-size:24px}.sub{color:#aaa;margin-bottom:20px}
table{width:100%;border-collapse:separate;border-spacing:0 18px}
th{text-align:left;padding:10px 12px;border-bottom:2px solid #333;position:sticky;top:0;background:#090909;z-index:2}
td{vertical-align:top;background:#151515;border:1px solid #2a2a2a;padding:12px;width:28%}
td.original{width:16%;background:#101010}
img{width:100%;max-height:420px;object-fit:contain;background:#050505;border-radius:8px;display:block}
.file{font-weight:700;margin-bottom:8px;color:#ddd}.badge{display:inline-block;margin-top:10px;padding:3px 8px;border-radius:999px;font-size:12px;font-weight:700}
.enhance{background:#4c1d95}.creative{background:#9d174d}.wild{background:#991b1b}
h3{font-size:15px;margin:10px 0 4px}p{font-size:13px;color:#bbb;margin:0 0 8px}
summary{font-size:12px;color:#aaa;cursor:pointer}pre{white-space:pre-wrap;font-size:11px;color:#aaa;line-height:1.35;max-height:240px;overflow:auto}
.model-name{font-weight:700;margin-bottom:8px}.meta{font-size:11px;color:#777;margin-top:8px;line-height:1.35;word-break:break-all}
.error{min-height:220px;display:flex;align-items:center;justify-content:center;color:#f87171;background:#1f1111;border-radius:8px;padding:16px}
</style>
</head>
<body>
<h1>Nano Banana 2 vs Nano Banana 2 Lite</h1>
<div class="sub">Same original image + same editPrompt. Tips generated once with ${escapeHtml(results.tipsModel)}. Generated ${escapeHtml(results.timestamp)}.</div>
<table>
<thead><tr><th>Original / Shared Prompt</th>${modelHeaders}</tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, 'report.html'), html);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const testcaseDir = fs.existsSync(path.join(ROOT, 'testcase'))
    ? path.join(ROOT, 'testcase')
    : path.join(MAIN_ROOT, 'testcase');
  const selectedFiles = pickFiles(testcaseDir, args);
  const resultsRoot = path.join(ROOT, 'test-results');
  fs.mkdirSync(resultsRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(resultsRoot, args.outName || `nano-banana-lite-vs-nb2-${stamp}`);
  const imageDir = path.join(outDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });

  console.log(`Output: ${outDir}`);
  console.log(`Tips model: ${args.tipsModel}`);
  console.log(`Images: ${selectedFiles.join(', ')}`);

  const results = {
    timestamp: new Date().toISOString(),
    testcaseDir,
    tipsModel: args.tipsModel,
    models: MODELS,
    categories: CATEGORIES,
    selectedFiles,
    images: [],
  };

  for (let imageIndex = 0; imageIndex < selectedFiles.length; imageIndex += 1) {
    const file = selectedFiles[imageIndex];
    console.log(`\n[${imageIndex + 1}/${selectedFiles.length}] ${file}`);
    const image = await loadImage(path.join(testcaseDir, file));
    const originalRel = `images/${imageIndex}_original.jpg`;
    fs.writeFileSync(path.join(outDir, originalRel), image.buffer);
    const imageResult = { file, originalImage: originalRel, comparisons: [] };

    for (const category of CATEGORIES) {
      console.log(`  ${category}: generating shared tip...`);
      const tip = await generateSharedTip(image, category, args.tipsModel);
      console.log(`    tip: ${tip.emoji || ''} ${tip.label || ''} (${(tip.tipsTimeMs / 1000).toFixed(1)}s)`);
      const comparison = { category, tip, originalImage: originalRel, outputs: {} };

      await Promise.all(MODELS.map(async (model) => {
        console.log(`    ${model.key}: editing...`);
        const output = await editWithModel(image, tip, model);
        if (output.imageUrl) {
          const filename = `images/${imageIndex}_${category}_${model.key}.jpg`;
          const saved = saveDataUrlImage(output.imageUrl, path.join(outDir, filename));
          output.image = saved ? filename : null;
          delete output.imageUrl;
        }
        comparison.outputs[model.key] = output;
        console.log(`    ${model.key}: ${output.image ? 'ok' : 'fail'} (${(output.elapsed / 1000).toFixed(1)}s)`);
      }));

      imageResult.comparisons.push(comparison);
    }
    results.images.push(imageResult);
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  }

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  writeHtml(results, outDir);
  const contactSheet = await makeContactSheet(results, outDir);

  console.log(`\nDone.`);
  console.log(`Results: ${path.join(outDir, 'results.json')}`);
  console.log(`Report: ${path.join(outDir, 'report.html')}`);
  console.log(`Contact sheet: ${contactSheet}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
