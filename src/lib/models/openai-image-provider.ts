import type { ImageBackground } from './types';

export type OpenAIImageProvider = 'azure' | 'piapi' | 'openrouter';

export const OPENROUTER_GPT_IMAGE_2_MODEL = 'openai/gpt-image-2';
export const OPENROUTER_IMAGE_API_URL = 'https://openrouter.ai/api/v1/images';

interface OpenRouterImageRequestInput {
  prompt: string;
  image?: string;
  references?: { url: string; role: string }[];
  aspectRatio?: string;
  background?: ImageBackground;
}

const OPENROUTER_GPT_IMAGE_2_ASPECT_RATIOS = new Set([
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto',
]);

export function buildOpenRouterImageRequest({
  prompt,
  image,
  references,
  aspectRatio,
  background,
}: OpenRouterImageRequestInput): Record<string, unknown> {
  const referenceUrls = [
    ...(image ? [image] : []),
    ...(references?.map(reference => reference.url) ?? []),
  ].slice(0, 16);
  const body: Record<string, unknown> = {
    model: OPENROUTER_GPT_IMAGE_2_MODEL,
    prompt,
    n: 1,
    quality: 'low',
  };
  if (aspectRatio && OPENROUTER_GPT_IMAGE_2_ASPECT_RATIOS.has(aspectRatio)) {
    body.aspect_ratio = aspectRatio;
  }
  if (background) {
    body.background = background;
    if (background === 'transparent') body.output_format = 'png';
  }
  if (referenceUrls.length) {
    body.input_references = referenceUrls.map(url => ({
      type: 'image_url',
      image_url: { url: url.startsWith('http') || url.startsWith('data:')
        ? url
        : `data:image/jpeg;base64,${url}` },
    }));
  }
  return body;
}

interface OpenAIImageProviderEnv {
  OPENAI_IMAGE_PROVIDER?: string;
  AZURE_OPENAI_API_KEY?: string;
  PIAPI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

export function resolveOpenAIImageProvider(
  env: OpenAIImageProviderEnv = process.env as OpenAIImageProviderEnv,
): OpenAIImageProvider {
  const configured = env.OPENAI_IMAGE_PROVIDER?.trim().toLowerCase();
  if (configured === 'azure' || configured === 'piapi' || configured === 'openrouter') {
    return configured;
  }
  return 'azure';
}

export function resolveOpenAIImageProviderOrder(
  env: OpenAIImageProviderEnv = process.env as OpenAIImageProviderEnv,
): OpenAIImageProvider[] {
  const primary = resolveOpenAIImageProvider(env);
  if (primary === 'azure' && env.OPENROUTER_API_KEY?.trim()) {
    return ['azure', 'openrouter'];
  }
  return [primary];
}

/** Capability gate for strict alpha output. The current rollout has been
 * verified on Azure; known-unsupported backups must not receive paid calls. */
export function filterOpenAIImageProvidersForBackground(
  providers: OpenAIImageProvider[],
  background?: ImageBackground,
): OpenAIImageProvider[] {
  return background === 'transparent'
    ? providers.filter(provider => provider === 'azure')
    : providers;
}

export function readOpenRouterProviderCost(usage: unknown): number | undefined {
  const cost = (usage as { cost?: unknown } | undefined)?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
    ? cost
    : undefined;
}
