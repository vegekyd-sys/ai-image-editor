// Offline review: original-byte checks, button-region comparison, and lossless source retention.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const sourceDir = path.resolve(process.argv[2]);
const dest = path.resolve(process.argv[3]);
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const decode = (b) => sharp(b).toColourspace('srgb').ensureAlpha().raw().toBuffer();
const s = (ms) => (ms / 1000).toFixed(2);
async function main() {
  fs.mkdirSync(dest, { recursive: true });
  const read = (f) => fs.readFileSync(path.join(sourceDir, f));
  const write = (f, b) => fs.writeFileSync(path.join(dest, f), b);
  const source = read('source.png');
  const original = await decode(source);
  const prices = JSON.parse(read('prices.json'));
  if (hash(source) !== prices.inputSha256) throw Error('Comparison input changed');
  write('source.png', source);
  const samples = [];
  const preliminary = [];
  const published = fs.existsSync(path.join(sourceDir, 'samples.json'))
    ? [...JSON.parse(read('samples.json')), ...JSON.parse(read('preliminary.json'))]
    : [];
  const sampleByName = new Map(published.map((row) => [row.name, row]));
  const readRow = (name) => sampleByName.get(name) ?? JSON.parse(read(name + '.json'));
  const hasContractCheck =
    sampleByName.has('schema-edit-h3') || fs.existsSync(path.join(sourceDir, 'schema-edit-h3.json'));
  for (const op of ['generate', 'edit']) {
    const tiles = [];
    for (let round = 1; round <= 3; round++)
      for (const [col, model] of ['h3', 'nano', 'flare'].entries()) {
        let name = [round, op, model].join('-');
        if (hasContractCheck && op === 'edit' && model === 'h3') {
          const earlier = readRow(name);
          preliminary.push(earlier);
          if (earlier.file) {
            const bytes = read(earlier.file);
            if (hash(bytes) !== earlier.sha256) throw Error('Hash mismatch for ' + name);
            write(earlier.file, bytes);
          }
          name = ['schema-edit-h3', 'schema2-edit-h3', 'schema3-edit-h3'][round - 1];
        }
        const row = readRow(name);
        row.round = round;
        if (
          row.state === 'verified' &&
          (!row.file ||
            !Number.isFinite(row.costUsd) ||
            row.calls.filter((e) => e.method === 'POST').length !== 1 ||
            !(
              row.serverResultMs <= row.firstPaintMs &&
              row.firstPaintMs <= row.persistedMs &&
              row.persistedMs <= row.verifiedMs
            ))
        )
          throw Error('Incomplete measurements for ' + name);
        samples.push(row);
        if (!row.file) continue;
        const bytes = read(row.file);
        if (hash(bytes) !== row.sha256) throw Error('Hash mismatch for ' + name);
        const meta = await sharp(bytes).metadata();
        if (meta.width !== 1024 || meta.height !== 1024) throw Error('Size mismatch for ' + name);
        const rgba = await decode(bytes);
        let outside = 0,
          changed = 0,
          nonOpaque = 0,
          yellow = 0,
          button = 0;
        for (let y = 0; y < 1024; y++)
          for (let x = 0; x < 1024; x++) {
            const p = 4 * (y * 1024 + x);
            if (rgba[p + 3] < 255) nonOpaque++;
            if (op !== 'edit') continue;
            // Count the source button's solid blue core; the expanded bounding box excludes its stroke.
            if (original[p] === 54 && original[p + 1] === 118 && original[p + 2] === 189) {
              button++;
              if (rgba[p] > 160 && rgba[p + 1] > 135 && rgba[p + 2] < Math.min(rgba[p], rgba[p + 1]) - 50)
                yellow++;
            }
            if (x >= 405 && x <= 620 && y >= 247 && y <= 334) continue;
            outside++;
            if ([0, 1, 2].some((k) => Math.abs(original[p + k] - rgba[p + k]) > 16)) changed++;
          }
        row.visual = {
          nonOpaquePixels: nonOpaque,
          ...(op === 'edit'
            ? { outsideChanged: changed, outsidePixels: outside, buttonYellow: yellow, buttonPixels: button }
            : {}),
        };
        write(row.file, bytes);
        const label = Buffer.from(
          '<svg width="330" height="40"><rect width="330" height="40" fill="#fff"/><text x="7" y="26" font-family="sans-serif" font-size="17">' +
            { h3: 'H3 Highspeed', nano: 'Nano Banana 2.1', flare: 'GPT Image 2.6 Flare' }[model] +
            ' · ' +
            round +
            ' · ' +
            s(row.firstPaintMs) +
            's</text></svg>',
        );
        const left = 330 * col,
          top = 370 * (round - 1);
        tiles.push(
          { input: label, left, top },
          { input: await sharp(bytes).resize(330, 330).png().toBuffer(), left, top: top + 40 },
        );
      }
    if (tiles.length)
      await sharp({ create: { width: 990, height: 1110, channels: 3, background: '#fff' } })
        .composite(tiles)
        .webp({ quality: 90 })
        .toFile(path.join(dest, op + '.webp'));
  }
  for (const f of ['alpha.json', 'alpha.png', 'fal-account.json', 'prices.json'])
    if (fs.existsSync(path.join(sourceDir, f))) write(f, read(f));
  write('preliminary.json', JSON.stringify(preliminary, null, 2) + '\n');
  write('samples.json', JSON.stringify(samples, null, 2) + '\n');
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
