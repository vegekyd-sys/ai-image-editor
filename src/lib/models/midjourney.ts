import sharp from 'sharp';
import { validateImageModelRequest } from '../image-model-capabilities';
import { buildMidjourneyRequest, MidjourneyClient, MidjourneyRequestError, type MidjourneyRequest, type MidjourneyTask } from '../midjourney';
import { prepareMidjourneyPromptWithUsage } from '../midjourney-prompt';
import type { GenerateImageRequest, ModelBackend } from './types';

export function midjourneyOptions(req: GenerateImageRequest): MidjourneyRequest {
  validateImageModelRequest(req, 'mj-v8.2');
  const options = req.midjourney ?? {};
  const result: MidjourneyRequest = {
    prompt: 'preflight', ...options,
    aspectRatio: req.aspectRatio === 'auto' ? undefined : req.aspectRatio,
    imageUrls: req.references?.map(ref => ref.url),
    quality: req.imageResolution === '2K' ? 'hd' : options.quality ?? 'standard',
  };
  buildMidjourneyRequest(result);
  return result;
}

export async function collectMidjourneyBatch(
  initial: MidjourneyTask, expected: number, client: Pick<MidjourneyClient, 'get'>,
  readImage = async (url: string) => {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 30 * 1024 * 1024) throw new Error('Image download failed.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 30 * 1024 * 1024) throw new Error('Image too large.');
    // Decode the entire image, not just its header, before publishing any candidate.
    const png = await sharp(buffer, { failOn: 'error', limitInputPixels: 16_000_000 }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  },
  pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  deadlineMs = 600_000,
) {
  const deadline = Date.now() + deadlineMs;
  let task = initial;
  let readFailures = 0;
  try {
    while (task.status === 'pending' || task.status === 'processing') {
      if (Date.now() >= deadline) throw new Error('Polling deadline reached.');
      await pause(2500);
      try { task = await client.get(initial.taskId); readFailures = 0; }
      catch { if (++readFailures >= 3) throw new Error('Task query unavailable.'); }
    }
    if (task.status !== 'completed') throw new Error(`Provider failed${task.errorCode ? ` (${task.errorCode})` : ''}.`);
    if (!task.images.length || task.images.length > expected) throw new Error(`Incomplete batch: expected ${expected}, received ${task.images.length}.`);
    if (task.providerCostUsd === undefined || task.providerCostUsd <= 0) throw new Error('Missing provider cost.');
    const images: string[] = [];
    for (const item of task.images) images.push(await readImage(item.url));
    return { task, images };
  } catch (error) {
    throw new MidjourneyRequestError(`Midjourney batch was not published: ${error instanceof Error ? error.message : 'Unknown result'}. Keep the accepted task; do not regenerate automatically.`, 'query_failed', initial.taskId);
  }
}

export const midjourneyBackend: ModelBackend = {
  id: 'mj-v8.2',
  canHandle: () => Boolean(process.env.EVOLINK_API_KEY?.trim() && process.env.OPENROUTER_API_KEY?.trim()),
  async generate(req) {
    const options = midjourneyOptions(req); // All hard constraints before either paid API call.
    const prepared = await prepareMidjourneyPromptWithUsage(req.prompt, Boolean(options.styleReferences?.length));
    if (prepared.cost === undefined || prepared.cost < 0) throw new MidjourneyRequestError('Prompt preparation returned no provider cost. No MJ generation was submitted.', 'not_submitted');
    const request = { ...prepared.request, ...options, prompt: prepared.request.prompt,
      aspectRatio: options.aspectRatio ?? prepared.request.aspectRatio };
    // Undefined options must not erase the prepared visual parameters.
    for (const key of ['stylize', 'raw', 'negativePrompt'] as const) {
      if (req.midjourney?.[key] === undefined) (request as any)[key] = prepared.request[key];
    }
    buildMidjourneyRequest(request);
    const client = new MidjourneyClient();
    const receipt = await client.submit(request);
    try { await req.onMidjourneyReceipt?.(receipt, request); }
    catch { throw new MidjourneyRequestError('Accepted Midjourney receipt could not be persisted. Do not resubmit.', 'unknown', receipt.taskId); }
    const { task, images } = await collectMidjourneyBatch(receipt, request.speed === 'draft' ? 24 : 4, client);
    console.log(`[mj-v8.2] provider=evolink task=${task.taskId} candidates=${images.length} costUsd=${task.providerCostUsd} promptCostUsd=${prepared.cost}`);
    return { image: images[0], images, taskId: task.taskId, provider: 'evolink',
      adjustments: images.length < (request.speed === 'draft' ? 24 : 4) ? [`The completed provider batch returned ${images.length} of ${request.speed === 'draft' ? 24 : 4} expected candidates. Kept every available image; no replacement generation was submitted.`] : [],
      usage: {
      modelId: 'mj-v8.2', inputTokens: prepared.usage.inputTokens ?? 0,
      outputTokens: prepared.usage.outputTokens ?? 0, provider: 'evolink',
      providerCostUsd: task.providerCostUsd! + prepared.cost,
    } };
  },
};
