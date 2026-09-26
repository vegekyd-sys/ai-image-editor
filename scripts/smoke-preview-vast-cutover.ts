/** Authenticated Preview smoke: Spicy image edit followed by fal camera rotation. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import sharp from 'sharp';

const previewUrl = process.env.PREVIEW_URL;
const key = process.env.MCP_API_KEY;
if (!previewUrl || !key) throw new Error('PREVIEW_URL and MCP_API_KEY are required');
const outputDir = path.resolve('test-results/vast-retirement');

async function saveResult(name: string, rawResult: unknown) {
  const result = CallToolResultSchema.parse(rawResult);
  if (result.isError) throw new Error(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  const image = result.content.find(c => c.type === 'image');
  if (!image || image.type !== 'image') throw new Error(`MCP ${name} returned no inline image: ${JSON.stringify(result.content).slice(0, 500)}`);
  const bytes = Buffer.from(image.data, 'base64');
  const meta = await sharp(bytes, { failOn: 'error' }).metadata();
  const extension = meta.format === 'jpeg' ? 'jpg' : meta.format ?? 'bin';
  const file = path.join(outputDir, `${name}.${extension}`);
  await writeFile(file, bytes);
  return { file, bytes: bytes.length, width: meta.width, height: meta.height, image: `data:${image.mimeType};base64,${image.data}` };
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const original = await readFile('public/landing/uc-retouch.jpg');
  const cropped = await sharp(original).extract({ left: 680, top: 0, width: 600, height: 600 }).jpeg().toBuffer();
  const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', previewUrl), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: 'makaron-preview-cutover-smoke', version: '1.0.0' });
  await client.connect(transport);
  try {
    const started = Date.now();
    const edited = await client.callTool({
      name: 'makaron_edit_image',
      arguments: {
        image: `data:image/jpeg;base64,${cropped.toString('base64')}`,
        model: 'qwen-spicy',
        editPrompt: 'This is a clearly adult woman, age 30. Restyle her portrait as tasteful editorial boudoir photography with an elegant black lace lingerie top and a draped emerald satin robe. Preserve her identity and face, keep the image non-explicit, and do not add text.',
      },
    }, undefined, { timeout: 300_000 });
    const editImage = await saveResult('04-preview-spicy-edit', edited);
    console.log(JSON.stringify({ stage: 'spicy-edit', file: editImage.file, width: editImage.width, height: editImage.height, bytes: editImage.bytes, ms: Date.now() - started }));
    if (process.argv.includes('--edit-only')) return;

    const rotateStarted = Date.now();
    const rotated = await client.callTool({
      name: 'makaron_rotate_camera',
      arguments: { image: editImage.image, azimuth: 45, elevation: 0, distance: 1 },
    }, undefined, { timeout: 300_000 });
    const camera = await saveResult('05-preview-fal-rotate', rotated);
    console.log(JSON.stringify({ stage: 'fal-rotate', file: camera.file, width: camera.width, height: camera.height, bytes: camera.bytes, ms: Date.now() - rotateStarted }));
  } finally {
    await client.close();
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
