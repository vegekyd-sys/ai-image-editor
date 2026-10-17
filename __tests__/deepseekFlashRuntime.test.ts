import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText, type ModelMessage } from 'ai';
import { createAgentModelRuntime, getAgentProviderOptions } from '@/lib/agent-model-runtime';
import { normalizeDeepSeekToolVision } from '@/lib/deepseek-tool-vision';

afterEach(() => vi.unstubAllGlobals());

describe('DeepSeek Flash wire contract', () => {
  it('sends preview/read_file tool images as native images after all tool results, without base64 text', async () => {
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-only';
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const requests: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({
        id: 'vision-wire', object: 'chat.completion', created: 1, model: 'deepseek-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Ready', reasoning_content: 'Checked' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      }), { headers: { 'Content-Type': 'application/json' } });
    }));
    const history: ModelMessage[] = [
      { role: 'user', content: 'Inspect the preview and source.' },
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'Need both images.' },
        { type: 'tool-call', toolCallId: 'a', toolName: 'preview_frame', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'read_file', input: {} },
      ] },
      ...['a', 'b'].map((id): ModelMessage => ({ role: 'tool', content: [{
        type: 'tool-result', toolCallId: id, toolName: id === 'a' ? 'preview_frame' : 'read_file',
        output: { type: 'content', value: [
          { type: 'text', text: `Evidence ${id}` },
          { type: 'file', mediaType: 'image/png', data: { type: 'data', data: png } },
        ] },
      }] })),
    ];
    try {
      const runtime = createAgentModelRuntime('deepseek-flash', 'vision-wire');
      // Control reproduces the current upstream SDK's image-as-text behavior.
      await generateText({ model: runtime.model, messages: history, providerOptions: getAgentProviderOptions(runtime), maxRetries: 0 });
      expect(requests[0].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content).join('')).toContain(png);
      const normalized = runtime.normalizeMessages(history);
      expect(normalizeDeepSeekToolVision(normalized)).toEqual(normalized);
      await generateText({ model: runtime.model, messages: normalized, providerOptions: getAgentProviderOptions(runtime), maxRetries: 0 });
      const wire = requests[1].messages;
      expect(wire.map((m: any) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
      expect(wire.filter((m: any) => m.role === 'tool').map((m: any) => m.content).join('')).not.toContain(png);
      expect(wire.at(-1).content.filter((p: any) => p.type === 'image_url')).toHaveLength(2);
      expect(wire.at(-1).content.find((p: any) => p.type === 'image_url').image_url.url).toBe(`data:image/png;base64,${png}`);
      expect(wire[2].content).toContain('Evidence a');
      expect(wire[3].content).toContain('Evidence b');
      expect(history[2]).toMatchObject({ content: [{ output: { value: [{ type: 'text' }, { type: 'file' }] } }] });
    } finally {
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

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
