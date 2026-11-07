// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeVideoWithRouting, canonicalVideoRelayJson, videoRelaySignature } from '@/lib/gemini-video-subscription';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), api: vi.fn(), members: vi.fn(), identity: vi.fn() }));
vi.mock('@/lib/codex-subscription-allowlist', () => ({ getDynamicCodexSubscriptionAllowedUserIds: mocks.members }));
vi.mock('@/lib/google-relay-identity', () => ({ getGeminiCloudIdentity: mocks.identity }));
vi.mock('@/lib/admin', () => ({ isAdmin: mocks.admin }));
vi.mock('@/lib/video-analysis', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/video-analysis')>(), analyzeVideoWithProvider: mocks.api,
}));
const media = 'https://cdn.makaron.app/storage/v1/object/public/images/video.mp4?token=private-source';
const secret = 'private-test-secret-32-characters-long';

function status() {
  return {
    available: true, quota_exhausted: false, capabilities: ['makaron_video_analysis'],
    makaron_video_analysis: {
      version: 1, model: 'gemini-3.8-flash', processing: 'static', thinking: 'low',
      input: 'cloud-source-url', output: 'text', source_unmodified: true, max_source_bytes: 38_500_000,
    },
    quota: { checked_at: Date.now() / 1000, buckets: ['gemini-weekly', 'gemini-5h'].map(id => ({
      id, remaining_fraction: .8, reset_time: new Date(Date.now() + 3600_000).toISOString(),
    })) },
  };
}

function receipt(payload: Record<string, unknown>) {
  return {
    request_sha256: createHash('sha256').update(canonicalVideoRelayJson(payload)).digest('hex'),
    requested_model: 'gemini-3.8-flash', model: 'gemini-3.8-flash-n', account_model: 'gemini-3.8-flash-medium',
    transport: 'antigravity-native-account', billing: 'subscription-allowance', consumed_credits: 0, allowance_only: true, paid_credit_status: 'reported_zero',
    finish_reason: 'STOP', processing: 'static', thinking: 'low', generator_submissions: 1,
    media_on_v: false, analysis: 'At 4 seconds the blue circle moves right.',
    source: {
      prepared: false, source_bytes: 12345, input_bytes: 12345,
      source_sha256: 'a'.repeat(64), input_sha256: 'a'.repeat(64), duration_seconds: 8,
    },
    usage: { promptTokenCount: 123, candidatesTokenCount: 24, thoughtsTokenCount: 11 },
  };
}

function liveMock(overrides?: (result: ReturnType<typeof receipt>) => void) {
  let payload: Record<string, unknown>;
  const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
    if (init.method === 'POST') {
      payload = JSON.parse(String(init.body));
      return Response.json({ state: 'ACCEPTED', job_id: payload.job_id }, { status: 202 });
    }
    if (String(_url).endsWith('/v1/status')) return Response.json(status());
    const result = receipt(payload);
    overrides?.(result);
    return Response.json({ state: 'SUCCEEDED', job_id: payload.job_id, result });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubEnv('GEMINI_VIDEO_RELAY_ENABLED', 'true');
  vi.stubEnv('GEMINI_VIDEO_RELAY_URL', 'https://relay.example/prefix');
  vi.stubEnv('GEMINI_VIDEO_RELAY_SECRET', secret);
  vi.stubEnv('GEMINI_VIDEO_RELAY_OWNER_ID', 'verified-service-owner');
  vi.stubEnv('VIDEO_ANALYSIS_MODEL', '');
  vi.stubEnv('VIDEO_ANALYSIS_PROCESSING', 'static');
  mocks.admin.mockResolvedValue(true);
  mocks.members.mockResolvedValue(['admin']);
  mocks.identity.mockResolvedValue('mock-iam-identity-token-32-characters');
  mocks.api.mockImplementation(async () => ({
    analysis: 'API result', usedModel: 'gemini-3.8-flash', requestedModel: 'gemini-3.8-flash',
    reportedModel: 'gemini-3.8-flash', provider: 'google-api', billing: 'api',
    processing: 'static', thinking: 'low', transport: 'inline', elapsedMs: 1, processingCalls: 0,
    usage: { modelId: 'gemini-3.8-flash', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, thoughtTokens: 0, toolUseTokens: 0 },
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('administrator video subscription routing', () => {
  it.each([undefined, 'ordinary-user'])('keeps anonymous and ordinary callers on API (%s)', async userId => {
    mocks.admin.mockResolvedValue(false);
    const fetch = liveMock();
    expect((await analyzeVideoWithRouting(media, 'Question', userId)).provider).toBe('google-api');
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.api).toHaveBeenCalledOnce();
  });

  it('is disabled by default and does not query the admin roster', async () => {
    vi.stubEnv('GEMINI_VIDEO_RELAY_ENABLED', '');
    const fetch = liveMock();
    await analyzeVideoWithRouting(media, undefined, 'admin');
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on admin-query failure without sending media to the relay', async () => {
    mocks.admin.mockRejectedValue(new Error('DB unavailable'));
    const fetch = liveMock();
    const result = await analyzeVideoWithRouting(media, undefined, 'admin');
    expect(result.fallbackReason).toBe('admin_check_unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds a slow admin query and never grants access on its late result', async () => {
    vi.useFakeTimers();
    let finish: (value: boolean) => void;
    mocks.admin.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const fetch = liveMock();
    const call = analyzeVideoWithRouting(media, undefined, 'admin');
    await vi.advanceTimersByTimeAsync(1500);
    expect((await call).fallbackReason).toBe('admin_check_unavailable');
    finish!(true);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.api).toHaveBeenCalledOnce();
  });

  it.each(['http://cdn.makaron.app/storage/v1/object/x', 'https://unrelated.example/private.mp4', 'https://localhost/private'])('does not forward unsupported source %s', async source => {
    const fetch = liveMock();
    const result = await analyzeVideoWithRouting(source, undefined, 'admin');
    expect(result.fallbackReason).toBe('relay_source_unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['http://public-relay.example', 'https://relay.example/?secret=x', 'https://user:password@relay.example'])('rejects unsafe relay configuration %s', async url => {
    vi.stubEnv('GEMINI_VIDEO_RELAY_URL', url);
    const fetch = liveMock();
    const result = await analyzeVideoWithRouting(media, undefined, 'admin');
    expect(result.fallbackReason).toBe('relay_not_configured');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['agentic', 'model-override'])('keeps an unsupported explicit recipe on its existing API (%s)', async mode => {
    if (mode === 'agentic') vi.stubEnv('VIDEO_ANALYSIS_PROCESSING', mode);
    else vi.stubEnv('VIDEO_ANALYSIS_MODEL', 'gemini-custom');
    const fetch = liveMock();
    expect((await analyzeVideoWithRouting(media, undefined, 'admin')).fallbackReason).toBe('relay_recipe_unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires the separate Makaron contract, never infers compatibility from Scene video support', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...status(), capabilities: ['video_analysis'] }));
    vi.stubGlobal('fetch', fetch);
    expect((await analyzeVideoWithRouting(media, undefined, 'admin')).fallbackReason).toBe('relay_contract_unavailable');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('requires fresh quota rather than a stale healthy status', async () => {
    const value = status(); value.quota.checked_at -= 121;
    const fetch = vi.fn().mockResolvedValue(Response.json(value)); vi.stubGlobal('fetch', fetch);
    expect((await analyzeVideoWithRouting(media, undefined, 'admin')).fallbackReason).toBe('quota_unavailable');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('returns verified actual model and token categories, sends only signed metadata', async () => {
    const fetch = liveMock();
    const result = await analyzeVideoWithRouting(media, 'What happens at 4 seconds? 请用中文。', 'admin');
    expect(result).toMatchObject({ provider: 'gemini-subscription', billing: 'subscription-allowance',
      requestedModel: 'gemini-3.8-flash', usedModel: 'gemini-3.8-flash-n', sourceDurationSeconds: 8,
      usage: { inputTokens: 123, outputTokens: 35, thoughtTokens: 11 } });
    expect(mocks.api).not.toHaveBeenCalled();
    const init = fetch.mock.calls[1][1];
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ source_url: media, question: 'What happens at 4 seconds? 请用中文。', processing: 'static', thinking: 'low' });
    expect(String(init.body)).not.toContain('inlineData');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-scene-relay-signature']).toBe(videoRelaySignature({ method: 'POST', path: '/prefix/v1/makaron-video-jobs',
      timestamp: headers['x-scene-relay-timestamp'], requestId: headers['x-scene-relay-request-id'],
      owner: 'verified-service-owner', body: String(init.body), secret }));
  });

  it.each(['model', 'billing', 'hash', 'credits', 'truncated', 'prepared', 'source', 'missing-usage'])('never charges API after an unverified terminal result (%s)', async failure => {
    liveMock(result => {
      if (failure === 'model') result.model = 'gemini-3.6-flash';
      if (failure === 'billing') result.billing = 'api';
      if (failure === 'hash') result.request_sha256 = 'wrong';
      if (failure === 'credits') result.consumed_credits = 1;
      if (failure === 'truncated') result.finish_reason = 'MAX_TOKENS';
      if (failure === 'prepared') result.source.prepared = true;
      if (failure === 'source') result.source.input_sha256 = 'b'.repeat(64);
      if (failure === 'missing-usage') result.usage = {} as typeof result.usage;
    });
    await expect(analyzeVideoWithRouting(media, undefined, 'admin')).rejects.toThrow('unverified_relay_receipt');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('recovers a lost POST acknowledgement by polling the same ID without re-submission', async () => {
    let payload: Record<string, unknown>;
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'POST') { payload = JSON.parse(String(init.body)); throw new Error('Lost ACK'); }
      if (String(url).endsWith('/v1/status')) return Response.json(status());
      expect(String(url)).toContain(String(payload.job_id));
      return Response.json({ state: 'SUCCEEDED', job_id: payload.job_id, result: receipt(payload) });
    });
    vi.stubGlobal('fetch', fetch);
    expect((await analyzeVideoWithRouting(media, undefined, 'admin')).provider).toBe('gemini-subscription');
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('ends an unknown running job without another POST or API call when its budget expires', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 120_000
      ? controller.signal : new AbortController().signal);
    let jobId: string;
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'POST') { jobId = JSON.parse(String(init.body)).job_id; return Response.json({ state: 'ACCEPTED', job_id: jobId }); }
      if (String(url).endsWith('/v1/status')) return Response.json(status());
      controller.abort();
      return Response.json({ state: 'RUNNING', job_id: jobId });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(analyzeVideoWithRouting(media, undefined, 'admin')).rejects.toThrow('relay_unknown_outcome');
      expect(fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
      expect(mocks.api).not.toHaveBeenCalled();
    } finally { timeout.mockRestore(); }
  });

  it.each([0, 1])('permits API only for a terminal pre-generation rejection (submissions=%s)', async submissions => {
    let jobId: string;
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'POST') { jobId = JSON.parse(String(init.body)).job_id; return Response.json({ state: 'ACCEPTED', job_id: jobId }); }
      if (String(url).endsWith('/v1/status')) return Response.json(status());
      return Response.json({ state: 'FAILED', job_id: jobId, error: 'native_capacity_unavailable', generator_submissions: submissions });
    }));
    const call = analyzeVideoWithRouting(media, undefined, 'admin');
    if (!submissions) {
      expect((await call).fallbackReason).toBe('native_capacity_unavailable');
      expect(mocks.api).toHaveBeenCalledOnce();
    } else {
      await expect(call).rejects.toThrow('native_capacity_unavailable');
      expect(mocks.api).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])('requires explicit no-submission proof in admission errors (%s)', async proof => {
    let payload: Record<string, unknown>;
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'POST') {
        payload = JSON.parse(String(init.body));
        return Response.json({ error: 'relay_busy', ...(proof ? { generator_submissions: 0 } : {}) }, { status: 503 });
      }
      if (String(url).endsWith('/v1/status')) return Response.json(status());
      return Response.json({ state: 'SUCCEEDED', job_id: payload.job_id, result: receipt(payload) });
    }));
    const result = await analyzeVideoWithRouting(media, undefined, 'admin');
    expect(result.provider).toBe(proof ? 'google-api' : 'gemini-subscription');
    expect(mocks.api).toHaveBeenCalledTimes(proof ? 1 : 0);
  });

  it('does not bypass content blocking through a different provider', async () => {
    let jobId: string;
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'POST') { jobId = JSON.parse(String(init.body)).job_id; return Response.json({ state: 'ACCEPTED', job_id: jobId }); }
      if (String(url).endsWith('/v1/status')) return Response.json(status());
      return Response.json({ state: 'FAILED', job_id: jobId, error: 'SAFETY', generator_submissions: 1 });
    }));
    await expect(analyzeVideoWithRouting(media, undefined, 'admin')).rejects.toThrow('relay_terminal_failure');
    expect(mocks.api).not.toHaveBeenCalled();
  });
});

it('signs canonical UTF-8 JSON using the deployed Scene HMAC algorithm', () => {
  const body = canonicalVideoRelayJson({ z: '中文', a: { y: 1, b: false } });
  expect(body).toBe('{"a":{"b":false,"y":1},"z":"中文"}');
  const expected = createHmac('sha256', secret).update([
    'POST', '/v1/makaron-video-jobs', '123', 'request-id', 'owner', createHash('sha256').update(body).digest('hex'),
  ].join('\n')).digest('hex');
  expect(videoRelaySignature({ method: 'POST', path: '/v1/makaron-video-jobs', timestamp: '123', requestId: 'request-id', owner: 'owner', body, secret })).toBe(expected);
});

describe('Google membership and honest paid-credit metadata', () => {
  it('requires a listed administrator, rather than automatically allowing all admins', async () => {
    mocks.members.mockResolvedValue(['someone-else']);
    const fetch = liveMock();
    expect((await analyzeVideoWithRouting(media, 'Q', 'admin')).provider).toBe('google-api');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts explicitly unreported paid-credit telemetry only with an allowance-only account receipt', async () => {
    liveMock(r => { r.consumed_credits = null as unknown as number; r.paid_credit_status = 'not_reported'; });
    expect(await analyzeVideoWithRouting(media, 'Q', 'admin')).toMatchObject({provider:'gemini-subscription',subscriptionPaidCreditStatus:'not_reported',subscriptionConsumedCredits:null});
    liveMock(r => { r.allowance_only = false; });
    await expect(analyzeVideoWithRouting(media,'Q','admin')).rejects.toThrow('unverified_relay_receipt');
  });
  it('falls back before job submission if Cloud IAM cannot be minted', async () => {
    mocks.identity.mockRejectedValueOnce(new Error('WIF rejected'));
    const fetch = liveMock();
    expect((await analyzeVideoWithRouting(media, 'Q', 'admin')).fallbackReason).toBe('cloud_identity_unavailable');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it('uses bounded receipt waits without adding the legacy polling sleep or another POST', async () => {
  const timer=vi.spyOn(globalThis,'setTimeout');
  let payload:Record<string,unknown>={};let reads=0;
  const f=vi.fn(async(url:URL,init:RequestInit)=>{
    if(String(url).endsWith('/v1/status'))return Response.json(status());
    if(init.method==='POST'){payload=JSON.parse(String(init.body));return Response.json({state:'ACCEPTED',job_id:payload.job_id});}
    expect(init.headers).toMatchObject({'x-makaron-wait-ms':'1000'});
    if(++reads<3)return Response.json({job_id:payload.job_id,state:'RUNNING',poll_after_ms:0});
    return Response.json({job_id:payload.job_id,state:'SUCCEEDED',result:receipt(payload)});
  });vi.stubGlobal('fetch',f);
  expect((await analyzeVideoWithRouting(media,'Q','admin')).provider).toBe('gemini-subscription');
  expect(timer.mock.calls.filter(call=>call[1]===500)).toHaveLength(0);
  expect(f.mock.calls.filter(call=>call[1].method==='POST')).toHaveLength(1);
  timer.mockRestore();
});
