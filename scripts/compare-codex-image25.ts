/** Probe the existing personal-subscription relay without API fallback.
 * Usage: node --env-file=<gitignored-env> --import tsx scripts/compare-codex-image25.ts [source.png]
 * Consumes subscription image quota. Saves images and sanitized model telemetry only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createCodexSubscriptionFetch, getCodexSubscriptionUsage } from '../src/lib/codex-subscription';
import { buildCodexSubscriptionImageRequest, parseCodexSubscriptionImageResponse } from '../src/lib/codex-subscription-image';

async function main() {
  const userId = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
  if (!userId || !process.env.CODEX_SUBSCRIPTION_RELAY_URL || !process.env.CODEX_SUBSCRIPTION_RELAY_SECRET) {
    throw new Error('Configure the owner and current signed relay in a gitignored environment file. Direct local authentication is not used.');
  }
  const output = path.resolve(process.env.IMAGE_BENCH_OUTPUT || `.artifacts/image25-subscription/${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const models = (process.env.IMAGE_BENCH_MODELS || 'gpt-image-2.5-flare,gpt-image-2.5-sunburst,gpt-image-2').split(',');
  if (!models.every(model => /^gpt-image-(2|2\.5-(flare|sunburst))$/.test(model))) throw new Error('Unsupported model selection.');
  const prompt = process.env.IMAGE_BENCH_PROMPT || 'A refined studio product photograph of a red ceramic coffee cup on pale limestone. The cup has the exact printed word MAKARON. Include realistic glaze texture, a soft window shadow, and a folded linen napkin. No other text.';
  const source = process.argv[2] ? await fs.readFile(process.argv[2]) : undefined;
  const sourceFormat = source ? (await sharp(source).metadata()).format : undefined;
  const projectId = `image25-subscription-probe-${Date.now()}`;
  const fetcher = createCodexSubscriptionFetch({ userId, projectId });
  const usage = await getCodexSubscriptionUsage(userId, {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
  });
  console.log(JSON.stringify({ subscriptionAvailable: true, planType: usage.planType }));
  await fs.mkdir(output, { recursive: true });
  const results: Record<string, unknown>[] = [];
  for (const model of models) {
    const body = buildCodexSubscriptionImageRequest({
      prompt,
      aspectRatio: '1:1',
      ...(source ? { image: `data:image/${sourceFormat};base64,${source.toString('base64')}` } : {}),
      codexSubscription: { userId, projectId },
    });
    (body.tools as Record<string, unknown>[])[0].model = model;
    const result: Record<string, unknown> = { requestedModel: model, requestedQuality: 'low', requestedSize: '1024x1024' };
    const started = Date.now();
    console.log(`Starting ${model}`);
    try {
      const response = await fetcher('https://codex-subscription.invalid/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
      result.status = response.status;
      result.headersMs = Date.now() - started;
      const text = await response.text();
      result.responseMs = Date.now() - started;
      const parsed = parseCodexSubscriptionImageResponse(text);
      result.eventTypes = parsed.eventTypes;
      // Only persist the small, relevant tool contract. Never save the raw stream,
      // headers, credentials, account metadata, or rewritten free-form text.
      const events = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => {
        try { return JSON.parse(line.slice(5)); } catch { return {}; }
      });
      const completed = events.find(event => event.type === 'response.completed')?.response;
      const imageTool = completed?.tools?.find((tool: { type?: string }) => tool.type === 'image_generation');
      result.reportedTool = imageTool ? { model: imageTool.model, quality: imageTool.quality, size: imageTool.size, background: imageTool.background } : null;
      result.explicitModelConfirmed = imageTool?.model === model;
      if (response.ok && parsed.imageBase64) {
        const buffer = Buffer.from(parsed.imageBase64, 'base64');
        const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
        await sharp(buffer, { failOn: 'error' }).raw().toBuffer();
        result.file = `${model}.${metadata.format}`;
        await fs.writeFile(path.join(output, String(result.file)), buffer);
        Object.assign(result, { readyMs: Date.now() - started, width: metadata.width, height: metadata.height, bytes: buffer.length });
      } else {
        result.error = 'no_successful_image';
      }
    } catch (error) {
      result.error = error instanceof Error ? error.name : 'unknown_error';
      result.elapsedMs = Date.now() - started;
    }
    results.push(result);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ prompt, results }, null, 2));
    console.log(JSON.stringify(result));
  }
  console.log(`Report: ${path.join(output, 'report.json')}`);
  // A rendered image alone is not evidence of an exact version upgrade.
  if (results.some(result => result.error || !result.explicitModelConfirmed)) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.name : 'Probe failed');
  process.exitCode = 1;
});
