export type ServiceHealthStatus = 'healthy' | 'unhealthy' | 'unavailable';

export const REQUIRED_GPT56_MODEL_PREFIXES = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
] as const;

const DEFAULT_RESPONSES_URL =
  'https://meo-ultron.openai.azure.com/openai/responses?api-version=2025-04-01-preview';

interface AzureOpenAIHealthEnv {
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_RESPONSES_URL?: string;
  AZURE_OPENAI_EDITS_URL?: string;
}

export interface AzureOpenAIModelsRequest {
  apiKey: string;
  url: string;
}

export function resolveAzureOpenAIModelsRequest(
  env: AzureOpenAIHealthEnv = process.env as AzureOpenAIHealthEnv,
): AzureOpenAIModelsRequest | null {
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const endpoint = env.AZURE_OPENAI_RESPONSES_URL?.trim()
    || env.AZURE_OPENAI_EDITS_URL?.trim()
    || DEFAULT_RESPONSES_URL;
  const origin = new URL(endpoint).origin;

  return {
    apiKey,
    url: `${origin}/openai/models?api-version=2024-02-01`,
  };
}

export function assertRequiredGPT56Models(payload: unknown): void {
  const data = (payload as { data?: unknown })?.data;
  const modelIds = Array.isArray(data)
    ? data.map((model) => String((model as { id?: unknown })?.id || ''))
    : [];

  for (const required of REQUIRED_GPT56_MODEL_PREFIXES) {
    if (!modelIds.some((id) => id.startsWith(required))) {
      throw new Error(`${required} unavailable`);
    }
  }
}

export function isRequiredServiceDown(status: ServiceHealthStatus): boolean {
  return status !== 'healthy';
}
