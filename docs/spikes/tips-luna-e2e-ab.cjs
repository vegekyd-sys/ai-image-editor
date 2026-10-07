// Same production Tips prompt/parser, two text authors, one fixed 2.1 image backend.
// node --env-file=<production-env> --import tsx --require ./md-loader.cjs docs/spikes/tips-luna-e2e-ab.cjs
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '../..');
const productionRoot = '/Users/tianyicai/ai-image-editor';
const frozen = '/Users/tianyicai/ai-image-editor-tips-wan27-ab/test-results/v1/images';
const out = path.join(root, 'test-results/tips-luna-e2e-v1');
const models = { online: 'google/' + (process.env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview'), luna: 'openai/gpt-6-luna' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const json = (file, value) => fs.writeFile(file + '.next', JSON.stringify(value, null, 2)).then(() => fs.rename(file + '.next', file));
const terminal = state => !['pending', 'submitted'].includes(state);
function serialSave(file, value) {
  let queue = Promise.resolve();
  return () => { const snapshot = JSON.parse(JSON.stringify(value)); queue = queue.then(() => json(file, snapshot)); return queue; };
}
async function pool(items, concurrency, fn) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (index < items.length) await fn(items[index++]); }));
}
async function textWorker(author) {
  process.env.AI_PROVIDER = 'openrouter'; process.env.TIPS_PROVIDER = 'openrouter'; delete process.env.GOOGLE_API_KEY;
  const { streamTipsByCategory } = require(path.join(productionRoot, 'src/lib/gemini.ts'));
  await fs.mkdir(out, { recursive: true });
  const file = path.join(out, author + '.json'); let record;
  try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; record = { author, model: models[author], rows: [0,1,2,3,4].flatMap(imageIndex => ['creative','wild'].map(category => ({ id: `image-${imageIndex}-${category}`, imageIndex, category, locale: 'zh', state: 'pending', tips: [], requests: [] }))) }; }
  const save = serialSave(file, record), scope = new AsyncLocalStorage(), realFetch = global.fetch;
  global.fetch = async (url, options) => {
    const row = scope.getStore(); if (!row) return realFetch(url, options);
    if (!String(url).endsWith('/chat/completions')) throw Error('Unexpected provider URL');
    if (row.requests.length >= 3) throw Error('Additional request beyond the existing two-tip repair limit suppressed');
    const body = JSON.parse(options.body); body.model = models[author];
    const request = { phase: body.stream ? 'initial' : 'editPrompt-repair', model: body.model, stream: !!body.stream, reasoning: body.reasoning,
      promptHash: sha(JSON.stringify(body.messages.map(m => ({...m, content: Array.isArray(m.content) ? m.content.filter(c => c.type === 'text') : m.content})))),
      startedAt: new Date().toISOString(), state: 'submitted' };
    row.requests.push(request); await save(); const t = Date.now();
    const response = await realFetch(url, { ...options, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    request.headersMs = Date.now() - t; request.httpStatus = response.status;
    row._captures = row._captures || [];
    row._captures.push((async () => {
      const payload = await response.clone().text();
      const chunks = body.stream ? payload.split('\n').filter(l => l.startsWith('data: ') && l.slice(6).trim() !== '[DONE]').map(l => { try{return JSON.parse(l.slice(6));}catch{return null;} }).filter(Boolean) : [JSON.parse(payload)];
      for (const chunk of chunks) {
        if (chunk.id) request.requestId = chunk.id;
        if (chunk.model) request.responseModel = chunk.model;
        if (chunk.usage) request.usage = chunk.usage;
        if (chunk.error) request.error = chunk.error;
        const c = chunk.choices?.[0];
        if (c?.finish_reason) request.finishReason = c.finish_reason;
        if (c?.delta?.content) request.rawText = (request.rawText || '') + c.delta.content;
        if (c?.message?.content) request.rawText = c.message.content;
      }
      request.totalMs = Date.now() - t; request.state = request.error || !response.ok ? 'error' : 'completed';
    })());
    return response;
  };
  await pool(record.rows.filter(r => r.state === 'pending'), 2, async row => scope.run(row, async () => {
    const input = await fs.readFile(path.join(frozen, row.imageIndex + '-original.jpg'));
    row.inputHash = sha(input); row.state = 'submitted'; row.startedAt = new Date().toISOString(); await save(); const t = Date.now();
    try {
      const usage = { inputTokens: 0, outputTokens: 0, model: '' };
      for await (const tip of streamTipsByCategory('data:image/jpeg;base64,' + input.toString('base64'), row.category, undefined, 2, undefined, 'zh', undefined, usage)) {
        if (!row.firstVisibleTipMs) row.firstVisibleTipMs = Date.now() - t;
        if (tip.editPrompt) {
          if (!row.firstReadyTipMs) row.firstReadyTipMs = Date.now() - t;
          const index = row.tips.findIndex(old => old.label === tip.label);
          if (index < 0) row.tips.push({ ...tip, readyMs: Date.now() - t }); else row.tips[index] = { ...tip, readyMs: Date.now() - t };
        }
      }
      row.productUsage = usage;
      row.state = row.tips.length === 2 && row.tips.every(t => t.label && t.desc && t.editPrompt && t.category === row.category) ? 'success' : 'incomplete';
    } catch (e) { row.state = 'error'; row.error = e.message; }
    if (row._captures) await Promise.allSettled(row._captures);
    delete row._captures; row.totalMs = Date.now() - t;
    row.costUsd = row.requests.reduce((s, r) => s + (r.usage?.cost || 0), 0);
    row.costMissing = row.requests.filter(r => !Number.isFinite(r.usage?.cost)).length;
    await save(); console.log(JSON.stringify({ author, id: row.id, state: row.state, tips: row.tips.length, totalMs: row.totalMs, firstReadyTipMs: row.firstReadyTipMs, requests: row.requests.length, costUsd: row.costUsd }));
  }));
  await save();
}
async function main() {
  if (process.argv[2] === '--worker') return textWorker(process.argv[3]);
  await fs.mkdir(path.join(out, 'images'), { recursive: true });
  try { await fs.access(path.join(out, 'protocol.json')); }
  catch {
    const productionPromptFiles = ['gemini.ts','prompts/creative.md','prompts/wild.md','tips-response-policy.ts'];
    const promptFiles = {};
    for (const f of productionPromptFiles) promptFiles[f] = sha(await fs.readFile(path.join(productionRoot, 'src/lib', f)));
    await json(path.join(out, 'protocol.json'), { createdAt: new Date().toISOString(), models, textProvider: 'OpenRouter both authors', source: 'current production Tips source and language rules', promptFiles,
      count: 2, imageCount: 5, categories: ['creative','wild'], locale: 'zh', textConcurrency: 4, imageConcurrency: 4, reasoning: 'production category defaults, high for both Creative/Wild',
      repairs: 'existing product editPrompt repair allowed, at most 2 per text request; charged and timed', crossProviderFallback: false, imageModel: 'google/gemini-nano-banana-2.1', resolution: '1K', paidImageRetry: false,
      resume: 'submitted unknown outcomes are never resubmitted automatically', comparison: 'tip ordinal pairs, not the same idea; author creativity is intentionally allowed to differ' });
    const catalog = await (await fetch('https://openrouter.ai/api/v1/models')).json();
    await json(path.join(out, 'prices.json'), { fetchedAt: new Date().toISOString(), models: catalog.data.filter(m => [...Object.values(models),'google/gemini-nano-banana-2.1'].includes(m.id)).map(m => ({ id: m.id, pricing: m.pricing })) });
  }
  await Promise.all(Object.keys(models).map(author => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import','tsx','--require',path.join(root,'md-loader.cjs'),__filename,'--worker',author], { cwd: root, env: process.env, stdio: 'inherit' });
    child.on('exit', code => code === 0 ? resolve() : reject(Error(author + ' worker exited ' + code)));
  })));
  const authors = {};
  for (const author of Object.keys(models)) authors[author] = JSON.parse(await fs.readFile(path.join(out, author + '.json'), 'utf8'));
  const file = path.join(out, 'images.json'); let record;
  try { record = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; record = { rows: [] }; for (let i = 0; i < 5; i++) for (const category of ['creative','wild']) for (let tipIndex = 0; tipIndex < 2; tipIndex++) for (const author of ['online','luna']) {
    const text = authors[author].rows.find(r => r.imageIndex === i && r.category === category), tip = text.tips[tipIndex];
    record.rows.push({ id: `image-${i}-${category}-${tipIndex+1}-${author}`, imageIndex: i, category, tipIndex, author, tip, textReadyMs: tip?.readyMs,
      state: tip?.editPrompt ? 'pending' : 'missing-tip', textState: text.state });
  } }
  const save = serialSave(file, record);
  const { nanoBanana21Backend } = require('../../src/lib/models/nano-banana-21.ts');
  const sharp = require('sharp');
  for (let i = 0; i < 5; i++) await fs.copyFile(path.join(frozen, i + '-original.jpg'), path.join(out, 'images', i + '-original.jpg'));
  await pool(record.rows.filter(r => r.state === 'pending'), 4, async row => {
    row.state = 'submitted'; row.startedAt = new Date().toISOString(); await save(); const t = Date.now();
    try {
      const source = await fs.readFile(path.join(out, 'images', row.imageIndex + '-original.jpg'));
      const result = await nanoBanana21Backend.generate({ image: 'data:image/jpeg;base64,'+source.toString('base64'), prompt: row.tip.editPrompt, imageResolution: '1K', aspectRatio: row.tip.aspectRatio });
      if (!result.image) throw Error('No completed image');
      const bytes = Buffer.from(result.image.split(',')[1], 'base64'), meta = await sharp(bytes).metadata();
      row.image = 'images/' + row.id + '.jpg'; await sharp(bytes).jpeg({quality:94}).toFile(path.join(out, row.image));
      row.width = meta.width; row.height = meta.height; row.usage = result.usage; row.costUsd = result.usage?.providerCostUsd; row.state = 'success';
    } catch (e) { row.state = 'error'; row.error = e.message; }
    row.totalMs = Date.now()-t; row.endToEndReadyMs = row.textReadyMs ? row.textReadyMs + row.totalMs : undefined;
    await save(); console.log(JSON.stringify({ id: row.id, state: row.state, imageMs: row.totalMs, endToEndReadyMs: row.endToEndReadyMs, costUsd: row.costUsd }));
  });
  await save();
  const avg = values => values.length ? values.reduce((s,v)=>s+v,0)/values.length : null;
  const summary = { protocol: JSON.parse(await fs.readFile(path.join(out,'protocol.json'),'utf8')), authors: {} };
  for (const author of Object.keys(models)) {
    const text = authors[author].rows, images = record.rows.filter(r=>r.author===author), success = images.filter(r=>r.state==='success');
    summary.authors[author] = { textRequests: text.reduce((s,r)=>s+r.requests.length,0), textCells: text.length, textComplete: text.filter(r=>r.state==='success').length,
      textCostUsd: text.reduce((s,r)=>s+r.costUsd,0), textMsMean: avg(text.map(r=>r.totalMs)), firstReadyTipMsMean: avg(text.filter(r=>r.firstReadyTipMs).map(r=>r.firstReadyTipMs)),
      expectedImages: images.length, imageSuccess: success.length, imageCostUsd: images.reduce((s,r)=>s+(r.costUsd||0),0), imageMsMean: avg(success.map(r=>r.totalMs)),
      textPlusImageReadyMsMean: avg(success.map(r=>r.endToEndReadyMs)), allStatesTerminal: [...text,...images].every(r=>terminal(r.state)),
      readyLatencyNote: 'text ready + image generation, excludes batch scheduler queue; images actually submitted after all text cells finish' };
  }
  await json(path.join(out,'summary.json'), summary); console.log(JSON.stringify(summary.authors));
}
// Imported provider SDKs retain idle timers. All captures and receipts are awaited above.
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
