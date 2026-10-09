// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const state = vi.hoisted(() => ({ balance: 100, credits: 6, configured: true, enabled: true, free: false, rpc: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/billing/api-keys', () => ({ validateApiKey: async () => ({ userId: 'test-user', keyId: 'test-key' }) }));
vi.mock('@/lib/grok-subscription', () => ({ isGrokSubscriptionAllowedUser: async () => false }));
vi.mock('@/lib/gemini', () => ({ ContentBlockedError: class extends Error {} }));
// Unrelated media tools are outside this image-route integration test.
vi.mock('@/lib/skills/rotate-camera', () => ({ rotateCamera: vi.fn() }));
vi.mock('@/lib/skills/write-video-script', () => ({ writeVideoScript: vi.fn() }));
vi.mock('@/lib/skills/create-video', () => ({ createVideo: vi.fn() }));
vi.mock('@/lib/skills/get-video-status', () => ({ getVideoStatus: vi.fn() }));
vi.mock('@/lib/skills/analyze-video', () => ({ analyzeVideo: vi.fn() }));
vi.mock('@/lib/skills/create-audio', () => ({ createAudio: vi.fn() }));
vi.mock('@/lib/skills/create-music', () => ({ createMusic: vi.fn() }));
vi.mock('@/lib/skills/get-music-status', () => ({ getMusicStatus: vi.fn() }));
vi.mock('@/lib/models', async () => {
  const { nanoBanana21Backend } = await import('@/lib/models/nano-banana-21');
  return { getBackend: (id: string) => id === 'gemini-2.1' ? nanoBanana21Backend : undefined };
});
// Force serverless inline-result mode; never write test images into the worktree.
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  mkdirSync: () => { throw new Error('serverless'); },
  writeFileSync: () => { throw new Error('serverless'); },
}));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  rpc: state.rpc,
  from: (table: string) => {
    const data = table === 'app_settings' ? { value: String(state.enabled) }
      : table === 'credit_balances' ? { balance: state.balance, lifetime_used: 0, lifetime_purchased: 100 }
      : table === 'credit_pricing' ? (state.configured ? ['edit_image_qwen-spicy', 'generate_image_qwen-spicy'].map(tool_name => ({tool_name, credits: state.credits, is_free: state.free, supplier_cost: 0.03})) : [])
      : table === 'token_rates' ? (state.configured ? [{ model_id: 'google/gemini-nano-banana-2.1', markup: 2, input_per_1m: 1.5, output_per_1m: 30, is_active: true }] : []) : null;
    const chain = { data, error: null, select: () => chain, eq: () => chain, order: () => chain, single: async () => ({ data, error: null }) };
    return chain;
  },
}) }));

import { POST } from '@/app/api/mcp/route';
import { invalidateBillingCache } from '@/lib/billing/credits';
import { invalidatePricingCache } from '@/lib/billing/pricing';

async function callNano(model: string | undefined = 'gemini-2.1', aspectRatio = '16:9') {
  const response = await POST(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer mk_live_test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'makaron_edit_image', arguments: { editPrompt: 'A red mug.', model: model === 'auto-omitted' ? undefined : model, aspectRatio, imageResolution: '2K' } } }),
  }));
  return { response, payload: await response.json() };
}

beforeEach(async () => {
  state.balance = 100; state.credits = 6; state.configured = true; state.enabled = true; state.free = false;
  state.rpc.mockReset().mockImplementation(async (name, params) => {
    if (name === 'deduct_and_log') state.balance -= params.p_amount;
    return { data: state.balance, error: null };
  });
  vi.stubEnv('OPENROUTER_API_KEY', 'test-private-key');
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
  state.fetch.mockReset().mockResolvedValue(Response.json({ id: 'nano-test', data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { prompt_tokens: 100, completion_tokens: 1800, cost: 0.0542 } }));
  vi.stubGlobal('fetch', state.fetch);
  invalidatePricingCache(); invalidateBillingCache();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Nano Banana 2.1 MCP → shared skill → provider → billing', () => {
  it('returns decoded output and charges actual cost with MCP attribution once', async () => {
    const { payload, response } = await callNano();
    expect(payload.result.content[0].text).toContain('(model: gemini-2.1)');
    expect(payload.result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(response.headers.get('X-Credits-Remaining')).toBe('89');
    const debits = state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log');
    expect(debits).toHaveLength(1);
    expect(debits[0][1]).toMatchObject({ p_user_id: 'test-user', p_api_key_id: 'test-key', p_source: 'mcp', p_model_used: 'google/gemini-nano-banana-2.1', p_amount: 11, p_input_tokens: 100, p_output_tokens: 1800 });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.fetch.mock.calls[0][1].body).resolution).toBe('2K');
  });
  it('rejects missing exact pricing before a paid call', async () => {
    state.configured = false;
    const { payload } = await callNano();
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toContain('pricing is not configured');
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('rejects insufficient credits before a paid call', async () => {
    state.balance = 5;
    const { payload } = await callNano();
    expect(payload.result.isError).toBe(true);
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('routes an omitted model with panorama and 2K to 2.1 and charges actual cost once', async () => {
    // JSON omits the undefined field, exercising the actual automatic MCP path.
    const { payload } = await callNano('auto-omitted', '8:1');
    expect(payload.result.content[0].text).toContain('(model: gemini-2.1)');
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toMatchObject({ resolution: '2K', aspect_ratio: '8:1' });
    expect(state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log')).toHaveLength(1);
  });

});
