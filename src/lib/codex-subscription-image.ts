import { createCodexSubscriptionFetch } from './codex-subscription';
import type { GenerateImageRequest, TokenUsage } from './models/types';

const CODEX_IMAGE_MODEL = 'gpt-image-2';
const CODEX_AGENT_MODEL = 'gpt-5.6-terra';

interface CodexImageEvent {
  type?: string;
  item?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: { message?: string } | string;
}

export interface CodexSubscriptionImageResult {
  image: string | null;
  usage?: TokenUsage;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeImageUrl(image: string): string {
  if (image.startsWith('http://') || image.startsWith('https://') || image.startsWith('data:image/')) {
    return image;
  }
  return `data:image/jpeg;base64,${image}`;
}

export function parseCodexSubscriptionImageResponse(text: string): {
  imageBase64?: string;
  error?: string;
  eventTypes: string[];
} {
  const events: CodexImageEvent[] = text
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(line => line && line !== '[DONE]')
    .map((line) => {
      try {
        return JSON.parse(line) as CodexImageEvent;
      } catch {
        return {};
      }
    });

  let json: Record<string, unknown> | undefined;
  try {
    json = asRecord(JSON.parse(text));
  } catch {
    json = undefined;
  }

  const completedResponse = events
    .find(event => event.type === 'response.completed')
    ?.response;
  const output = [
    ...(Array.isArray(json?.output) ? json.output : []),
    ...(Array.isArray(completedResponse?.output) ? completedResponse.output : []),
    ...events
      .filter(event => event.type === 'response.output_item.done')
      .map(event => event.item),
  ];
  const imageItem = output
    .map(asRecord)
    .find(item => item?.type === 'image_generation_call' && typeof item.result === 'string');
  const imageBase64 = typeof imageItem?.result === 'string' ? imageItem.result : undefined;

  const errorValue = json?.error
    ?? events.find(event => event.type === 'error' || event.type === 'response.failed')?.error
    ?? asRecord(events.find(event => event.type === 'response.failed')?.response)?.error;
  const errorRecord = asRecord(errorValue);
  const error = typeof errorValue === 'string'
    ? errorValue
    : typeof errorRecord?.message === 'string'
      ? errorRecord.message
      : undefined;

  return {
    imageBase64,
    error,
    eventTypes: [...new Set(events.map(event => event.type).filter((type): type is string => Boolean(type)))],
  };
}

export function buildCodexSubscriptionImageRequest(req: GenerateImageRequest): Record<string, unknown> {
  const content: Record<string, unknown>[] = [{ type: 'input_text', text: req.prompt }];
  const images = req.references?.length
    ? [
        ...(req.image ? [{ url: req.image, role: 'Photo to edit (base image)' }] : []),
        ...req.references,
      ]
    : req.image
      ? [{ url: req.image, role: 'Photo to edit' }]
      : [];

  for (const image of images) {
    if (image.role) content.push({ type: 'input_text', text: image.role });
    content.push({
      type: 'input_image',
      image_url: normalizeImageUrl(image.url),
      detail: 'high',
    });
  }

  return {
    model: req.codexSubscription?.agentModelId || CODEX_AGENT_MODEL,
    input: [{ role: 'user', content }],
    tools: [{
      type: 'image_generation',
      model: CODEX_IMAGE_MODEL,
      quality: 'low',
      size: req.aspectRatio ? aspectRatioToCodexSize(req.aspectRatio) : 'auto',
      // The Codex subscription endpoint currently rejects transparent output.
      background: 'opaque',
      output_format: 'png',
    }],
    tool_choice: { type: 'image_generation' },
    stream: true,
    store: false,
  };
}

export function aspectRatioToCodexSize(aspectRatio: string): '1024x1024' | '1024x1536' | '1536x1024' {
  const [width, height] = aspectRatio.split(':').map(Number);
  if (!width || !height) return '1024x1024';
  const ratio = width / height;
  if (ratio > 1.2) return '1536x1024';
  if (1 / ratio > 1.2) return '1024x1536';
  return '1024x1024';
}

export async function generateCodexSubscriptionImage(
  req: GenerateImageRequest,
  fetchImpl?: typeof globalThis.fetch,
): Promise<CodexSubscriptionImageResult> {
  const subscription = req.codexSubscription;
  if (!subscription || req.background === 'transparent') return { image: null };

  const body = JSON.stringify(buildCodexSubscriptionImageRequest(req));
  const codexFetch = createCodexSubscriptionFetch({
    projectId: subscription.projectId,
    userId: subscription.userId,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const startedAt = Date.now();

  try {
    const response = await codexFetch('https://codex-subscription.invalid/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body,
    });
    const responseText = await response.text();
    const parsed = parseCodexSubscriptionImageResponse(responseText);
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok || !parsed.imageBase64) {
      console.warn(
        `[openai/codex-subscription] image failed status=${response.status} elapsed=${elapsedMs}ms events=${parsed.eventTypes.join(',')} error=${parsed.error ?? 'missing image result'}`,
      );
      return { image: null };
    }

    console.log(
      `[openai/codex-subscription] image complete elapsed=${elapsedMs}ms bytes≈${Math.round(parsed.imageBase64.length * 0.75)}`,
    );
    return {
      image: `data:image/png;base64,${parsed.imageBase64}`,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        modelId: CODEX_IMAGE_MODEL,
        provider: 'codex-subscription',
      },
    };
  } catch (error) {
    console.warn(
      '[openai/codex-subscription] image request unavailable; falling back to API provider:',
      error instanceof Error ? error.message : error,
    );
    return { image: null };
  }
}
