/** Real Preview acceptance matrix for fal's multiple-angle camera tool. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import sharp from 'sharp';
import { AZIMUTH_STEPS, DISTANCE_STEPS, ELEVATION_STEPS } from '../src/lib/camera-utils';

const previewUrl = process.env.PREVIEW_URL;
const key = process.env.MCP_API_KEY;
if (!previewUrl || !key) throw new Error('PREVIEW_URL and MCP_API_KEY are required');

const outputDir = path.resolve('test-results/camera-angle-preview-matrix');
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.split('=')[1] ?? 'azimuth';
const sourceFilter = process.argv.find(arg => arg.startsWith('--source='))?.split('=')[1];
const retryErrors = process.argv.includes('--retry-errors');
if (!['azimuth', 'elevation', 'distance', 'combined', 'all'].includes(phase)) {
  throw new Error('phase must be azimuth, elevation, distance, combined, or all');
}

type Angle = { azimuth: number; elevation: number; distance: number };
type Source = { id: string; file: string };
const sources: Source[] = [
  { id: 'portrait', file: 'test-results/vast-retirement/04-preview-spicy-edit.png' },
  { id: 'anime', file: path.join(outputDir, 'sources/anime.jpg') },
  { id: 'product', file: path.join(outputDir, 'sources/product.jpg') },
].filter(source => !sourceFilter || source.id === sourceFilter);
if (!sources.length) throw new Error(`unknown source: ${sourceFilter}`);

function anglesForPhase(name: string): Angle[] {
  if (name === 'azimuth') return AZIMUTH_STEPS.map(azimuth => ({ azimuth, elevation: 0, distance: 1 }));
  if (name === 'elevation') return ELEVATION_STEPS.filter(elevation => elevation !== 0).map(elevation => ({ azimuth: 0, elevation, distance: 1 }));
  if (name === 'distance') return DISTANCE_STEPS.filter(distance => distance !== 1).map(distance => ({ azimuth: 0, elevation: 0, distance }));
  if (name === 'combined') return [
    { azimuth: 45, elevation: 30, distance: 0.6 },
    { azimuth: 135, elevation: 60, distance: 1.4 },
    { azimuth: 225, elevation: -30, distance: 0.6 },
    { azimuth: 315, elevation: 30, distance: 1.4 },
  ];
  return ['azimuth', 'elevation', 'distance', 'combined'].flatMap(anglesForPhase);
}

function angleId(angle: Angle): string {
  return `a${angle.azimuth}-e${angle.elevation}-d${angle.distance.toFixed(1)}`;
}

async function getImage(rawResult: unknown, name: string): Promise<Buffer> {
  const result = CallToolResultSchema.parse(rawResult);
  if (result.isError) throw new Error(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  const image = result.content.find(c => c.type === 'image');
  if (!image || image.type !== 'image') throw new Error(`${name} returned no image: ${JSON.stringify(result.content).slice(0, 500)}`);
  const bytes = Buffer.from(image.data, 'base64');
  await sharp(bytes, { failOn: 'error' }).metadata();
  return bytes;
}

async function ensureSources(client: Client): Promise<void> {
  const dir = path.join(outputDir, 'sources');
  await mkdir(dir, { recursive: true });
  const anime = await sharp('public/landing/uc-video.jpg').extract({ left: 0, top: 0, width: 600, height: 600 }).jpeg({ quality: 92 }).toBuffer();
  await writeFile(path.join(dir, 'anime.jpg'), anime);
  try {
    await readFile(path.join(dir, 'product.jpg'));
  } catch {
    const started = Date.now();
    const result = await client.callTool({
      name: 'makaron_edit_image',
      arguments: {
        model: 'qwen-spicy',
        editPrompt: 'A single glossy red ceramic teapot, with a clearly visible curved handle on its left and a long spout on its right, standing on a plain pale gray studio tabletop. Three-quarter front view, photorealistic product photography, soft shadows, centered, no writing, no extra objects, square image.',
      },
    }, undefined, { timeout: 300_000 });
    const product = await getImage(result, 'product source');
    await sharp(product).resize(600, 600, { fit: 'cover' }).jpeg({ quality: 92 }).toFile(path.join(dir, 'product.jpg'));
    console.log(JSON.stringify({ stage: 'source', source: 'product', ms: Date.now() - started }));
  }
}

async function makeSheet(source: Source): Promise<void> {
  const recordsPath = path.join(outputDir, source.id, 'manifest.json');
  const records = JSON.parse(await readFile(recordsPath, 'utf8')) as Record<string, { status: string; file?: string; ms?: number }>;
  const angles = anglesForPhase(phase);
  const tileWidth = 256;
  const imageHeight = 256;
  const titleHeight = 35;
  const columns = phase === 'azimuth' ? 4 : phase === 'all' ? 4 : 3;
  const rows = Math.ceil((angles.length + 1) / columns);
  const composites: sharp.OverlayOptions[] = [];
  const input = await sharp(source.file).resize(tileWidth, imageHeight, { fit: 'cover' }).jpeg().toBuffer();
  const tiles: { title: string; bytes?: Buffer }[] = [{ title: `${source.id} / input`, bytes: input }];
  for (const angle of angles) {
    const item = records[angleId(angle)];
    const bytes = item?.status === 'ok' && item.file ? await sharp(item.file).resize(tileWidth, imageHeight, { fit: 'cover' }).jpeg().toBuffer() : undefined;
    tiles.push({ title: `${angle.azimuth}° / ${angle.elevation}° / ${angle.distance.toFixed(1)}  ${item?.status === 'ok' ? `${(item.ms! / 1000).toFixed(1)}s` : 'FAIL'}`, bytes });
  }
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * (imageHeight + titleHeight);
    if (tile.bytes) composites.push({ input: tile.bytes, left, top: top + titleHeight });
    const label = `<svg width="${tileWidth}" height="${titleHeight}"><rect width="100%" height="100%" fill="#222"/><text x="7" y="23" fill="white" font-size="15" font-family="Arial">${tile.title}</text></svg>`;
    composites.push({ input: Buffer.from(label), left, top });
  }
  const sheet = path.join(outputDir, source.id, `${phase}-sheet.jpg`);
  await sharp({ create: { width: columns * tileWidth, height: rows * (imageHeight + titleHeight), channels: 3, background: '#555' } })
    .composite(composites).jpeg({ quality: 88 }).toFile(sheet);
  console.log(JSON.stringify({ stage: 'sheet', source: source.id, sheet }));
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', previewUrl), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: 'makaron-camera-angle-preview-matrix', version: '1.0.0' });
  await client.connect(transport);
  try {
    await ensureSources(client);
    for (const source of sources) {
      const sourceDir = path.join(outputDir, source.id);
      await mkdir(sourceDir, { recursive: true });
      const recordsPath = path.join(sourceDir, 'manifest.json');
      let records: Record<string, { status: string; file?: string; ms?: number; error?: string }> = {};
      try { records = JSON.parse(await readFile(recordsPath, 'utf8')); } catch { /* first run */ }
      const input = await readFile(source.file);
      const metadata = await sharp(input).metadata();
      const image = `data:image/${metadata.format === 'jpeg' ? 'jpeg' : 'png'};base64,${input.toString('base64')}`;
      for (const angle of anglesForPhase(phase)) {
        const id = angleId(angle);
        // A provider may have charged for a failed generation. Never resubmit it implicitly.
        if (records[id]?.status === 'ok' || (records[id]?.status === 'error' && !retryErrors)) continue;
        const started = Date.now();
        try {
          const result = await client.callTool({ name: 'makaron_rotate_camera', arguments: { image, ...angle } }, undefined, { timeout: 300_000 });
          const bytes = await getImage(result, id);
          const file = path.join(sourceDir, `${id}.jpg`);
          await sharp(bytes).jpeg({ quality: 92 }).toFile(file);
          records[id] = { status: 'ok', file, ms: Date.now() - started };
          console.log(JSON.stringify({ stage: 'rotate', source: source.id, angle, status: 'ok', ms: records[id].ms, file }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          records[id] = { status: 'error', error: message, ms: Date.now() - started };
          console.log(JSON.stringify({ stage: 'rotate', source: source.id, angle, status: 'error', ms: records[id].ms, error: message }));
        }
        await writeFile(recordsPath, JSON.stringify(records, null, 2));
      }
      await makeSheet(source);
    }
  } finally {
    await client.close();
  }
}

run().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
