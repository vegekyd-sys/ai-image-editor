// Run from the repository root, using the project's tsx and markdown loaders.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const sharp = require('sharp');
const { chromium } = require('playwright');
const { NextRequest } = require('next/server');
const { POST: mcp } = require('../../src/app/api/mcp/route');
const { POST: project } = require('../../src/app/api/projects/create/route');
const { getSupabaseAdmin } = require('../../src/lib/supabase/service');
const { image26UsageCostUsd } = require('../../src/lib/openai-direct');
const fal = require('./fal.cjs');
const { observe } = require('./telemetry.cjs');

const prompts = {
  generate:
    '给我画张方形早起提醒卡。奶油色背景，远处青绿色小山和一轮橙色太阳，中央一台珊瑚橙色复古数字闹钟，蓝色顶钮，钟面准确显示“07:30”，底部深青色横条上只写“EARLY BIRD”。平面海报，主体和文字都要清楚。',
  edit: '只把闹钟顶部的蓝色按钮改成明黄色。保持闹钟外形、原有构图、所有其他颜色、时间“07:30”和底部“EARLY BIRD”文字原样。',
};
const ids = { nano: 'gemini-2.1', flare: 'gpt-image-2.6-flare' };
const out = path.resolve(process.argv[2] || '.tmp/h3-test');
const digest = (b) => crypto.createHash('sha256').update(b).digest('hex');
const save = (name, obj) => {
  const target = path.join(out, name);
  fs.writeFileSync(target + '.new', JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(target + '.new', target);
};
const load = (name) => JSON.parse(fs.readFileSync(path.join(out, name)));
const asData = (b, type) => 'data:image/' + type + ';base64,' + b.toString('base64');
const key =
  process.env.MAKARON_API_KEY ||
  JSON.parse(fs.readFileSync(path.join(os.homedir(), '.makaron/auth.json')))._apiKey;
const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
async function projectRequest(body) {
  const r = await project(
    new NextRequest('http://localhost/api/projects/create', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
  if (!r.ok) throw Error('Project HTTP ' + r.status);
  return r.json();
}

async function baseline(model, op, source, name, row) {
  const server = http.createServer(async (req, res) => {
    try {
      if (
        req.url !== '/api/mcp' ||
        req.method !== 'POST' ||
        req.headers.authorization !== headers.authorization
      )
        throw Error('Unexpected CLI request');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const msg = JSON.parse(body);
      if (
        msg.params?.name !== 'makaron_edit_image' ||
        msg.params.arguments.model !== ids[model] ||
        msg.params.arguments.editPrompt !== prompts[op]
      )
        throw Error('Unexpected CLI tool');
      const r = await mcp(
        new Request('http://localhost/api/mcp', { method: 'POST', headers: req.headers, body }),
      );
      row.credits = r.headers.has('x-credits-charged') ? Number(r.headers.get('x-credits-charged')) : null;
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end('Local MCP bridge failed');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const args = [
      'packages/makaron-cli/bin/makaron.mjs',
      'edit',
      '--image-model',
      ids[model],
      '--aspect',
      '1:1',
      '--image-resolution',
      '1K',
    ];
    if (op === 'edit') args.push('--image', source);
    args.push('--out', path.join(out, name + '.png'), prompts[op]);
    const childEnv = {
      PATH: process.env.PATH,
      HOME: os.homedir(),
      MAKARON_URL: 'http://127.0.0.1:' + server.address().port,
      MAKARON_API_KEY: key,
    };
    await exec(process.execPath, args, { env: childEnv, timeout: 310000 });
    const file = fs
      .readdirSync(out)
      .find((f) => f.startsWith(name + '.') && /\.(png|jpg|jpeg|webp)$/.test(f));
    return fs.readFileSync(path.join(out, file));
  } catch (error) {
    throw Error(
      String(error.stderr || error.message)
        .replace(/https?:\/\/\S+|mk_live_\S+/g, '[redacted]')
        .slice(0, 800),
    );
  } finally {
    server.close();
  }
}
async function main() {
  if (!process.argv.includes('--paid'))
    throw Error('Pass a run directory and --paid to execute the fixed paid matrix.');
  fs.mkdirSync(out, { recursive: true });
  const source = path.join(out, 'source.png');
  if (!fs.existsSync(source)) fs.copyFileSync(path.join(__dirname, 'evidence', 'source.png'), source);
  const sourceBytes = fs.readFileSync(source);
  const sourceData = asData(sourceBytes, 'png');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.setContent('<img width="512" height="512" alt="Benchmark result">');
    const existingQuote = fs.existsSync(path.join(out, 'prices.json')) ? load('prices.json') : null;
    const prices = existingQuote?.prices ?? {};
    const flarePrices = existingQuote?.flarePrices ?? {};
    if (existingQuote) {
      if (
        existingQuote.inputSha256 !== digest(sourceBytes) ||
        JSON.stringify(existingQuote.prompts) !== JSON.stringify(prompts)
      )
        throw Error('Run inputs changed');
    } else {
      for (const op of ['generate', 'edit']) {
        prices[op] = await fal.quote(fal.endpointFor(op === 'edit'));
        flarePrices[op] = await fal.quote(
          'openai/gpt-image-2.6/flare/' + (op === 'edit' ? op : 'text-to-image'),
        );
      }
      save('prices.json', { prices, flarePrices, prompts, inputSha256: digest(sourceBytes) });
    }
    if (!fs.existsSync(path.join(out, 'project.private.json')))
      save('project.private.json', { id: crypto.randomUUID() });
    const projectId = load('project.private.json').id;
    await projectRequest({
      clientProjectId: projectId,
      idempotencyKey: projectId,
      title: 'H3 Highspeed · isolated 1K benchmark',
    });
    // Rotate supplier order each round. All six cells have three independent planned samples.
    const plan = [];
    const models = ['h3', 'nano', 'flare'];
    for (let round = 0; round < 3; round++) {
      for (const op of ['generate', 'edit']) {
        for (let offset = 0; offset < models.length; offset++) {
          const model = models[(round + offset) % models.length];
          plan.push({ name: [round + 1, op, model].join('-'), model, op });
        }
      }
    }
    const contractCheck = process.argv.includes('--edit-contract-check');
    const documentedEdits = ['schema-edit-h3', 'schema2-edit-h3', 'schema3-edit-h3'].map((name) => ({
      name,
      model: 'h3',
      op: 'edit',
    }));
    const selected = contractCheck ? documentedEdits : plan;
    const previous = fs
      .readdirSync(out)
      .filter((f) => /^(?:[1-3]-(generate|edit)-(h3|nano|flare)|schema[23]?-edit-h3|alpha)\.json$/.test(f))
      .map(load);
    let reserved = previous.reduce((total, sample) => total + (sample.costUsd ?? 0.5), 0);
    let failures = previous.filter((sample) => !['verified', 'complete'].includes(sample.state)).length;
    for (const { name, model, op } of selected) {
      const filename = name + '.json';
      const row = { name, model, op, calls: [], state: 'started', startedAt: new Date().toISOString() };
      if (fs.existsSync(path.join(out, filename))) continue;
      if (reserved + 0.5 > 5) throw Error('Reached experiment spending target');
      try {
        fs.writeFileSync(path.join(out, filename), JSON.stringify(row), { flag: 'wx', mode: 0o600 });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        throw Error('Another benchmark process claimed this sample');
      }
      const checkpoint = () => save(filename, row);
      const begin = performance.now();
      const elapsed = () => Math.round(performance.now() - begin);
      const restore = observe(row, elapsed, checkpoint);
      try {
        let bytes;
        if (model === 'h3') {
          const result = await fal.generate({
            prompt: prompts[op],
            input: op === 'edit' ? sourceData : null,
            price: prices[op],
            originalWire: !contractCheck && process.argv.includes('--original-wire'),
            saveReceipt: (receipt) => save(name + '.private.json', receipt),
          });
          const { bytes: output, ...metrics } = result;
          bytes = output;
          row.h3 = metrics;
          row.costUsd = result.costUsd;
        } else {
          bytes = await baseline(model, op, source, name, row);
          const call = row.calls.find((e) => e.usage || e.units != null);
          row.costUsd =
            call?.usage?.cost ??
            (call?.endpoint.includes('api.openai.com')
              ? image26UsageCostUsd(call.usage)
              : call?.units != null
                ? call.units * flarePrices[op].unit_price
                : null);
        }
        restore();
        row.serverResultMs = elapsed();
        const meta = await sharp(bytes).metadata();
        const data = asData(bytes, meta.format);
        const file = name + '.' + (meta.format === 'jpeg' ? 'jpg' : meta.format);
        fs.writeFileSync(path.join(out, file), bytes);
        Object.assign(row, {
          file,
          sha256: digest(bytes),
          width: meta.width,
          height: meta.height,
          bytes: bytes.length,
          format: meta.format,
        });
        await page.evaluate(async (src) => {
          const img = document.querySelector('img');
          img.src = src;
          await img.decode();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, data);
        row.firstPaintMs = elapsed();
        checkpoint();
        const result = await projectRequest({ _addToProject: projectId, imageBase64: data });
        const snap = result.snapshots?.[0];
        if (!snap?.imageUrl) throw Error('Snapshot missing');
        row.persistedMs = elapsed();
        const saved = await getSupabaseAdmin()
          .from('snapshots')
          .select('image_url')
          .eq('project_id', projectId)
          .eq('id', snap.snapshotId)
          .single();
        if (saved.data?.image_url !== snap.imageUrl) throw Error('Snapshot readback mismatch');
        const r = await fetch(snap.imageUrl, { signal: AbortSignal.timeout(60000) });
        if (!r.ok || digest(Buffer.from(await r.arrayBuffer())) !== row.sha256)
          throw Error('Stored bytes mismatch');
        row.verifiedMs = elapsed();
        row.state = 'verified';
      } catch (e) {
        failures++;
        row.state = 'failed';
        row.error = e.message;
      } finally {
        restore();
        checkpoint();
      }
      reserved += row.costUsd ?? 0.5;
      console.log(name, row.state, row.firstPaintMs, row.costUsd, row.error ?? '');
    }
    if (failures) throw Error(failures + ' samples incomplete. Inspect the existing journals.');
  } finally {
    await browser.close();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
