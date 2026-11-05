/** Original ten shared-editImage cases; Agent cases are exercised with real CLI against Preview.
 * node --env-file=<private-env> --import tsx scripts/gpt-image-regression-application.ts
 * A recorded attempt is never automatically submitted a second time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
require.extensions['.md'] = (module: any, file: string) => { module.exports = fs.readFileSync(file, 'utf8'); };
const root = path.resolve('testcases/gpt-image-regression');
const suite = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.resolve('evidence/gpt-image26-regression/application');
const data = (file?: string) => file ? `data:image/${file.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(root, 'fixtures', file)).toString('base64')}` : undefined;
async function main() {
  const { editImage } = await import('../src/lib/skills/edit-image');
  for (const c of suite.cases.filter((c: any) => !c.id.startsWith('agent-'))) {
    const dir = path.join(out, c.id); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'receipt.json');
    if (fs.existsSync(file)) { console.log(c.id, 'previous attempt retained'); continue; }
    const sample: any = { case_id: c.id, path: 'real shared editImage', started_at: new Date().toISOString(), stage: 'started', requested_model: c.background ? null : 'openai', quality: 'low', reasoning: 'default high', fallback: false };
    fs.writeFileSync(file, JSON.stringify(sample)); const start = Date.now();
    const result = await editImage({ editPrompt: c.prompt, preferredModel: c.background ? undefined : 'openai', aspectRatio: c.aspect, background: c.background }, { currentImage: data(c.image), referenceImages: c.refs?.map(data) });
    Object.assign(sample, { elapsed_ms: Date.now() - start, success: result.success, model: result.usedModel, provider: result.provider, message: result.message, cost_usd: result.usage?.providerCostUsd, stage: result.success ? 'complete' : 'failed' });
    if (result.image) {
      const bytes = Buffer.from(result.image.split(',')[1], 'base64'); const m = await sharp(bytes).metadata();
      const filename = `output.${m.format}`; fs.writeFileSync(path.join(dir, filename), bytes);
      sample.output = filename; sample.media = { format: m.format, width: m.width, height: m.height, hasAlpha: m.hasAlpha };
    }
    fs.writeFileSync(file, JSON.stringify(sample, null, 2));
    console.log(c.id, sample.stage, sample.elapsed_ms, sample.cost_usd);
    if (!result.success || result.usedModel !== 'gpt-image-2.6-flare' || result.provider !== 'fal') throw new Error('Application path did not complete target model; preserve attempt and investigate');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
