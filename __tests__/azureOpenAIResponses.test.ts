import { describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import {
  createAzureOpenAIResponsesModel,
  resolveAzureOpenAIResponsesConfig,
} from '@/lib/azure-openai-responses';
import { buildTypedCompactionMessage } from '@/lib/agent-execution';

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

const COMPACTION_RESPONSE_FIXTURE = {
  ...RESPONSE_FIXTURE,
  id: 'resp_compaction',
  output: [
    {
      type: 'compaction',
      id: 'cmp_test',
      encrypted_content: 'encrypted-compaction-state',
    },
    ...RESPONSE_FIXTURE.output,
  ],
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

  it('round-trips an encrypted compaction item through AI SDK response messages', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(COMPACTION_RESPONSE_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const model = createAzureOpenAIResponsesModel('gpt-5.6-terra', {
      apiKey: 'test-secret',
      endpoint: 'https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
      fetch: fakeFetch,
    });
    const providerOptions = {
      azure: {
        store: false,
        contextManagement: [{ type: 'compaction' as const, compactThreshold: 650_000 }],
      },
    };

    const first = await generateText({
      model,
      prompt: 'Begin a long task',
      providerOptions,
    });
    expect(JSON.stringify(first.responseMessages)).toContain('openai.compaction');
    expect(JSON.stringify(first.responseMessages)).toContain('encrypted-compaction-state');

    await generateText({
      model,
      messages: [
        { role: 'user', content: 'Begin a long task' },
        ...first.responseMessages,
        { role: 'user', content: 'Continue' },
      ],
      providerOptions,
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      context_management: [{ type: 'compaction', compact_threshold: 650_000 }],
    });
    expect(bodies[1].input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'compaction',
        id: 'cmp_test',
        encrypted_content: 'encrypted-compaction-state',
      }),
    ]));
  });

  it('replays the durable snapshot compaction shape as an Azure Responses input item', async () => {
    let body: Record<string, any> = {};
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(RESPONSE_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const model = createAzureOpenAIResponsesModel('gpt-5.6-sol', {
      apiKey: 'test-secret',
      endpoint: 'https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
      fetch: fakeFetch,
    });
    const compacted = buildTypedCompactionMessage({
      version: 1,
      objective: 'Long task',
      acceptanceCriteria: [],
      decisions: [],
      completedWork: [],
      artifacts: [],
      openQuestions: [],
      currentWorkUnit: 'agent',
      nextAction: 'Continue',
      providerCompaction: {
        provider: 'openai',
        modelId: 'gpt-5.6-sol',
        item: {
          kind: 'openai.compaction',
          providerKey: 'azure',
          itemId: 'cmp_durable',
          encryptedContent: 'durable-encrypted-state',
        },
      },
    }, 'gpt-5.6-sol');
    expect(compacted).not.toBeNull();

    await generateText({
      model,
      messages: [
        compacted!,
        { role: 'user', content: 'Continue from the compacted state' },
      ],
      providerOptions: { azure: { store: false } },
    });

    expect(body.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'compaction',
        id: 'cmp_durable',
        encrypted_content: 'durable-encrypted-state',
      }),
    ]));
  });
});
