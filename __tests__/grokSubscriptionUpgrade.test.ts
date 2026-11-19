import { APICallError } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';
import { runMakaronAgent } from '@/lib/agent';

const { streamText, createAgentModelRuntime } = vi.hoisted(() => ({
  streamText: vi.fn(),
  createAgentModelRuntime: vi.fn(() => ({
    spec: { provider: 'grok-subscription', id: 'grok-4.6' },
    normalizeMessages: (messages: unknown) => messages,
  })),
}));
vi.mock('ai', async importActual => ({ ...await importActual<typeof import('ai')>(), streamText }));
vi.mock('@/lib/agent-tools', () => ({
  createTools: () => ({}),
  logToolSizes: () => 0,
  getStudioRunCheckpoint: async () => ({}),
}));
vi.mock('@/lib/agent-model-runtime', () => ({
  createAgentModelRuntime,
  getAgentProviderOptions: () => ({}),
  sumOpenRouterProviderCost: () => 0,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it.each([true, false])('reports a terminal Grok upgrade rejection with durable=%s', async durable => {
  vi.stubEnv('OPENROUTER_API_KEY', 'fixture');
  streamText.mockReturnValue({
    fullStream: [{
      type: 'error',
      error: new APICallError({
        message: 'Upgrade Required',
        url: 'https://example.test/chat/completions',
        requestBodyValues: {},
        statusCode: 426,
        isRetryable: false,
      }),
    }],
    steps: Promise.resolve([]),
  });
  const events = [];
  for await (const event of runMakaronAgent('Continue', '', 'fixture', {
    agentProvider: 'grok-subscription',
    locale: 'en',
    execution: durable ? { runId: 'run', attemptId: 'attempt', attemptNo: 1, inputEpoch: 0 } : undefined,
    promptPrefetch: { corePromptMode: Promise.resolve('layered'), systemPrompt: Promise.resolve('test') },
  })) events.push(event);

  expect(events.at(-1)).toMatchObject({
    type: 'error',
    code: 'grok_subscription_upgrade_required',
    recoverable: false,
    message: expect.stringContaining('Automatic retries have stopped'),
  });
  expect(streamText).toHaveBeenCalledTimes(1);
  expect(createAgentModelRuntime).toHaveBeenCalledTimes(1);
});
