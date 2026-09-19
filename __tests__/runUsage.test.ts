import { describe, it, expect, vi } from 'vitest';
import { formatRunUsageLine, getRunUsage, summarizeRunUsage } from '@/lib/billing/run-usage';

describe('run usage summary', () => {
  it('aggregates debits, refunds and tokens per tool', () => {
    const summary = summarizeRunUsage([
      { tool_name: 'agent', model_used: 'gpt-5.6-terra', credits_charged: 14, input_tokens: 12000, output_tokens: 300, cache_read_tokens: 4000, source: 'cli' },
      { tool_name: 'agent', model_used: 'gpt-5.6-terra', credits_charged: 10, input_tokens: 8000, output_tokens: 200, source: 'cli' },
      { tool_name: 'generate_image', model_used: 'gemini-3.1-flash-image-preview', credits_charged: 19, input_tokens: 500, output_tokens: 1300, source: 'cli' },
      { tool_name: 'create_video', model_used: 'kling-v3-omni', credits_charged: 110, source: 'cli' },
      { tool_name: 'refund:create_video', credits_charged: -110, source: 'app' },
    ]);

    expect(summary).toMatchObject({
      credits_charged: 153,
      credits_refunded: 110,
      credits_net: 43,
      input_tokens: 20500,
      output_tokens: 1800,
      cache_read_tokens: 4000,
      cache_write_tokens: 0,
      sources: ['app', 'cli'],
    });
    expect(summary.entries.map(entry => [entry.tool_name, entry.calls, entry.credits])).toEqual([
      ['create_video', 1, 110],
      ['agent', 2, 24],
      ['generate_image', 1, 19],
      ['refund:create_video', 1, -110],
    ]);
  });

  it('returns an empty summary for runs without charges', () => {
    expect(summarizeRunUsage([])).toEqual({
      credits_charged: 0,
      credits_refunded: 0,
      credits_net: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      entries: [],
      sources: [],
    });
    expect(formatRunUsageLine(summarizeRunUsage([]))).toBeNull();
  });

  it('formats a one-line human summary', () => {
    const summary = summarizeRunUsage([
      { tool_name: 'agent', credits_charged: 24 },
      { tool_name: 'generate_image', credits_charged: 19 },
    ]);
    expect(formatRunUsageLine({ ...summary, balance: 1157 })).toBe('43 credits used (agent 24 · generate_image 19) · balance 1157');
    expect(formatRunUsageLine(summarizeRunUsage([
      { tool_name: 'create_video', credits_charged: 110 },
      { tool_name: 'refund:create_video', credits_charged: -110 },
    ]))).toBe('0 credits used (create_video 110 · refund:create_video -110) · 110 refunded');
  });

  it('never fails run status lookups when the usage query errors', async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { code: '42703', message: 'column usage_logs.run_id does not exist' } }),
      }),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(getRunUsage(admin as never, 'run-1')).resolves.toMatchObject({ credits_net: 0, entries: [] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
