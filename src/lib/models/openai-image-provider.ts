export type OpenAIImageProvider = 'azure' | 'piapi' | 'openrouter';

export const OPENROUTER_GPT_IMAGE_2_MODEL = 'openai/gpt-5.4-image-2';

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
  return 'openrouter';
}

export function readOpenRouterProviderCost(usage: unknown): number | undefined {
  const cost = (usage as { cost?: unknown } | undefined)?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
    ? cost
    : undefined;
}
