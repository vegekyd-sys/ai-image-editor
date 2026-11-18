import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { seededMediaPrices } from './helpers/media-prices';
import { calculateMediaQuote, type MediaPrice } from '@/lib/billing/media-pricing';
import { estimateModelPrice, queryModelPrices, type ModelPriceRequest } from '@/lib/model-price-tool';
import { formatImageCapabilitiesForAgent, listImageModelCapabilities } from '@/lib/image-model-capabilities';

import { listVideoModelCapabilities } from '@/lib/video-model-capabilities';

const db = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, fail: false, reads: [] as string[] }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({ from: (table: string) => {
  db.reads.push(table);
  const result = () => ({ data: db.rows[table], error: db.fail ? { message: 'private-database-error' } : null });
  const query: any = { select: () => query, eq: () => query, order: async () => result(), then: (resolve: any) => Promise.resolve(result()).then(resolve) };
  return query;
} }) }));
const request = (overrides: Partial<ModelPriceRequest> = {}): ModelPriceRequest => ({ kind: 'video', model: 'kling-4-flash', duration_seconds: 5, image_count: 0, video_reference_count: 0, audio_reference_count: 0, ...overrides });
async function quoteRequests(input: Parameters<typeof queryModelPrices>[0]) {
  const result = await queryModelPrices(input);
  if (!('estimates' in result)) throw new Error('Expected quotes, got catalog');
  return result;
}
beforeEach(() => {
  db.fail = false; db.reads = [];
  db.rows = { media_pricing: seededMediaPrices(), credit_pricing: [{ tool_name: 'edit_image_qwen-spicy-2', credits: 7, supplier_cost: .035, is_free: false }],
    token_rates: ['seedream-5.5', 'gpt-image-2.6-flare', 'google/gemini-nano-banana-2.1', 'google/gemini-3.1-flash-lite-image', 'mj-v8.2', 'kling-image-4.0'].map(model_id => ({ model_id, markup: 2, is_active: true, input_per_1m: 1.5, output_per_1m: 60 })) };
});
function basisCost(q: ReturnType<typeof calculateMediaQuote>) {
  return q.billingBasis!.reduce((sum, b) => sum + (b.outputQuantity * b.outputUnitUsd + b.inputVideoSeconds * b.inputVideoUnitUsd + b.inputImages * b.inputImageUnitUsd + b.inputTokens * b.inputTokenUnitUsd) * b.multiplier, 0);
}
describe('read-only Agent price awareness', () => {
  it('discovers every active image and video model without reading pricing or duplicating a client model list', async () => {
    const result = await queryModelPrices({ requests: [] });
    if (!('catalog' in result)) throw new Error('Expected model catalog');
    expect(result.catalog.image.map(row => row.model).sort()).toEqual(listImageModelCapabilities().map(row => row.id).sort());
    expect(result.catalog.video.map(row => row.model).sort()).toEqual(listVideoModelCapabilities().map(row => row.pricing?.publicModel ?? row.id).sort());
    expect(result.catalog.image.every(row => Boolean(row.pricing))).toBe(true);
    expect(db.reads).toEqual([]);
  });
  it('quotes representative video/audio/image contracts in customer credits', async () => {
    const video = await estimateModelPrice(request());
    expect(video).toMatchObject({ status: 'estimated', model: 'kling-4-flash', credits: expect.any(Number) });
    const audio = await estimateModelPrice(request({ kind: 'audio', model: 'evolink-seed-audio', duration_seconds: 8 }));
    expect(audio).toMatchObject({ status: 'estimated', credits: 4 });
    const image = await estimateModelPrice(request({ kind: 'image', model: 'seedream-5.5', resolution: '2K', image_count: 3 }));
    expect(image).toMatchObject({ status: 'estimated', credits: 10, details: { billableInputImages: 3, outputResolutionAffectsCredits: true } });
    expect([...new Set(db.reads)].sort()).toEqual(['media_pricing', 'token_rates']);
  });
  it('preserves public Seedance Eco versus explicit native routing', async () => {
    expect(await estimateModelPrice(request({ model: 'seedance-2.5', resolution: '720p' }))).toMatchObject({ status: 'estimated', model: 'seedance-2.5-eco' });
    expect(await estimateModelPrice(request({ model: 'seedance-2.5-native', resolution: '720p' }))).toMatchObject({ status: 'estimated', model: 'seedance-2.5' });
    expect(await estimateModelPrice(request({ model: 'seedance-2.5-native', resolution: '4k', duration_seconds: 4, video_reference_count: 1, reference_video_seconds: 8 }))).toMatchObject({
      status: 'estimated', credits: 1738, billingBasis: [{ outputQuantity: 4, billableReferenceVideoSeconds: 8, referenceVideoTariffIncludesOutput: true }],
    });
    db.rows.media_pricing = db.rows.media_pricing.filter(row => row.id !== 'video:seedance-2.5:4k:generate');
    expect(await estimateModelPrice(request({ model: 'seedance-2.5-native', resolution: '4k' }))).toMatchObject({ status: 'unknown' });
  });
  it('explains input floor with the authoritative quote, not just output seconds', async () => {
    const estimate = await estimateModelPrice(request({ model: 'seedance-2.5-native', resolution: '720p', duration_seconds: 10, video_reference_count: 1, reference_video_seconds: 3 }));
    expect(estimate).toMatchObject({ status: 'estimated', credits: 720,
      billingBasis: [{ outputQuantity: 10, billableReferenceVideoSeconds: 10, referenceVideoTariffIncludesOutput: true }] });
  });
  it('covers native 4K candidate input+output contract without enabling it or asserting live price', () => {
    // Candidate fixture from the separate 4K worktree's 20261117053223 migration; NOT a live price.
    const native: MediaPrice = { ...seededMediaPrices().find(p => p.id === 'video:seedance-2.5:720p:generate')!,
      id: 'video:seedance-2.5:4k:generate', resolution: '4k', output_usd_per_second: 1.182, video_reference_usd_per_second: .724, updated_at: 'candidate-fixture-only' };
    const quote = calculateMediaQuote(native, { durationSec: 4, referenceVideoDurationSec: 8 });
    expect(quote.supplierCostUsd).toBeCloseTo(8.688);
    expect(quote.credits).toBe(1738);
    expect(quote.billingBasis![0]).toMatchObject({ outputQuantity: 4, inputVideoSeconds: 8, inputVideoUnitUsd: .724 });
    expect(basisCost(quote)).toBeCloseTo(quote.supplierCostUsd);
    expect(calculateMediaQuote(native, { durationSec: 4, referenceVideoDurationSec: 2 }).supplierCostUsd).toBeCloseTo(5.792);
  });
  it('explanation matches unchanged charge formula across all registry tariffs/reference branches', () => {
    for (const price of seededMediaPrices()) for (const referenceVideoDurationSec of [0, 3.4, 8.6]) {
      const q = calculateMediaQuote(price, { durationSec: 5, imageCount: 2, referenceVideoDurationSec, referenceImagePixels: 2e6, referenceAudioDurationSec: 3, contentFilter: false });
      expect(basisCost(q), price.id).toBeCloseTo(q.supplierCostUsd, 10);
    }
  });
  it('requires unknown inputs rather than underpricing reference videos or token-priced image refs', async () => {
    expect(await estimateModelPrice(request({ video_reference_count: 1 }))).toMatchObject({ status: 'needs_inputs', missing: ['reference_video_seconds'] });
    expect(await estimateModelPrice(request({ model: 'fal-h3-max', image_count: 1 }))).toMatchObject({ status: 'needs_inputs', missing: ['reference_image_pixels'] });
    expect(await estimateModelPrice(request({ duration_seconds: undefined }))).toMatchObject({ status: 'needs_inputs' });
  });
  it('reads current rows each time, rejects missing/disabled/errors and never leaks raw errors', async () => {
    const first = await estimateModelPrice(request());
    const row = db.rows.media_pricing.find(p => p.id === 'video:kling-4-flash:720p:generate');
    row.output_usd_per_second *= 3;
    const next = await estimateModelPrice(request());
    expect(next.credits).toBe(first.credits! * 3);
    row.is_active = false;
    expect(await estimateModelPrice(request())).toMatchObject({ status: 'unknown' });
    db.rows.media_pricing = [];
    expect(await estimateModelPrice(request())).toMatchObject({ status: 'unknown' });
    db.fail = true;
    expect(JSON.stringify(await estimateModelPrice(request()))).not.toContain('private-database-error');
    expect(await estimateModelPrice(request({ model: 'invented' }))).toMatchObject({ status: 'unsupported' });
  });
  it('reports unknown when a required reference tariff is absent even if legacy billing would quote output only', async () => {
    delete db.rows.media_pricing.find(p => p.id === 'video:seedance-2.5:720p:generate').video_reference_usd_per_second;
    const result = await estimateModelPrice(request({ model: 'seedance-2.5-native', resolution: '720p', video_reference_count: 1, reference_video_seconds: 8 }));
    expect(result).toMatchObject({ status: 'unknown' });
    expect(result.credits).toBeUndefined();
    expect(result.reason).toContain('not evidence that reference input is free');
  });
  it('does not underquote an edit whose billing uses source duration', async () => {
    expect(await estimateModelPrice(request({ model: 'seedance-2.5-native', operation: 'edit', duration_seconds: 5, video_reference_count: 1, reference_video_seconds: 8 }))).toMatchObject({ status: 'unsupported' });
    expect(await estimateModelPrice(request({ model: 'seedance-2.5-native', operation: 'edit', duration_seconds: 8, video_reference_count: 1, reference_video_seconds: 8 }))).toMatchObject({ status: 'estimated' });
  });
  it('never presents heuristic GPT preflight or unknown tokens as a firm price/ranking', async () => {
    const result = await quoteRequests({ requests: [request({ kind: 'image', model: 'gpt-image-2.6-flare', image_count: 2 }), request({ kind: 'image', model: 'gemini-lite' })] });
    expect(result.estimates![0]).toMatchObject({ status: 'preflight_only', credits: 12 });
    expect(result.estimates![1]).toMatchObject({ status: 'usage_only' });
    expect(result.estimates![1].credits).toBeUndefined();
    expect(result.comparison!.rows).toEqual([]);
  });
  it('quotes exact fixed image reference SKU, and never silently enables disabled Suno', async () => {
    expect(await estimateModelPrice(request({ kind: 'image', model: 'qwen-spicy', image_count: 2 }))).toMatchObject({ credits: 7 });
    vi.stubEnv('SUNO_BGM_ENABLED', 'false');
    expect(await estimateModelPrice(request({ kind: 'audio', model: 'suno-v6' }))).toMatchObject({ status: 'unsupported' });
    vi.unstubAllEnvs();
  });
  it('keeps internal prices and markup out of raw Agent quotes and image tool guidance', async () => {
    const result = await quoteRequests({ requests: [
      request({ model: 'seedance-2.5-eco', resolution: '720p', video_reference_count: 1, reference_video_seconds: 4, content_filter: false }),
      request({ kind: 'audio', model: 'evolink-seed-audio' }),
      request({ kind: 'image', model: 'qwen-spicy', image_count: 2 }),
      request({ kind: 'image', model: 'seedream-5.5', resolution: '2K', image_count: 3 }),
      request({ kind: 'image', model: 'gpt-image-2.6-flare', image_count: 2 }),
      request({ kind: 'image', model: 'gemini-lite' }),
    ] });
    expect(result.currency).toBe('credits');
    expect(result.billingExplanation).toContain('applies to BOTH the output');
    expect(result.estimates[0]).toMatchObject({ status: 'estimated', details: { baseCredits: expect.any(Number), upscaleCredits: expect.any(Number) } });
    expect(result.estimates.map(e => e.status)).toEqual(['estimated', 'estimated', 'estimated', 'estimated', 'preflight_only', 'usage_only']);
    expect(JSON.stringify(result)).not.toMatch(/usd|supplier|markup|multiplier|perMillion|\$\s*\d/i);
    expect(formatImageCapabilitiesForAgent()).not.toMatch(/\$\s*\d/);
  });
  it('uses registered image policies for known preflights and distinguishes reference generation from edit', async () => {
    const kling = await estimateModelPrice(request({ kind: 'image', model: 'kling-image-4.0', resolution: '2K' }));
    const nano = await estimateModelPrice(request({ kind: 'image', model: 'gemini-2.1', resolution: '4K', image_count: 2 }));
    const midjourney = request({ kind: 'image', model: 'mj-v8.2', image_count: 2, operation: 'generate', options: { quality: 'hd' } });
    expect(kling).toMatchObject({ status: 'preflight_only', credits: 13 });
    expect(nano).toMatchObject({ status: 'preflight_only', credits: 16 });
    expect(await estimateModelPrice(midjourney)).toMatchObject({ status: 'preflight_only', credits: 26 });
    expect(await estimateModelPrice({ ...midjourney, operation: 'edit' })).toMatchObject({ status: 'unsupported' });
  });
  it('does not guess upscale fps or quote lip-sync without the corresponding audio', async () => {
    const upscale = request({ model: 'bytedance-video-upscale', resolution: '4k' });
    expect(await estimateModelPrice(upscale)).toMatchObject({ status: 'needs_inputs', missing: ['output_fps'] });
    const lo = await estimateModelPrice({ ...upscale, output_fps: 30 });
    const hi = await estimateModelPrice({ ...upscale, output_fps: 60 });
    expect(lo.credits).toBeLessThan(hi.credits!);
    const sync = request({ model: 'sync-lipsync-v3', resolution: '720p', video_reference_count: 1, reference_video_seconds: 5 });
    expect(await estimateModelPrice(sync)).toMatchObject({ status: 'needs_inputs', missing: ['audio_reference_count'] });
    expect(await estimateModelPrice({ ...sync, audio_reference_count: 1 })).toMatchObject({ status: 'estimated' });
  });
  it('identifies relative expensive candidates but never treats different quality as interchangeable', async () => {
    const result = await quoteRequests({ requests: [request({ model: 'kling-4-flash' }), request({ model: 'seedance-2.5-native', resolution: '720p' })] });
    expect(result.comparison!.rows[1].atLeastTwiceLowest).toBe(true);
    expect(result.comparison!.warning).toContain('not a quality/capability equivalence');
    expect(result.observedAt).toMatch(/^\d{4}-/);
    expect(result.validity).toContain('no expiry/discount calendar');
  });
  it('does not rank unrelated task quantities as a cheapest-model decision', async () => {
    const mixed = await quoteRequests({ requests: [request(), request({ kind: 'audio', model: 'evolink-seed-audio' })] });
    expect(mixed.comparison).toMatchObject({ sameTaskQuantities: false, rows: [], lowestKnownCredits: null });
    const durations = await quoteRequests({ requests: [request(), request({ duration_seconds: 10 })] });
    expect(durations.comparison!.rows).toEqual([]);
  });
  it('rejects invalid quantities and incompatible dimensions before quoting', async () => {
    for (const bad of [-1, Infinity, NaN]) expect((await estimateModelPrice(request({ duration_seconds: bad }))).status).toBe('unsupported');
    expect((await estimateModelPrice(request({ image_count: 999 }))).status).toBe('unsupported');
    expect((await estimateModelPrice(request({ kind: 'image', model: 'seedream-5.5', resolution: '4K' }))).status).toBe('unsupported');
  });
  it('is wired into shared Agent tools and retains the routing policy', async () => {
    expect(readFileSync('src/lib/agent-tools.ts', 'utf8')).toContain('query_model_prices: createModelPriceTool()');
    expect(readFileSync('src/lib/prompts/agent.md', 'utf8')).toContain('use `query_model_prices`');
    expect((await queryModelPrices({ requests: [] })).policy).toContain('keep existing defaults');
  });
});
