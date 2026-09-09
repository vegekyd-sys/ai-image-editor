import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: state.rows, error: null }) }) }) }) }) }));
import { getTokenRate, providerCostToCredits } from '@/lib/billing/token-rates';
describe('Image 2.5 pricing', () => {
  it('cannot match Image 2 pricing when the exact variant is missing', async () => {
    state.rows = [{ model_id: 'openai/gpt-image-2', markup: 2 }];
    expect(await getTokenRate('openai/gpt-image-2.5-flare')).toBeNull();
    expect(await getTokenRate('gpt-image-2.5-flare')).toBeNull();
    state.rows.push({ model_id: 'gpt-image-2.5-flare', markup: 2 });
    expect(await getTokenRate('gpt-image-2.5-flare')).toMatchObject({ markup: 2 });
    expect(await getTokenRate('gpt-image-2.5-sunburst')).toBeNull();
    expect(providerCostToCredits(0.0063, 2)).toBe(2);
    expect(providerCostToCredits(0.0145, 2)).toBe(3);
  });
});
