// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { runMakaronAgent } from '@/lib/agent';
import { resolvePersistedRunStatus } from '@/lib/agent-terminal';
import { GET } from '@/app/api/agent/run/[id]/route';

const state = vi.hoisted(() => ({
  stream: vi.fn(),
  run: { id: 'run', project_id: 'fixture', user_id: 'owner', status: 'running', metadata: {} },
}));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), streamText: state.stream }));
vi.mock('@/lib/agent-model-runtime', () => ({
  createAgentModelRuntime: () => ({ spec: { id: 'test', provider: 'test' }, normalizeMessages: (messages: unknown) => messages }),
  getAgentProviderOptions: () => ({}), sumOpenRouterProviderCost: () => 0,
}));
vi.mock('@/lib/agent-tools', async original => ({
  ...await original<typeof import('@/lib/agent-tools')>(),
  createTools: () => ({}), logToolSizes: () => 0, getStudioRunCheckpoint: async () => ({}),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateRequest: async () => ({ auth: { userId: 'owner' } }) }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    const result = { data: table === 'agent_runs' ? state.run : [], error: null };
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      single: async () => result, maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => void) => resolve(result),
    };
    return query;
  },
}) }));

it('reports an upstream image payment rejection as a failed polled run after draining model usage', async () => {
  const message = '本次图片服务返回 402。';
  state.stream.mockReturnValue({
    fullStream: [
      { type: 'tool-result', toolName: 'generate_image', toolCallId: 'call', output: {
        success: false, terminal: true, errorCode: 'image_provider_payment_required',
        message: 'provider 402', userMessage: { zh: message },
      } },
      { type: 'finish-step', usage: { inputTokens: 10, outputTokens: 3 } },
      { type: 'finish', finishReason: 'tool-calls' },
    ],
    steps: Promise.resolve([]),
  });
  const events = [];
  for await (const event of runMakaronAgent('Fixture', '', 'fixture', {
    locale: 'zh', execution: { runId: 'run', attemptId: 'attempt', attemptNo: 1, inputEpoch: 0 },
    promptPrefetch: { corePromptMode: Promise.resolve('layered'), systemPrompt: Promise.resolve('test') },
  })) events.push(event);
  const terminal = events.find(event => event.type === 'error');
  expect(terminal).toMatchObject({ code: 'image_provider_payment_required', recoverable: false, message });
  expect(events.some(event => event.type === 'usage')).toBe(true);
  expect(events.some(event => event.type === 'done')).toBe(false);
  expect(state.stream).toHaveBeenCalledOnce();

  state.run.status = resolvePersistedRunStatus({ sawDone: events.some(event => event.type === 'done'), sawError: Boolean(terminal) });
  state.run.metadata = { terminal };
  const response = await GET(new NextRequest('https://example.com/api/agent/run/run?events=true&view=stream'), {
    params: Promise.resolve({ id: 'run' }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'failed', agent_status: 'failed', error: { message } });
});
