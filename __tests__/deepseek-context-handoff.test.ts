import { expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import { runMakaronAgent } from '../src/lib/agent';

const stream = vi.hoisted(() => vi.fn());
vi.mock('ai', async importActual => ({ ...await importActual<typeof import('ai')>(), streamText: stream }));
vi.mock('../src/lib/agent-tools', () => ({
  createTools: () => ({}), logToolSizes: () => 0, getStudioRunCheckpoint: async () => ({}),
}));
vi.mock('../src/lib/agent-model-runtime', () => ({
  createAgentModelRuntime: () => ({ spec: { provider: 'deepseek', id: 'deepseek-v4-pro' }, normalizeMessages: (m: unknown) => m }),
  getAgentProviderOptions: () => ({}), sumOpenRouterProviderCost: () => 0,
}));
const file = 'old version\n'.repeat(950);
const history: ModelMessage[] = [
  { role: 'assistant', content: [{ type: 'tool-call', toolName: 'read_file', toolCallId: 'a', input: { path: 'script' } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolName: 'read_file', toolCallId: 'a', output: { type: 'text', value: '[script]\n\n' + file } }] },
  ...Array.from({ length: 25 }, (_, i): ModelMessage => ({ role: 'user', content: String(i) })),
];
async function attempt(recover: boolean, rows = history) {
  const events = [];
  for await (const e of runMakaronAgent('Continue', '', 'fixture', {
    agentProvider: 'deepseek', history: rows, recoverDeepSeekHistory: recover, locale: 'en',
    execution: { runId: 'test', attemptId: 'attempt', attemptNo: recover ? 2 : 1, inputEpoch: 0 },
    promptPrefetch: { corePromptMode: Promise.resolve('layered'), systemPrompt: Promise.resolve('test') },
  })) events.push(e);
  return events;
}
const reject = { type: 'error', error: Object.assign(new Error(
  "This model's maximum context length is 1048576 tokens. However, you requested 1086949 tokens.",
), { statusCode: 400 }) };
const response = (event: unknown) => ({ fullStream: [event], steps: Promise.resolve([]) });

it('only hands off an overflow when the next durable request can differ, and stops after another rejection', async () => {
  stream.mockReset().mockReturnValue(response(reject));
  expect(await attempt(false)).toContainEqual(expect.objectContaining({ code: 'context_length_exceeded', recoverable: true }));
  expect(stream.mock.calls[0][0].messages[1]).toEqual(history[1]);
  expect(await attempt(true)).toContainEqual(expect.objectContaining({ code: 'context_length_exceeded', recoverable: false }));
  expect(await attempt(false, [])).toContainEqual(expect.objectContaining({ code: 'context_length_exceeded', recoverable: false }));
  expect(stream).toHaveBeenCalledTimes(3);
});

it('respects a successful stop on the recovered request', async () => {
  stream.mockReset().mockReturnValue(response({ type: 'finish', finishReason: 'stop' }));
  expect(await attempt(true)).toContainEqual(expect.objectContaining({ type: 'done' }));
  expect(stream).toHaveBeenCalledTimes(1);
});
