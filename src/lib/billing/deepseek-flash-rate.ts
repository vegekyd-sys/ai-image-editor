import type { TokenBreakdown, TokenRate } from './token-rates';
import { PricingUnavailableError } from './media-pricing';

// Official Flash tariff: https://api-docs.deepseek.com/quick_start/pricing/
// Holiday calendar: State Council notice, 国办发明电〔2025〕7号.
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
const HOLIDAY_RANGES: Record<number, readonly (readonly [string, string])[]> = {
  2026: [
    ['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'],
    ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07'],
  ],
};

export function deepSeekFlashTariffMultiplier(at: Date): 0.5 | 1 {
  if (!Number.isFinite(at.getTime())) throw new PricingUnavailableError('Invalid DeepSeek usage timestamp');
  const day = at.getUTCDay();
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  // DeepSeek explicitly prices *all* weekends off-peak, including adjusted workdays.
  if (day === 0 || day === 6 || !((minute >= 60 && minute < 240) || (minute >= 360 && minute < 600))) return 0.5;
  // Peak UTC hours are 09:00–18:00 Beijing time, so the UTC date is also the holiday date.
  const ranges = HOLIDAY_RANGES[at.getUTCFullYear()];
  if (!ranges) throw new PricingUnavailableError('DeepSeek holiday pricing calendar needs updating');
  const date = at.toISOString().slice(5, 10);
  return ranges.some(([start, end]) => date >= start && date <= end) ? 0.5 : 1;
}

/** DB rates are authoritative peak USD per 1M. Do not round individual steps. */
export function deepSeekFlashProviderCost(rate: TokenRate, tokens: TokenBreakdown, at: Date): number {
  const factor = deepSeekFlashTariffMultiplier(at);
  return factor * (
    tokens.noCacheInput * rate.input_per_1m
    + tokens.cacheRead * (rate.cache_read_per_1m ?? rate.input_per_1m)
    + tokens.cacheWrite * (rate.cache_write_per_1m ?? rate.input_per_1m)
    + tokens.output * rate.output_per_1m
  ) / 1_000_000;
}
