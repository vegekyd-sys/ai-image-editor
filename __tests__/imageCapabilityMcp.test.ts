// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ generate: vi.fn(), backend: vi.fn(), requireCredits: vi.fn(), debit: vi.fn(), tokenDebit: vi.fn() }));
vi.mock('@/lib/billing/api-keys', () => ({ validateApiKey: async () => ({ userId: 'test-user', keyId: 'test-key' }) }));
vi.mock('@/lib/billing/credits', () => ({
  isBillingEnabled: async () => true,
  checkBalance: async () => ({ ok: true, balance: 100, cost: 3 }),
  requireCredits: state.requireCredits,
  deductCredits: state.debit,
  deductByTokens: state.tokenDebit,
  recordSubscriptionUsage: vi.fn(),
}));
vi.mock('@/lib/billing/token-rates', () => ({ getTokenRate: async (model_id: string) => ({ model_id, markup: 2 }) }));
vi.mock('@/lib/billing/pricing', () => ({
  getToolPrice: async () => ({ credits: 3, isFree: false }),
  resolveToolName: (_tool: string, model: string) => `generate_image_${model}`,
}));
vi.mock('@/lib/models', () => ({ getBackend: state.backend }));
vi.mock('@/lib/skills/rotate-camera', () => ({ rotateCamera: vi.fn() }));
vi.mock('@/lib/skills/write-video-script', () => ({ writeVideoScript: vi.fn() }));
vi.mock('@/lib/skills/create-video', () => ({ createVideo: vi.fn() }));
vi.mock('@/lib/skills/get-video-status', () => ({ getVideoStatus: vi.fn() }));
vi.mock('@/lib/skills/analyze-video', () => ({ analyzeVideo: vi.fn() }));
vi.mock('@/lib/skills/create-audio', () => ({ createAudio: vi.fn() }));
vi.mock('@/lib/skills/create-music', () => ({ createMusic: vi.fn() }));
vi.mock('@/lib/skills/get-music-status', () => ({ getMusicStatus: vi.fn() }));
vi.mock('fs', async original => ({ ...await original<typeof import('fs')>(), mkdirSync: () => { throw new Error('serverless'); }, writeFileSync: () => { throw new Error('serverless'); } }));

import { POST } from '@/app/api/mcp/route';

async function callImage(args: Record<string, unknown>) {
  const response = await POST(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer mk_live_test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'makaron_edit_image', arguments: { editPrompt: 'A red ceramic mug.', ...args } } }),
  }));
  return { response, payload: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.requireCredits.mockResolvedValue({ ok: true });
  state.debit.mockResolvedValue({ charged: 3, remaining: 97 });
  state.tokenDebit.mockResolvedValue({ charged: 7, remaining: 93 });
  state.generate.mockImplementation(async req => ({ image: 'data:image/png;base64,YQ==', provider: 'supplier',
    ...(req.model !== 'qwen-spicy' ? { usage: { modelId: req.model === 'gemini-2.1' ? 'google/gemini-nano-banana-2.1' : req.model, inputTokens: 4, outputTokens: 5, providerCostUsd: 0.0336 } } : {}),
  }));
  state.backend.mockImplementation(id => ({ id, canHandle: () => true, generate: state.generate }));
});

describe('R16–R19: MCP HTTP → shared image Skill → selected provider → billing', () => {
  it.each([
    [{}, 'gpt-image-2.5-flare', 5],
    [{ aspectRatio: '8:1' }, 'gemini-2.1', 7],
    [{ imageResolution: '4K' }, 'gemini-2.1', 16],
    [{ model: 'gpt-image-2.5-flare', isNsfw: true }, 'qwen-spicy', 3],
    [{ model: 'unknown-model' }, 'gpt-image-2.5-flare', 5],
    [{ background: 'transparent', aspectRatio: '8:1' }, 'gemini-2.1', 7],
  ] as const)('keeps preflight and actual execution aligned for %j', async (args, model, quote) => {
    const { response, payload } = await callImage(args);
    expect(payload.result.isError).not.toBe(true);
    expect(payload.result.content[0].text).toContain(`model: ${model}`);
    expect(state.backend).toHaveBeenCalledExactlyOnceWith(model);
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.generate).toHaveBeenCalledWith(expect.objectContaining({ model }));
    expect(state.requireCredits).toHaveBeenCalledWith('test-user', quote);
    expect(state.tokenDebit.mock.calls.length + state.debit.mock.calls.length).toBe(1);
    expect(response.headers.get('X-Credits-Charged')).toBe(model === 'qwen-spicy' ? '3' : '7');
  });

  it.each([
    { model: 'gpt-image-2.5-flare', aspectRatio: '8:1' },
    { isNsfw: true, image: 'data:image/png;base64,YQ==', aspectRatio: '1:1' },
  ])('relaxes incompatible %j before quoting and submitting', async args => {
    const { payload } = await callImage(args);
    expect(payload.result.isError).not.toBe(true);
    expect(state.requireCredits).toHaveBeenCalledTimes(1);
    expect(state.backend).toHaveBeenCalledTimes(1);
    const expected = args.isNsfw ? 'qwen-spicy' : 'gemini-2.1';
    expect(state.backend).toHaveBeenCalledWith(expected);
    if (args.isNsfw) expect(state.generate.mock.calls[0][0].aspectRatio).toBeUndefined();
    expect(state.tokenDebit.mock.calls.length + state.debit.mock.calls.length).toBe(1);
  });

  it('does not submit or settle when preflight reports insufficient balance', async () => {
    state.requireCredits.mockResolvedValue({ ok: false });
    const { payload } = await callImage({ aspectRatio: '8:1' });
    expect(payload.result.isError).toBe(true);
    expect(state.generate).not.toHaveBeenCalled();
    expect(state.tokenDebit).not.toHaveBeenCalled();
  });

  it('does not retry, switch, or settle after an unknown paid failure', async () => {
    state.generate.mockRejectedValue(new Error('timeout'));
    const { payload } = await callImage({});
    expect(payload.result.isError).toBe(true);
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.backend).toHaveBeenCalledTimes(1);
    expect(state.tokenDebit).not.toHaveBeenCalled();
    expect(state.debit).not.toHaveBeenCalled();
  });
});
