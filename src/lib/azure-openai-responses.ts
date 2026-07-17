import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const DEFAULT_AZURE_OPENAI_RESPONSES_URL =
  'https://meo-ultron.openai.azure.com/openai/responses?api-version=2025-04-01-preview';

export interface AzureOpenAIResponsesConfig {
  apiKey: string;
  baseURL: string;
  endpoint: URL;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function normalizeResponsesEndpoint(value?: string): URL {
  const endpoint = new URL(value?.trim() || DEFAULT_AZURE_OPENAI_RESPONSES_URL);
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  if (!endpoint.pathname.endsWith('/responses')) {
    endpoint.pathname = `${endpoint.pathname}/responses`;
  }
  if (!endpoint.searchParams.has('api-version')) {
    endpoint.searchParams.set('api-version', '2025-04-01-preview');
  }
  return endpoint;
}

export function resolveAzureOpenAIResponsesConfig(options?: {
  apiKey?: string;
  endpoint?: string;
}): AzureOpenAIResponsesConfig {
  const apiKey = options?.apiKey?.trim() || process.env.AZURE_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('AZURE_OPENAI_API_KEY is required for GPT-5.6 Agent models');
  }

  const endpoint = normalizeResponsesEndpoint(
    options?.endpoint || process.env.AZURE_OPENAI_RESPONSES_URL,
  );
  const baseURL = new URL(endpoint.toString());
  baseURL.pathname = baseURL.pathname.replace(/\/responses$/, '');
  baseURL.search = '';

  return {
    apiKey,
    baseURL: baseURL.toString().replace(/\/$/, ''),
    endpoint,
  };
}

export function createAzureOpenAIFetch(
  config: AzureOpenAIResponsesConfig,
  fetchImpl: FetchLike = globalThis.fetch,
): FetchLike {
  return async (input, init) => {
    const requestUrl = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    config.endpoint.searchParams.forEach((value, key) => {
      requestUrl.searchParams.set(key, value);
    });

    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined),
    );
    headers.delete('authorization');
    headers.set('api-key', config.apiKey);

    return fetchImpl(requestUrl, { ...init, headers });
  };
}

export function createAzureOpenAIResponsesModel(
  modelId: string,
  options?: {
    apiKey?: string;
    endpoint?: string;
    fetch?: FetchLike;
  },
): LanguageModel {
  const config = resolveAzureOpenAIResponsesConfig(options);
  const azure = createOpenAI({
    name: 'azure',
    baseURL: config.baseURL,
    // The adapter below replaces the SDK's Bearer header with Azure api-key auth.
    apiKey: 'azure-api-key-auth',
    fetch: createAzureOpenAIFetch(config, options?.fetch),
  });
  return azure.responses(modelId);
}
