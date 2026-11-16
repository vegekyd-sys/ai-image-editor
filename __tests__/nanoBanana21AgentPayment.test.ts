// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createTools, type AgentContext } from '@/lib/agent-tools';
import { shouldStopAfterTerminalToolFailure } from '@/lib/agent-terminal';

const billing = vi.hoisted(() => ({ check: vi.fn(), debit: vi.fn() }));
vi.mock('@/lib/billing/credits', () => ({
  isBillingEnabled: async () => true, requireCredits: billing.check,
  deductByTokens: billing.debit, deductCredits: billing.debit,
}));
vi.mock('@/lib/billing/token-rates', () => ({
  getTokenRate: async () => ({ model_id: 'google/gemini-nano-banana-2.1', markup: 2 }),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each([false, true])('stops at the upstream 402 after one submission (source edit: %s)', async edit => {
  vi.stubEnv('OPENROUTER_API_KEY', 'fixture');
  billing.check.mockResolvedValue({ ok: true });
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: {
    code: 402, message: 'private provider message', metadata: { limit_source: 'openrouter_in_flight_budget', reason: 'in_flight_budget_exhausted' },
  } }, { status: 402 }));
  vi.stubGlobal('fetch', fetch);
  const source = 'https://example.com/sign.png';
  const ctx: AgentContext = {
    userId: 'fixture', projectId: 'fixture', currentImage: edit ? source : '', explicitMediaIndices: [],
    snapshotImages: edit ? [source] : [], currentSnapshotIndex: edit ? 0 : -1, generatedImages: [],
    preferredModel: edit ? 'gemini-2.1' : undefined, isNsfw: false,
  };
  const tool = createTools(ctx, { spec: { provider: 'test', supportsImageInput: true } } as any).generate_image;
  const prompt = edit ? 'Replace EXIT with 出口 and Café with 咖啡馆. Keep the sign layout.' : 'Create a portrait background without lettering.';
  const result = await (tool.execute as any)({
    editPrompt: prompt, imageResolution: '2K', aspectRatio: '9:16', benignCharacterContent: false,
    ...(edit ? { media_index: 1, model: 'gpt-image-2.6-flare' } : { model: 'gemini-2.1' }),
  }, {});
  expect(billing.check).toHaveBeenCalledWith('fixture', 11);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://openrouter.ai/api/v1/images');
  expect(options.method).toBe('POST');
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ model: 'google/gemini-nano-banana-2.1', n: 1, stream: false, aspect_ratio: '9:16', resolution: '2K' });
  expect(body.prompt).toContain(prompt);
  expect(body.input_references).toEqual(edit ? [{ type: 'image_url', image_url: { url: source } }] : undefined);
  expect(result).toMatchObject({ success: false, errorCode: 'image_provider_payment_required', terminal: true });
  expect(result.message).toContain('openrouter_in_flight_budget');
  expect(result.message).not.toContain('private provider message');
  expect(Object.keys(result.userMessage).sort()).toEqual(['en', 'ja', 'zh', 'zh-Hant']);
  expect(shouldStopAfterTerminalToolFailure({ toolResults: [{ toolName: 'generate_image', output: result }] })).toBe(true);
  expect(ctx.isNsfw).toBe(false);
  expect(ctx.generatedImages).toHaveLength(0);
  expect(billing.debit).not.toHaveBeenCalled();
});
