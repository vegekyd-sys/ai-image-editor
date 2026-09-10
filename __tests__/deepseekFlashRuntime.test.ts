import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText, type ModelMessage } from 'ai';
import { createAgentModelRuntime, getAgentProviderOptions } from '@/lib/agent-model-runtime';

afterEach(() => vi.unstubAllGlobals());

describe('DeepSeek Flash wire contract', () => {
  it('keeps prior reasoning after a new user turn and sends images natively', async () => {
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-only';
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({
        id: 'completion-test', object: 'chat.completion', created: 1, model: 'deepseek-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Ready', reasoning_content: 'Test reasoning state' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 10 },
      }), { headers: { 'Content-Type': 'application/json' } });
    }));
    try {
      const runtime = createAgentModelRuntime('deepseek-flash', 'wire-test');
      const messages: ModelMessage[] = [{ role: 'user', content: 'Prepare a plan.' }];
      const first = await generateText({ model: runtime.model, messages, providerOptions: getAgentProviderOptions(runtime), maxRetries: 0 });
      await generateText({
        model: runtime.model,
        messages: runtime.normalizeMessages([...messages, ...first.response.messages, {
          role: 'user', content: [
            { type: 'text', text: 'Now inspect this reference.' },
            { type: 'file', data: new URL('https://example.com/reference.png'), mediaType: 'image/png' },
          ],
        }]),
        providerOptions: getAgentProviderOptions(runtime), maxRetries: 0,
      });
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'enabled' }, reasoning_effort: 'high' });
      expect(requests[1].messages.find((m: any) => m.role === 'assistant')).toMatchObject({ reasoning_content: 'Test reasoning state' });
      expect(requests[1].messages.at(-1).content).toContainEqual({ type: 'image_url', image_url: { url: 'https://example.com/reference.png' } });
      expect(first.usage.inputTokenDetails.cacheReadTokens).toBe(10);
    } finally {
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });
});
