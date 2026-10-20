import { describe, expect, it } from 'vitest';
import { deepSeekFlashProviderCost, deepSeekFlashTariffMultiplier } from '@/lib/billing/deepseek-flash-rate';
import { providerCostToCredits, type TokenRate } from '@/lib/billing/token-rates';

const rate: TokenRate = { model_id: 'deepseek/deepseek-flash', display_name: 'DeepSeek V4.1 Flash 1017', input_per_1m: .3, output_per_1m: 1.2, cache_read_per_1m: .006, cache_write_per_1m: 0, markup: 2, is_active: true };
describe('DeepSeek official time-based pricing with x2 markup', () => {
  it.each([
    ['2026-10-19T00:59:59Z', .5], ['2026-10-19T01:00:00Z', 1],
    ['2026-10-19T03:59:59Z', 1], ['2026-10-19T04:00:00Z', .5],
    ['2026-10-19T06:00:00Z', 1], ['2026-10-19T09:59:59Z', 1], ['2026-10-19T10:00:00Z', .5],
    ['2026-10-17T02:00:00Z', .5], ['2026-10-10T02:00:00Z', .5],
    ['2026-10-01T02:00:00Z', .5], ['2026-02-23T07:00:00Z', .5],
  ])('applies official tariff at %s', (time, factor) => {
    expect(deepSeekFlashTariffMultiplier(new Date(time))).toBe(factor);
  });
  it('prices uncached/cache-hit/image tokens and reasoning output before applying x2 once', () => {
    const tokens = { noCacheInput: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, output: 1_000_000 };
    const peak = deepSeekFlashProviderCost(rate, tokens, new Date('2026-10-19T02:00:00Z'));
    const offPeak = deepSeekFlashProviderCost(rate, tokens, new Date('2026-10-17T02:00:00Z'));
    expect(peak).toBeCloseTo(1.506);
    expect(offPeak).toBeCloseTo(.753);
    expect(providerCostToCredits(peak, rate.markup)).toBe(302);
    expect(providerCostToCredits(offPeak, rate.markup)).toBe(151);
  });
  it('accounts for a run spanning a peak/off-peak boundary per inference step', () => {
    const tokens = { noCacheInput: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 };
    const cost = deepSeekFlashProviderCost(rate, tokens, new Date('2026-10-19T03:59:00Z'))
      + deepSeekFlashProviderCost(rate, tokens, new Date('2026-10-19T04:01:00Z'));
    expect(cost).toBeCloseTo(.45);
    expect(providerCostToCredits(cost, 2)).toBe(90);
  });
  it('fails before billing with an unmaintained holiday calendar instead of overcharging', () => {
    expect(() => deepSeekFlashTariffMultiplier(new Date('2027-01-04T02:00:00Z'))).toThrow('calendar');
  });
});
