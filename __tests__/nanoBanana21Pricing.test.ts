import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  from: () => {
    const query = { select: () => query, eq: () => query, order: async () => ({ data: state.rows, error: null }) };
    return query;
  },
}) }));
import { getTokenRate } from '@/lib/billing/token-rates';
beforeEach(() => {
  state.rows = [{ model_id: 'google/gemini-nano-banana-2.1', input_per_1m: 1.5, output_per_1m: 30, markup: 2, is_active: true }];
});
it('never prices 2.1 text with the image prefix rate', async () => {
  expect(await getTokenRate('google/gemini-nano-banana-2.1:text')).toBeNull();
});
it('uses the exact text rate for a Tips experiment', async () => {
  state.rows.push({ model_id: 'google/gemini-nano-banana-2.1:text', input_per_1m: 1.5, output_per_1m: 7.5, markup: 2, is_active: true });
  expect(await getTokenRate('google/gemini-nano-banana-2.1:text')).toMatchObject({ output_per_1m: 7.5 });
  expect(await getTokenRate('google/gemini-nano-banana-2.1')).toMatchObject({ output_per_1m: 30 });
});
