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
  const { wanImageBackend } = await import('@/lib/models/wan-image');
  return { getBackend: (id: string) => id === 'wan2.7-image' ? wanImageBackend : undefined };
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
      : table === 'credit_pricing' ? (state.configured ? [{ tool_name: 'edit_image_wan2.7-image', credits: state.credits, is_free: state.free, supplier_cost: 0.03 }] : [])
      : null;
    const chain = { data, error: null, select: () => chain, eq: () => chain, single: async () => ({ data, error: null }) };
    return chain;
  },
}) }));

import { POST } from '@/app/api/mcp/route';
import { deductCredits, invalidateBillingCache } from '@/lib/billing/credits';
import { invalidatePricingCache } from '@/lib/billing/pricing';

async function callWan() {
  const response = await POST(new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { Authorization: 'Bearer mk_live_test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'makaron_edit_image', arguments: { editPrompt: 'A red mug.', model: 'wan2.7-image', aspectRatio: '16:9' } } }),
  }));
  return { response, payload: await response.json() };
}

beforeEach(async () => {
  state.balance = 100; state.credits = 6; state.configured = true; state.enabled = true; state.free = false;
  state.rpc.mockReset().mockImplementation(async (name, params) => {
    if (name === 'deduct_and_log') state.balance -= params.p_amount;
    return { data: state.balance, error: null };
  });
  vi.stubEnv('DASHSCOPE_API_KEY', 'test-private-key');
  vi.stubEnv('DASHSCOPE_API_HOST', 'ws-example.ap-southeast-1.maas.aliyuncs.com');
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
  state.fetch.mockReset()
    .mockResolvedValueOnce(Response.json({ request_id: 'test-1', output: { finished: true, choices: [{ message: { content: [{ image: 'https://dashscope-test.oss-ap-southeast-1.aliyuncs.com/image.png' }] } }] }, usage: { image_count: 1, input_tokens: 30000, output_tokens: 50000 } }))
    .mockResolvedValueOnce(new Response(new Uint8Array(png)));
  vi.stubGlobal('fetch', state.fetch);
  invalidatePricingCache(); invalidateBillingCache();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Wan MCP → shared skill → provider → billing', () => {
  it('charges exactly 6 credits after decoded output, not token counters', async () => {
    const { payload, response } = await callWan();
    expect(payload.result.content[0].text).toContain('(model: wan2.7-image)');
    expect(payload.result.content[1].type).toBe('image');
    expect(response.headers.get('X-Credits-Remaining')).toBe('94');
    const debits = state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log');
    expect(debits).toHaveLength(1);
    expect(debits[0][1]).toMatchObject({ p_user_id: 'test-user', p_api_key_id: 'test-key', p_source: 'mcp', p_tool_name: 'edit_image_wan2.7-image', p_model_used: 'wan2.7-image', p_amount: 6, p_input_tokens: null, p_output_tokens: null });
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects an insufficient balance before a paid provider request', async () => {
    state.balance = 5;
    const { payload } = await callWan();
    expect(payload.result.content[0].text).toContain('Need 6, have 5');
    expect(payload.result.isError).toBe(true);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log')).toHaveLength(0);
  });

  it('does not debit or retry rejected generation', async () => {
    state.fetch.mockReset().mockResolvedValueOnce(Response.json({ code: 'Rejected', message: 'test-private-key' }, { status: 400 }));
    const { payload } = await callWan();
    expect(payload.result.content[0].text).toContain('HTTP 400');
    expect(payload.result.isError).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('test-private-key');
    expect(state.balance).toBe(100);
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not debit if the generated image cannot be downloaded', async () => {
    state.fetch.mockReset().mockResolvedValueOnce(Response.json({ output: { choices: [{ message: { content: [{ image: 'https://dashscope-test.oss-ap-southeast-1.aliyuncs.com/image.png' }] } }] }, usage: { image_count: 1 } })).mockResolvedValueOnce(new Response('', { status: 503 }));
    const { payload } = await callWan();
    expect(payload.result.content[0].text).toContain('download failed');
    expect(state.balance).toBe(100);
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not become free before the pricing migration has run', async () => {
    state.configured = false;
    await callWan();
    expect(state.balance).toBe(94);
  });

  it('uses the same administrator-controlled rate for preflight and debit', async () => {
    state.credits = 8;
    await callWan();
    expect(state.balance).toBe(92);
  });

  it('records App fixed-price image use with actual model and no API-key identity', async () => {
    const result = await deductCredits('test-user', null, 'edit_image', 'wan2.7-image', 9000);
    expect(result).toEqual({ charged: 6, remaining: 94 });
    expect(state.rpc).toHaveBeenCalledWith('deduct_and_log', expect.objectContaining({ p_source: 'app', p_api_key_id: null, p_model_used: 'wan2.7-image', p_duration_ms: 9000 }));
  });

  it.each(['kill-switch', 'admin-free'])('respects %s consistently during preflight and debit', async (mode) => {
    state.balance = 0;
    if (mode === 'kill-switch') state.enabled = false;
    else state.free = true;
    const { payload } = await callWan();
    expect(payload.result.content[1].type).toBe('image');
    expect(state.balance).toBe(0);
    expect(state.rpc.mock.calls.filter(([name]) => name === 'deduct_and_log')).toHaveLength(0);
  });
});
