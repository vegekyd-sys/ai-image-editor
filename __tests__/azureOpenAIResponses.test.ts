import { describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import {
  createAzureOpenAIResponsesModel,
  resolveAzureOpenAIResponsesConfig,
} from '@/lib/azure-openai-responses';

const RESPONSE_FIXTURE = {
  id: 'resp_test',
  object: 'response',
  created_at: 1,
  status: 'completed',
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  model: 'gpt-5.6-terra',
  output: [{
    type: 'message',
    id: 'msg_test',
    status: 'completed',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: 'OK',
      annotations: [],
      logprobs: [],
    }],
  }],
  parallel_tool_calls: false,
  previous_response_id: null,
  reasoning: { effort: 'medium', summary: null },
  store: false,
  temperature: null,
  text: { format: { type: 'text' } },
  tool_choice: 'auto',
  tools: [],
  top_p: null,
  truncation: 'disabled',
  usage: {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
  },
  user: null,
  metadata: {},
};

describe('Azure OpenAI Responses adapter', () => {
  it('normalizes the exact preview endpoint without duplicating /responses', () => {
    const config = resolveAzureOpenAIResponsesConfig({
      apiKey: 'test-key',
      endpoint: 'https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
    });
    expect(config.baseURL).toBe('https://resource.openai.azure.com/openai');
    expect(config.endpoint.toString()).toBe(
      'https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
    );
  });

  it('uses api-key auth and sends GPT-5.6 through the Responses API', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(RESPONSE_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const model = createAzureOpenAIResponsesModel('gpt-5.6-terra', {
      apiKey: 'test-secret',
      endpoint: 'https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
      fetch: fakeFetch,
    });

    const result = await generateText({
      model,
      prompt: 'Reply OK',
      providerOptions: {
        azure: {
          parallelToolCalls: false,
          promptCacheKey: 'mk-terra-test-project-hash',
          promptCacheOptions: {
            mode: 'implicit',
            ttl: '30m',
          },
          reasoningEffort: 'medium',
          store: false,
        },
      },
    });

    expect(result.text).toBe('OK');
    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(String(request.input)).toBe(
      'https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
    );
    const headers = new Headers(request.init?.headers);
    expect(headers.get('api-key')).toBe('test-secret');
    expect(headers.has('authorization')).toBe(false);
    const body = JSON.parse(String(request.init?.body));
    expect(body).toMatchObject({
      model: 'gpt-5.6-terra',
      parallel_tool_calls: false,
      prompt_cache_key: 'mk-terra-test-project-hash',
      prompt_cache_options: {
        mode: 'implicit',
        ttl: '30m',
      },
      store: false,
      reasoning: { effort: 'medium' },
    });
  });
});
