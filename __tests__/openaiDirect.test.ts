import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Record<string, unknown>[] = [];
let monthState = { spent_usd: 0, exhausted: false, calls: 0 };
vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; } }),
    rpc: async () => ({ data: [monthState], error: null }),
  }),
}));
vi.mock('@/lib/billing/token-rates', () => ({
  getTokenRate: async (model: string) => model.startsWith('gpt-6-luna')
    ? { input_per_1m: 0.1, output_per_1m: 0.5, cache_read_per_1m: 0.01 }
    : null,
}));

const falGenerate = vi.fn(async () => ({ image: 'data:image/png;base64,FAL', provider: 'fal' }));
vi.mock('@/lib/models/fal-image25', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/models/fal-image25')>();
  return { ...actual, createFalImage25Backend: (id: string) => ({ id, canHandle: () => true, generate: falGenerate }) };
});
vi.mock('@/lib/models/gpt-image-output', () => ({ preserveGptImageOutput: async (buffer: Buffer) => `data:image/gif;base64,${buffer.toString('base64')}` }));

import {
  createOpenAIDirectFetch,
  image26UsageCostUsd,
  isOpenAIDirectBudgetAvailable,
  isOpenAIDirectFallbackError,
  isOpenAIQuotaExhausted,
  openAIDirectMonth,
  refreshOpenAIDirectBudget,
  responsesUsageCostUsd,
  setOpenAIDirectStateForTests,
  isOpenAIDirectAvailable,
} from '@/lib/openai-direct';
import { resolveAgentModelSpecForUser, resolveOpenAIDirectFallbackProvider } from '@/lib/agent-models';
import { shouldFailoverOpenAIDirectToApi } from '@/lib/agent-execution';
import { buildOpenAIImage26Request, createImage26Backend } from '@/lib/models/openai-image26';

const month = openAIDirectMonth();
const fresh = (spentUsd = 0, exhausted = false) => ({ month, spentUsd, exhausted, calls: 0, fetchedAt: Date.now() });

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-test');
  vi.stubEnv('GPT56_AGENT_PROVIDER', 'azure');
  vi.stubEnv('AGENT_MODEL', 'deepseek-flash');
  vi.stubEnv('CODEX_SUBSCRIPTION_OWNER_USER_ID', 'owner');
  vi.stubEnv('FAL_KEY', 'fal-test');
  inserts.length = 0;
  monthState = { spent_usd: 0, exhausted: false, calls: 0 };
  falGenerate.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); setOpenAIDirectStateForTests(null); });

describe('monthly budget gate', () => {
  it('routes to OpenAI only while the current month is under budget minus reserve', () => {
    const opts = { configured: true, month, limitUsd: 195 };
    expect(isOpenAIDirectBudgetAvailable(fresh(0), opts)).toBe(true);
    expect(isOpenAIDirectBudgetAvailable(fresh(194.99), opts)).toBe(true);
    expect(isOpenAIDirectBudgetAvailable(fresh(195), opts)).toBe(false);
    expect(isOpenAIDirectBudgetAvailable(fresh(190), { ...opts, pendingUsd: 6 })).toBe(false);
    expect(isOpenAIDirectBudgetAvailable(fresh(1, true), opts)).toBe(false);
    expect(isOpenAIDirectBudgetAvailable({ ...fresh(0), month: '1999-01' }, opts)).toBe(false);
    expect(isOpenAIDirectBudgetAvailable(null, opts)).toBe(false);
    expect(isOpenAIDirectBudgetAvailable(fresh(0), { ...opts, configured: false })).toBe(false);
  });

  it('uses OPENAI_MONTHLY_BUDGET_USD and the ledger RPC', async () => {
    vi.stubEnv('OPENAI_MONTHLY_BUDGET_USD', '200');
    monthState = { spent_usd: 120.5, exhausted: false, calls: 10 };
    await refreshOpenAIDirectBudget(true);
    expect(isOpenAIDirectAvailable()).toBe(true);
    monthState = { spent_usd: 196, exhausted: false, calls: 11 };
    await refreshOpenAIDirectBudget(true);
    expect(isOpenAIDirectAvailable()).toBe(false);
    vi.stubEnv('OPENAI_DIRECT_ENABLED', 'false');
    expect(isOpenAIDirectAvailable()).toBe(false);
  });

  it('classifies quota refusals separately from ordinary fallback errors', () => {
    expect(isOpenAIQuotaExhausted('429 insufficient_quota You exceeded your current quota')).toBe(true);
    expect(isOpenAIQuotaExhausted('429 rate_limit_exceeded')).toBe(false);
    expect(isOpenAIDirectFallbackError('429 rate_limit_exceeded')).toBe(true);
    expect(isOpenAIDirectFallbackError('400 invalid_value frame_count')).toBe(false);
  });
});

describe('Agent routing priority', () => {
  it('sends paid GPT traffic to direct OpenAI while budget remains, Azure otherwise', () => {
    expect(resolveAgentModelSpecForUser('gpt-6-luna', undefined, 'user', undefined, false, true).provider).toBe('openai');
    expect(resolveAgentModelSpecForUser('gpt-6-sol', undefined, 'user', undefined, false, true).providerModelId).toBe('gpt-6-sol');
    expect(resolveAgentModelSpecForUser('gpt-5.6-terra', undefined, 'user', undefined, false, true).provider).toBe('openai');
    expect(resolveAgentModelSpecForUser('gpt-6-luna', undefined, 'user', undefined, false, false).provider).toBe('azure-openai');
  });

  it('keeps the personal Codex plan first and leaves non-GPT models alone', () => {
    expect(resolveAgentModelSpecForUser('auto', 'gpt-6-luna', 'owner', undefined, true, true).provider).toBe('codex-subscription');
    expect(resolveAgentModelSpecForUser('gpt-6-luna-codex-subscription', undefined, 'other', undefined, false, true).provider).toBe('openai');
    expect(resolveAgentModelSpecForUser('auto', undefined, 'user', undefined, false, true).id).toBe('deepseek-flash');
    expect(resolveAgentModelSpecForUser('grok-4.6', undefined, 'user', undefined, false, true).provider).toBe('openrouter');
  });

  it('honours an explicitly pinned provider (route decision or fallback) over the budget rule', () => {
    setOpenAIDirectStateForTests(fresh(0));
    expect(isOpenAIDirectAvailable()).toBe(true);
    expect(resolveAgentModelSpecForUser('gpt-6-luna', undefined, 'user', 'azure-openai', false).provider).toBe('azure-openai');
    expect(resolveAgentModelSpecForUser('gpt-6-luna', undefined, 'user', undefined, false).provider).toBe('openai');
  });

  it('falls back from direct OpenAI to the configured paid API', () => {
    expect(resolveOpenAIDirectFallbackProvider('azure')).toBe('azure-openai');
    expect(resolveOpenAIDirectFallbackProvider('openrouter')).toBe('openrouter');
  });

  it('durable runs leave direct OpenAI immediately on quota/auth refusals', () => {
    const base = { requestedProvider: 'openai', hasApiFallback: true, previousProviderFailover: false, retryableFailureCount: 1 };
    expect(shouldFailoverOpenAIDirectToApi({ ...base, latestFailureDetail: '429 insufficient_quota' })).toBe(true);
    expect(shouldFailoverOpenAIDirectToApi({ ...base, latestFailureDetail: '401 invalid_api_key' })).toBe(true);
    expect(shouldFailoverOpenAIDirectToApi({ ...base, latestFailureDetail: '503 overloaded' })).toBe(false);
    expect(shouldFailoverOpenAIDirectToApi({ ...base, retryableFailureCount: 9, latestFailureDetail: '503' })).toBe(true);
    expect(shouldFailoverOpenAIDirectToApi({ ...base, hasApiFallback: false, latestFailureDetail: 'insufficient_quota' })).toBe(false);
  });
});

describe('supplier cost', () => {
  it('prices Responses usage with cache reads', () => {
    expect(responsesUsageCostUsd({ input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 400_000 }, output_tokens: 100_000 },
      { input_per_1m: 0.1, output_per_1m: 0.5, cache_read_per_1m: 0.01 })).toBeCloseTo(0.06 + 0.004 + 0.05, 6);
  });

  it('prices GPT Image 2.6 from live usage (edit + GIF probe: 1024 image in, 58 text in, 555 out)', () => {
    expect(image26UsageCostUsd({ input_tokens: 1082, input_tokens_details: { image_tokens: 1024, text_tokens: 58 }, output_tokens: 555 })).toBeCloseTo(0.025132, 6);
  });
});

describe('OpenAI Images request translation', () => {
  it('maps a sticker GIF to OpenAI fields', () => {
    const { path, body } = buildOpenAIImage26Request({ prompt: 'Sticker', aspectRatio: '1:1', outputFormat: 'gif', frameCount: 12, frameDurationMs: 120, gifFrameSize: 'sticker', background: 'opaque' }, 'gpt-image-2.6-flare');
    expect(path).toBe('images/generations');
    expect(body).toMatchObject({ model: 'gpt-image-2.6-flare', size: '512x512', complexity: 'high', quality: 'low', output_format: 'gif', frame_count: 12, frame_duration_ms: 120, background: 'opaque', n: 1 });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('uses images[].image_url for edits and keeps full-size sheet limits', () => {
    const { path, body } = buildOpenAIImage26Request({ prompt: 'Animate', image: 'https://example.com/a.jpg', references: [{ url: 'https://example.com/b.png', role: 'style' }], aspectRatio: '1:1', outputFormat: 'gif', frameCount: 10 }, 'gpt-image-2.6-sunburst');
    expect(path).toBe('images/edits');
    expect(body.images).toEqual([{ image_url: 'https://example.com/a.jpg' }, { image_url: 'https://example.com/b.png' }]);
    expect(body.size).toBe('816x816');
    expect(body.prompt).toContain('Image 2: style');
  });

  it('adds the tracing model for SVG generation', () => {
    const { body, svgModel } = buildOpenAIImage26Request({ prompt: 'Icon', outputFormat: 'svg' }, 'gpt-image-2.6-flare');
    expect(svgModel).toBe('gpt-6-luna');
    expect(body.svg).toEqual({ model: 'gpt-6-luna' });
    expect(body).not.toHaveProperty('images');
  });
});

describe('GPT Image 2.6 provider order', () => {
  const okGif = () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('GIF').toString('base64') }], usage: { input_tokens: 44, input_tokens_details: { text_tokens: 44, image_tokens: 0 }, output_tokens: 555 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_1' } });

  it('uses OpenAI first and records the ledger', async () => {
    const fetcher = vi.fn(async () => okGif());
    vi.stubGlobal('fetch', fetcher);
    const result = await createImage26Backend('gpt-image-2.6-flare').generate({ prompt: 'Sticker', outputFormat: 'gif', gifFrameSize: 'sticker' });
    expect(result.provider).toBe('openai');
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe('https://api.openai.com/v1/images/generations');
    expect(result.usage?.providerCostUsd).toBeCloseTo((44 * 5 + 555 * 30) / 1e6, 8);
    expect(inserts.some(row => row.kind === 'image' && row.model === 'gpt-image-2.6-flare')).toBe(true);
    expect(falGenerate).not.toHaveBeenCalled();
  });

  it('moves to fal on a quota refusal and marks the month exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }), { status: 429, headers: { 'content-type': 'application/json' } })));
    const result = await createImage26Backend('gpt-image-2.6-flare').generate({ prompt: 'Sticker' });
    expect(result.provider).toBe('fal');
    expect(inserts.some(row => row.kind === 'quota_exhausted')).toBe(true);
    expect(isOpenAIDirectAvailable()).toBe(false);
  });

  it('skips OpenAI entirely once the budget is spent', async () => {
    monthState = { spent_usd: 199, exhausted: false, calls: 50 };
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await createImage26Backend('gpt-image-2.6-flare').generate({ prompt: 'Sticker' });
    expect(result.provider).toBe('fal');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never bypasses a content-policy rejection through fal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'moderation_blocked', type: 'image_generation_user_error', message: 'blocked' } }), { status: 400, headers: { 'content-type': 'application/json' } })));
    await expect(createImage26Backend('gpt-image-2.6-flare').generate({ prompt: 'x' })).rejects.toThrow('content checker');
    expect(falGenerate).not.toHaveBeenCalled();
  });
});

describe('Agent usage ledger', () => {
  it('records supplier cost from the terminal Responses stream event without altering the stream', async () => {
    const sse = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"po"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":1000,"input_tokens_details":{"cached_tokens":0},"output_tokens":200}}}\n\n',
    ].join('');
    const fetchImpl = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const response = await createOpenAIDirectFetch(fetchImpl)('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'gpt-6-luna', stream: true }) });
    expect(await response.text()).toBe(sse);
    await new Promise(resolve => setTimeout(resolve, 10));
    const row = inserts.find(item => item.kind === 'agent');
    expect(row).toMatchObject({ model: 'gpt-6-luna', input_tokens: 1000, output_tokens: 200, request_id: 'resp_1' });
    expect(Number(row?.usd)).toBeCloseTo((1000 * 0.1 + 200 * 0.5) / 1e6, 8);
  });

  it('marks the month exhausted when OpenAI refuses for quota', async () => {
    setOpenAIDirectStateForTests(fresh(0));
    const fetchImpl = vi.fn(async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }));
    await createOpenAIDirectFetch(fetchImpl)('https://api.openai.com/v1/responses', { method: 'POST', body: '{"model":"gpt-6-luna"}' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(isOpenAIDirectAvailable()).toBe(false);
  });
});
