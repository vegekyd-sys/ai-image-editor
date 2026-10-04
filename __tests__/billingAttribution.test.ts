import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/service', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom, rpc: mockRpc }),
}));

const billingSettingsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: { value: 'true' }, error: null }),
};

function rpcCalls(name: string) {
  return mockRpc.mock.calls.filter(([rpcName]) => rpcName === name).map(([, params]) => params);
}

describe('billing attribution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'app_settings') return billingSettingsChain;
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });
    mockRpc.mockResolvedValue({ data: 100, error: null });
  });

  it('tags debits with the ambient run, project, source and api key', async () => {
    const { deductFixedCredits, runWithBillingAttribution } = await import('@/lib/billing/credits');

    await runWithBillingAttribution(
      { runId: 'run-1', projectId: 'project-1', source: 'cli', apiKeyId: 'key-1' },
      () => deductFixedCredits('user-1', 22, 'create_video', 'kling-v3-omni'),
    );

    expect(rpcCalls('deduct_and_log')).toEqual([expect.objectContaining({
      p_user_id: 'user-1',
      p_amount: 22,
      p_run_id: 'run-1',
      p_project_id: 'project-1',
      p_source: 'cli',
      p_api_key_id: 'key-1',
    })]);
  });

  it('propagates through fire-and-forget dynamic import chains', async () => {
    const { runWithBillingAttribution } = await import('@/lib/billing/credits');

    await runWithBillingAttribution({ runId: 'run-2', projectId: 'project-2', source: 'api' }, () =>
      import('@/lib/billing/credits').then(({ deductFixedCredits }) => deductFixedCredits('user-1', 2, 'rotate_camera')),
    );

    expect(rpcCalls('deduct_and_log')).toEqual([expect.objectContaining({
      p_tool_name: 'rotate_camera',
      p_run_id: 'run-2',
      p_project_id: 'project-2',
      p_source: 'api',
      p_api_key_id: null,
    })]);
  });

  it('lets explicit attribution override the ambient context', async () => {
    const { deductFixedCredits, runWithBillingAttribution } = await import('@/lib/billing/credits');

    await runWithBillingAttribution({ runId: 'run-ambient', source: 'app' }, () =>
      deductFixedCredits('user-1', 5, 'create_video', undefined, undefined, null, { runId: 'run-explicit', source: 'mcp' }),
    );

    expect(rpcCalls('deduct_and_log')[0]).toMatchObject({ p_run_id: 'run-explicit', p_source: 'mcp' });
  });

  it('keeps legacy behaviour without attribution: source follows the api key', async () => {
    const { deductFixedCredits } = await import('@/lib/billing/credits');

    await deductFixedCredits('user-1', 5, 'create_video', undefined, undefined, 'key-9');
    await deductFixedCredits('user-1', 5, 'create_video');

    const [withKey, withoutKey] = rpcCalls('deduct_and_log');
    expect(withKey).toMatchObject({ p_source: 'mcp', p_api_key_id: 'key-9', p_run_id: null, p_project_id: null });
    expect(withoutKey).toMatchObject({ p_source: 'app', p_api_key_id: null, p_run_id: null, p_project_id: null });
  });

  it('retries without run attribution when the migration is missing so charges are never lost', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.deduct_and_log(p_run_id, ...)' } })
      .mockResolvedValueOnce({ data: 80, error: null });
    const { deductFixedCredits, runWithBillingAttribution } = await import('@/lib/billing/credits');

    const result = await runWithBillingAttribution({ runId: 'run-3' }, () =>
      deductFixedCredits('user-1', 20, 'create_video'),
    );

    expect(result).toEqual({ charged: 20, remaining: 80 });
    const calls = rpcCalls('deduct_and_log');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ p_run_id: 'run-3' });
    expect(calls[1]).not.toHaveProperty('p_run_id');
  });

  it('attributes refunds and subscription usage rows to the run', async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'app_settings') return billingSettingsChain;
      if (table === 'usage_logs') return { insert };
      return {};
    });
    const { refundCredits, recordSubscriptionUsage, runWithBillingAttribution } = await import('@/lib/billing/credits');

    await runWithBillingAttribution({ runId: 'run-4', projectId: 'project-4', source: 'cli', apiKeyId: 'key-4' }, async () => {
      await refundCredits('user-1', 7, 'create_video');
      await recordSubscriptionUsage('user-1', 'codex-subscription', 'agent', 'gpt-5.6-terra', { inputTokens: 1, outputTokens: 2 });
    });

    expect(rpcCalls('refund_credits_and_log')[0]).toMatchObject({
      p_amount: 7,
      p_source: 'cli',
      p_run_id: 'run-4',
      p_project_id: 'project-4',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      run_id: 'run-4',
      project_id: 'project-4',
      source: 'cli',
      api_key_id: 'key-4',
      credits_charged: 0,
    }));
  });

  it('classifies request sources from the client header and auth', async () => {
    const { resolveRequestBillingSource, billingAttributionFromRunMetadata } = await import('@/lib/billing/attribution');
    const headers = (client?: string) => ({ headers: { get: (name: string) => (name === 'x-makaron-client' ? client ?? null : null) } });

    expect(resolveRequestBillingSource(headers('makaron-cli/0.15.0'), { apiKeyId: 'k' })).toBe('cli');
    expect(resolveRequestBillingSource(headers('Makaron-CLI/0.15.0'), { apiKeyId: null })).toBe('cli');
    expect(resolveRequestBillingSource(headers(), { apiKeyId: 'k' })).toBe('api');
    expect(resolveRequestBillingSource(headers(), { apiKeyId: null })).toBe('app');

    expect(billingAttributionFromRunMetadata({ billing: { source: 'cli', apiKeyId: 'k' } }, { runId: 'r', projectId: 'p' }))
      .toEqual({ runId: 'r', projectId: 'p', source: 'cli', apiKeyId: 'k' });
    expect(billingAttributionFromRunMetadata({ billing: { source: 'bogus' } }, { runId: 'r' }))
      .toEqual({ runId: 'r', projectId: null, source: undefined, apiKeyId: null });
    expect(billingAttributionFromRunMetadata(null, { runId: 'r' }))
      .toEqual({ runId: 'r', projectId: null, source: undefined, apiKeyId: null });
  });
});
