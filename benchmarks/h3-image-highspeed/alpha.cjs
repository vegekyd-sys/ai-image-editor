// Separate capability probe. Excluded from the latency comparison.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { endpointFor, quote, generate } = require('./fal.cjs');

async function main() {
  if (process.argv[3] !== '--paid') throw Error('Pass the existing matrix directory and --paid');
  const dir = path.resolve(process.argv[2]);
  const journal = path.join(dir, 'alpha.json');
  const matrix = fs
    .readdirSync(dir)
    .filter((f) => /^[1-3]-(edit|generate)-(nano|h3|flare)\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f))));
  if (
    matrix.length !== 18 ||
    matrix.some((r) => r.state === 'started') ||
    matrix.reduce((sum, r) => sum + (r.costUsd ?? 0.5), 0) + 0.5 > 5
  )
    throw Error('Matrix incomplete or over target');
  const prompt = '只画一枚橙色复古闹钟图标。四周与背景全部真实透明，PNG alpha 为零，不要底色、阴影或棋盘格。';
  const price = await quote(endpointFor(false));
  fs.writeFileSync(journal, JSON.stringify({ state: 'started', prompt }), { flag: 'wx', mode: 0o600 });
  const result = await generate({
    prompt,
    price,
    saveReceipt: (receipt) =>
      fs.writeFileSync(path.join(dir, 'alpha.private.json'), JSON.stringify(receipt), { mode: 0o600 }),
  });
  const { bytes, ...receipt } = result;
  fs.writeFileSync(path.join(dir, 'alpha.png'), bytes);
  const meta = await sharp(bytes).metadata();
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
  let transparent = 0;
  for (let i = 3; i < raw.length; i += 4) if (raw[i] < 255) transparent++;
  fs.writeFileSync(
    journal,
    JSON.stringify(
      {
        state: 'complete',
        prompt,
        ...receipt,
        hasAlpha: meta.hasAlpha,
        nonOpaquePixels: transparent,
        totalPixels: meta.width * meta.height,
      },
      null,
      2,
    ) + '\n',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
