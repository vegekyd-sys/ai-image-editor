import type { TokenRate } from './token-rates';

// Google published introductory pricing through 2026-12-31 (UTC).
// https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash
export function getVideoAnalysisDefaultRate(now = Date.now()): TokenRate {
  const discount = now < Date.parse('2027-01-01T00:00:00Z') ? 0.5 : 1;
  return {
    model_id: 'gemini-3.8-flash',
    display_name: 'Gemini 3.8 Flash',
    input_per_1m: 1.5 * discount,
    output_per_1m: 7.5 * discount,
    cache_read_per_1m: 0.15 * discount,
    cache_write_per_1m: 1.5 * discount,
    markup: 2,
    is_active: true,
  };
}
