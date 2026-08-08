export const REQUIRED_OPENROUTER_GPT56_MODEL_IDS = [
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-sol',
  'openai/gpt-5.6-luna',
] as const;

interface OpenRouterAgentHealthEnv {
  OPENROUTER_API_KEY?: string;
}

export interface OpenRouterAgentHealthRequest {
  apiKey: string;
  authUrl: string;
  modelUrls: string[];
}

export function resolveOpenRouterAgentHealthRequest(
  env: OpenRouterAgentHealthEnv = process.env as OpenRouterAgentHealthEnv,
): OpenRouterAgentHealthRequest | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    authUrl: 'https://openrouter.ai/api/v1/auth/key',
    modelUrls: REQUIRED_OPENROUTER_GPT56_MODEL_IDS.map(
      modelId => `https://openrouter.ai/api/v1/models/${modelId}/endpoints`,
    ),
  };
}

export function assertOpenRouterGPT56ModelEndpoint(
  payload: unknown,
  requiredModelId: string,
): void {
  const data = (payload as {
    data?: { id?: unknown; endpoints?: unknown };
  })?.data;
  if (data?.id !== requiredModelId
    || !Array.isArray(data.endpoints)
    || data.endpoints.length === 0) {
    throw new Error(`${requiredModelId} unavailable`);
  }
}
