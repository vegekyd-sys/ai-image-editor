/** Live, paid opt-in QA of the production image router/skill. No database writes. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { editImage } from '../src/lib/skills/edit-image';

async function main() {
  const [sourcePath, promptPath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !promptPath || !outputPath) throw new Error('Usage: wan27-product-smoke.ts <reference.jpg> <prompt.txt> <new-output-directory>');
  if (!process.env.DASHSCOPE_API_KEY || !process.env.DASHSCOPE_API_HOST) throw new Error('Set DASHSCOPE_API_KEY and DASHSCOPE_API_HOST securely before running.');
  const out = resolve(outputPath);
  await mkdir(out, { recursive: false }); // refuse overwriting earlier evidence
  const prompt = await readFile(promptPath, 'utf8');
  const image = `data:image/jpeg;base64,${(await readFile(sourcePath)).toString('base64')}`;
  const results = [];
  for (const sample of [
    { name: 'edit', prompt, image, aspectRatio: '16:9' },
    { name: 'text-to-image', prompt: 'A realistic editorial product photograph of a red ceramic coffee mug on a pale oak table beside a window. Soft morning daylight, subtle steam, natural texture, no people, no text or logos.', image: undefined, aspectRatio: undefined },
  ]) {
    const started = Date.now();
    const result = await editImage({ editPrompt: sample.prompt, preferredModel: 'wan2.7-image', aspectRatio: sample.aspectRatio }, { currentImage: sample.image });
    const totalMs = Date.now() - started;
    if (!result.success || !result.image || result.usedModel !== 'wan2.7-image' || result.provider !== 'dashscope') throw new Error('Live image route failed or selected the wrong provider.');
    const bytes = Buffer.from(result.image.split(',')[1], 'base64');
    const metadata = await sharp(bytes).metadata();
    const file = resolve(out, `${sample.name}.jpg`);
    await writeFile(file, bytes, { flag: 'wx' });
    const row = { name: sample.name, model: result.usedModel, provider: result.provider, totalMs, width: metadata.width, height: metadata.height, bytes: bytes.length, file, prompt: sample.prompt, tokenBillingUsage: result.usage ?? null, nominalSupplierCostUsd: 0.03, defaultImageCredits: 6, billingMode: 'no database writes; debit verified separately by integration tests' };
    results.push(row);
    await writeFile(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ ...row, prompt: undefined }));
  }
}

main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'Smoke failed'); process.exit(1); });
