import { tool } from 'ai';
import { z } from 'zod';
import { calculateMediaQuote, getMediaPrices, quoteVideo, videoPriceId, type MediaQuote } from './billing/media-pricing';
import { quoteImage } from './billing/image-pricing';
import { imagePricingInput } from './billing/image-pricing-policy';
import { getImageModelRegistration } from './models';
import { listImageModelCapabilities, normalizeImageModelId, planImageGeneration, validateImageModelRequest } from './image-model-capabilities';
import { listVideoModelCapabilities, resolveProductVideoModelId, resolveVideoGenerationRoute, validateVideoModelRequest, validateVideoPricingInputCounts, type VideoResolution } from './video-model-capabilities';
import { listAudioModelCapabilities, normalizeAudioModelId, validateAudioRequest } from './audio-model-capabilities';

const quantity = z.number().finite().nonnegative();
export const modelPriceRequestSchema = z.object({
  kind: z.enum(['image', 'video', 'audio']),
  model: z.string().min(1).describe('Exact model from capabilities. Use seedance-2.5-native for native; seedance-2.5 retains the product Eco route. No auto or unknown-model substitution.'),
  resolution: z.string().optional().describe('Output resolution. Always pass the requested size here, e.g. "2K" for images or "720p" for videos. Omit only to quote the model default.'),
  operation: z.enum(['generate', 'edit', 'extend']).optional(),
  duration_seconds: z.number().finite().positive().optional().describe('Requested output seconds; required for video/audio. Actual audio duration may differ.'),
  image_count: quantity.int().max(100).describe('Total input images, including edit base and every reference. Explicitly use 0 for none.'),
  video_reference_count: quantity.int().max(100).default(0),
  reference_video_seconds: quantity.optional().describe('Sum of input video seconds, including edit source; do not omit when video references exist.'),
  reference_image_pixels: quantity.optional().describe('Total input-image pixels, needed by token-priced video references.'),
  audio_reference_count: quantity.int().max(100).default(0),
  reference_audio_seconds: quantity.optional(),
  output_fps: z.number().finite().min(1).max(60).optional(),
  content_filter: z.boolean().optional(),
  image_quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
  image_reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
  aspect_ratio: z.string().optional(),
  background: z.enum(['auto', 'opaque', 'transparent']).optional(),
  output_format: z.enum(['png', 'jpeg', 'webp', 'gif', 'svg']).optional(),
  frame_count: z.number().int().min(2).max(16).optional(),
  frame_duration_ms: z.number().int().min(20).max(2000).optional(),
  gif_frame_size: z.enum(['sticker', 'full']).optional(),
  options: z.record(z.string(), z.unknown()).optional().describe('Only model-specific settings from the registry, such as Midjourney HD quality. Leave empty for ordinary requests. Use the top-level resolution field for output size.'),
});
export type ModelPriceRequest = z.infer<typeof modelPriceRequestSchema>;
export const modelPriceInputSchema = z.object({
  requests: z.array(modelPriceRequestSchema).max(6).describe('Empty array discovers available IDs and dimensions. Otherwise quote up to six concrete alternatives; never compare unrelated tasks as equivalent quality.'),
});

type Estimate = {
  status: 'estimated' | 'preflight_only' | 'usage_only' | 'unknown' | 'needs_inputs' | 'unsupported';
  request: ModelPriceRequest;
  reason?: string;
  missing?: string[];
  model?: string;
  resolution?: string;
  priceVersion?: string | null;
  credits?: number;
  billingBasis?: Array<{
    outputQuantity: number;
    billableReferenceVideoSeconds?: number;
    referenceVideoTariffIncludesOutput?: true;
    billableInputImages?: number;
    referenceUsageAffectsCredits?: boolean;
  }>;
  details?: {
    baseCredits?: number;
    upscaleCredits?: number;
    unit?: 'generation' | 'output-second';
    takes?: number;
    settlement?: string;
    inputCount?: number;
    billableInputImages?: number;
    outputResolutionAffectsCredits?: boolean;
    quality?: string;
    reasoning?: string;
  };
};
const unresolved = (request: ModelPriceRequest, status: Estimate['status'], reason: string, missing?: string[]): Estimate => ({ status, request, reason, ...(missing ? { missing } : {}) });
function mediaEstimate(request: ModelPriceRequest, model: string, quote: MediaQuote, details: Estimate['details']): Estimate {
  return {
    status: 'estimated', request, model, priceVersion: quote.priceVersion, credits: quote.credits,
    // Explicitly project quantities into the Agent result. The billing quote
    // also holds commercial terms for server-side calculations and settlement.
    billingBasis: quote.billingBasis?.map(basis => ({
      outputQuantity: basis.outputQuantity,
      ...(basis.usesVideoReferenceTariff ? { referenceVideoTariffIncludesOutput: true as const } : {}),
      ...(basis.inputVideoUnitUsd > 0 && basis.inputVideoSeconds > 0 ? { billableReferenceVideoSeconds: basis.inputVideoSeconds } : {}),
      ...(basis.inputImageUnitUsd > 0 && basis.inputImages > 0 ? { billableInputImages: basis.inputImages } : {}),
      ...(basis.inputTokenUnitUsd > 0 && basis.inputTokens > 0 ? { referenceUsageAffectsCredits: true } : {}),
    })),
    details,
  };
}

/** Read-only estimate boundary: no account, balance, debit, provider submission or fallback. */
export async function estimateModelPrice(request: ModelPriceRequest): Promise<Estimate> {
  const parsed = modelPriceRequestSchema.safeParse(request);
  if (!parsed.success) return unresolved(request, 'unsupported', 'Invalid estimate quantities or parameters.');
  const r = parsed.data;
  try {
    if (r.kind === 'video') {
      const model = resolveProductVideoModelId(r.model);
      const capability = listVideoModelCapabilities().find(c => c.id === model);
      if (!capability) return unresolved(r, 'unsupported', 'Model is not in the active video registry; no substitution.');
      if (r.options?.h3Controls !== undefined) {
        const { h3ControlsSchema } = await import('./h3-controls');
        const assets = z.object({
          h3Controls: h3ControlsSchema, images: z.array(z.string().url()).max(9).default([]),
          videoUrls: z.array(z.string().url()).max(3).default([]), audioUrls: z.array(z.string().url()).max(3).default([]),
          aspectRatio: z.enum(['16:9','9:16','1:1','4:3','3:4','21:9']).optional(),
        }).strict().safeParse(r.options);
        if (!assets.success) return unresolved(r, 'unsupported', 'Invalid H3 operation or asset list.');
        if (r.image_count !== assets.data.images.length) return unresolved(r, 'needs_inputs', 'Provide the selected H3 image URLs to measure input cost.', ['options.images']);
        const { prepareControlledH3Request } = await import('./fal-h3-controlled-video');
        const request = await prepareControlledH3Request({
          ...assets.data, videoModel: model, videoResolution: r.resolution?.toLowerCase() as VideoResolution,
          duration: r.duration_seconds, videoOperation: r.operation, script: 'H3 cost estimate',
        });
        const quote = await quoteVideo(request.usage);
        return { ...mediaEstimate(r, model, quote, { unit: 'output-second' }), resolution: request.usage.resolution ?? undefined };
      }
      const pricing = capability.pricing;
      if (r.options && Object.keys(r.options).length) return unresolved(r, 'unsupported', 'This model does not accept extra quote options. Pass output size in the resolution field.');
      const resolution = r.resolution?.toLowerCase() as VideoResolution | undefined;
      const route = resolveVideoGenerationRoute({ model, resolution });
      if (resolution && !capability.supportedResolutions?.includes(resolution)) return unresolved(r, 'unsupported', 'Resolution is not enabled for this model in this checkout. No Eco/upscale substitution.');
      const missing: string[] = [];
      if (!r.duration_seconds) missing.push('duration_seconds');
      if (pricing?.requiresSourceFps && r.output_fps == null) missing.push('output_fps');
      if (pricing?.requiredVideoInputs && !r.video_reference_count) missing.push('video_reference_count');
      if (pricing?.requiredAudioInputs && !r.audio_reference_count) missing.push('audio_reference_count');
      if (r.video_reference_count && !r.reference_video_seconds) missing.push('reference_video_seconds');
      if ((r.reference_video_seconds ?? 0) > 0 && !r.video_reference_count) missing.push('video_reference_count');
      if (r.operation === 'edit' || r.operation === 'extend') {
        if (!r.video_reference_count) missing.push('video_reference_count');
        if (!r.reference_video_seconds) missing.push('reference_video_seconds');
      }
      if (missing.length) return unresolved(r, 'needs_inputs', 'Known output and input quantities are required; no zero-cost assumption.', [...new Set(missing)]);
      // create-video settles these paths using measured source seconds. Refuse
      // a conflicting hypothetical output length instead of underquoting it.
      const inputCountError = validateVideoPricingInputCounts(capability, r.video_reference_count, r.audio_reference_count);
      if (inputCountError) return unresolved(r, 'unsupported', inputCountError);
      const billsSource = pricing?.billsSourceDuration === 'always' || (r.operation === 'edit' && pricing?.billsSourceDuration === 'edit');
      if (billsSource && r.duration_seconds !== r.reference_video_seconds) return unresolved(r, 'unsupported', 'This operation bills measured source duration. Quote with output seconds equal to source seconds; a shorter requested edit is not a cheaper charge.');
      const invalid = validateVideoModelRequest({ model, resolution, operation: r.operation, outputDuration: r.operation === 'edit' && pricing?.adaptiveEditDuration ? -1 : r.duration_seconds,
        referenceVideoDuration: r.reference_video_seconds, hasVideoReference: r.video_reference_count > 0,
        imageReferenceCount: r.image_count, videoReferenceCount: r.video_reference_count, audioReferenceCount: r.audio_reference_count });
      if (invalid) return unresolved(r, 'unsupported', invalid);
      // Token-priced reference media cannot be estimated from counts alone.
      const prices = await getMediaPrices();
      const priceId = pricing?.basePriceId ?? videoPriceId({ model, resolution, operation: r.operation });
      const price = prices.find(p => p.id === priceId);
      if (!price?.is_active) return unresolved(r, 'unknown', 'Exact active media_pricing row is unavailable.');
      if (r.video_reference_count && pricing?.requiresReferenceTariff && price.video_reference_usd_per_second == null) {
        return unresolved(r, 'unknown', 'The registered video-reference tariff is missing. Legacy output-only billing is not evidence that reference input is free; cannot quote this request until the tariff is configured.');
      }
      if (r.image_count && price.input_tokens_per_image_pixel && !r.reference_image_pixels) missing.push('reference_image_pixels');
      if (r.audio_reference_count && price.input_tokens_per_audio_second && !r.reference_audio_seconds) missing.push('reference_audio_seconds');
      if (missing.length) return unresolved(r, 'needs_inputs', 'Reference token billing needs measured dimensions/durations.', missing);
      const quote = await quoteVideo({ model, resolution, operation: r.operation, durationSec: r.duration_seconds!, imageCount: r.image_count,
        referenceVideoDurationSec: r.reference_video_seconds, referenceImagePixels: r.reference_image_pixels,
        referenceAudioDurationSec: r.reference_audio_seconds, contentFilter: r.content_filter, outputFps: r.output_fps }, prices);
      return { ...mediaEstimate(r, model, quote, { baseCredits: quote.baseCredits, upscaleCredits: quote.upscaleCredits,
        unit: 'output-second' }), resolution: route.resolution };
    }
    if (r.kind === 'audio') {
      const model = normalizeAudioModelId(r.model);
      const capability = listAudioModelCapabilities().find(c => c.id === model);
      if (!capability) return unresolved(r, 'unsupported', 'Audio model is not enabled; no silent Seed fallback.');
      if (r.operation && r.operation !== 'generate') return unresolved(r, 'unsupported', 'Audio estimate supports generation only.');
      if ((r.resolution && r.resolution !== 'default') || r.video_reference_count || (r.image_count > (capability.maxImageReferences ?? 0)) || r.audio_reference_count > (capability.maxAudioReferences ?? 0) || (r.image_count && r.audio_reference_count)) return unresolved(r, 'unsupported', 'Unsupported audio dimensions/references.');
      if (!r.duration_seconds) return unresolved(r, 'needs_inputs', 'Specify target audio seconds; actual measured output is settled later.', ['duration_seconds']);
      const invalid = validateAudioRequest({ model, durationSeconds: r.duration_seconds });
      if (invalid) return unresolved(r, 'unsupported', invalid);
      const price = (await getMediaPrices()).find(p => p.id === `audio:${model}:default:generate`);
      if (!price) return unresolved(r, 'unknown', 'Exact audio price row is unavailable.');
      const perGeneration = model === 'suno-v6';
      return mediaEstimate(r, model, calculateMediaQuote(price, { durationSec: perGeneration ? 1 : r.duration_seconds }), {
        unit: perGeneration ? 'generation' : 'output-second', takes: capability.takesPerGeneration,
        settlement: perGeneration ? undefined : 'Final credits depend on actual returned audio duration; the target is an estimate.',
      });
    }
    const model = normalizeImageModelId(r.model);
    if (!model) return unresolved(r, 'unsupported', 'Unknown image model; Auto fallback is not a quotation.');
    if (r.video_reference_count || r.audio_reference_count || r.operation === 'extend') return unresolved(r, 'unsupported', 'Image estimate requires image inputs only.');
    if (r.operation === 'edit' && !r.image_count) return unresolved(r, 'needs_inputs', 'Include the base image in image_count for an edit.', ['image_count']);
    const registration = getImageModelRegistration(model);
    const resolution = r.resolution?.toUpperCase();
    const hasBase = r.operation === 'edit' || (r.operation === undefined && r.image_count > 0);
    let options;
    try {
      if (r.options && !registration.quoteOptions && Object.keys(r.options).length) {
        return unresolved(r, 'unsupported', 'This model does not accept extra quote options. Pass output size in the resolution field.');
      }
      options = registration.quoteOptions?.(r.options ?? {});
    } catch {
      return unresolved(r, 'unsupported', 'Invalid model-specific quote options.');
    }
    const imageRequest = {
      ...options, model, prompt: 'Price inquiry only', imageResolution: resolution, aspectRatio: r.aspect_ratio,
      imageQuality: r.image_quality, imageReasoningEffort: r.image_reasoning_effort, background: r.background,
      outputFormat: r.output_format, frameCount: r.frame_count, frameDurationMs: r.frame_duration_ms, gifFrameSize: r.gif_frame_size,
      image: hasBase ? 'quote-base-image' : undefined,
      references: Array.from({ length: r.image_count - Number(hasBase) }, () => ({ url: 'quote-reference-image', role: 'reference' })),
    };
    try { validateImageModelRequest(imageRequest, model); }
    catch { return unresolved(r, 'unsupported', 'Image request conflicts with this model’s generation capabilities.'); }
    const planned = planImageGeneration(imageRequest);
    if (planned.model !== model) return unresolved(r, 'unsupported', 'Requested model cannot serve these parameters.');
    const quote = await quoteImage(model, imagePricingInput(planned.request));
    if (quote.status === 'usage_only') {
      // The admission minimum is not the customer-facing quote.
      return { ...unresolved(r, 'usage_only', 'Final credits are calculated from actual usage after generation.'), model, priceVersion: quote.priceVersion };
    }
    return {
      status: quote.status, request: r, model, resolution: planned.request.imageResolution, priceVersion: quote.priceVersion, credits: quote.credits,
      details: { inputCount: r.image_count, billableInputImages: quote.billableInputImages,
        outputResolutionAffectsCredits: quote.outputResolutionAffectsCredits,
        ...(quote.status === 'preflight_only' ? { settlement: 'Preflight credit estimate. Final credits depend on actual usage.' } : {}) },
    };
  } catch {
    // Never leak DB errors, credentials or connection strings through a tool response.
    return unresolved(r, 'unknown', 'Current pricing could not be read or validated. Do not guess, use stale rates, submit media or silently switch provider.');
  }
}

export async function queryModelPrices(input: z.infer<typeof modelPriceInputSchema>) {
  const { requests } = modelPriceInputSchema.parse(input);
  const observedAt = new Date().toISOString();
  const common = { observedAt, currency: 'credits',
    validity: 'Estimate at the time of inquiry. No expiry/discount calendar is registered. If the user moves on to generation, follow normal routing. Credit purchase promotions and account balance are not queried.',
    authority: 'Makaron customer credit estimates. priceVersion is the price update time when available; observedAt is the read time.',
    billingExplanation: 'Explain total credits and billable quantities in plain language. Keep internal field names, flags and raw tool data out of user-facing replies. If referenceVideoTariffIncludesOutput is true, explain that both output seconds and billable reference seconds use the reference-video tariff. Compare complete quote totals only. Do not divide credits by seconds, state any per-second price, or infer that either unit rate is higher or lower. If asked about the unit rates, say the quote totals do not establish a unit-rate comparison. Do not infer an isolated input fee.',
    scope: 'Read-only media estimate. The quote tool submits no media and deducts no media-generation credits. Agent conversation usage is billed separately when applicable. Do not describe the conversation as free or claim no credits of any kind were consumed.',
    policy: 'Preserve explicit user/Skill choices and capability/quality requirements. Ordinary vague tasks keep existing defaults. Discuss tradeoffs when the user asks about price or budget. A price inquiry does not authorize generation. Unknown is not free. If the requested model/tier is unknown or unavailable, stop with that observed limitation. Do not speculate about billing units, rates or reasons for expense when no quote is available; do not explore or quote substitutes unless the user asks for alternatives. Registry resolution means output size, not proof of native rendering or equal quality; capability details remain owned by the existing model guides. Unavailable in this checkout says nothing about upstream availability.',
  };
  if (!requests.length) return { ...common, catalog: {
    image: listImageModelCapabilities().map(c => ({ model: c.id, resolutions: c.resolutions, maxInputImages: c.maxInputImages,
      pricing: getImageModelRegistration(c.id).pricing.kind, acceptsExtraQuoteOptions: Boolean(getImageModelRegistration(c.id).quoteOptions) })),
    video: listVideoModelCapabilities().map(c => ({ model: c.pricing?.publicModel ?? c.id, resolutions: c.supportedResolutions, minSeconds: c.minOutputDuration, maxSeconds: c.maxOutputDuration,
      ...(c.pricing?.requiresSourceFps ? { requiresSourceFps: true } : {}),
      ...(c.pricing?.requiredVideoInputs ? { requiredVideoInputs: c.pricing.requiredVideoInputs } : {}),
      ...(c.pricing?.requiredAudioInputs ? { requiredAudioInputs: c.pricing.requiredAudioInputs } : {}) })),
    audio: listAudioModelCapabilities().map(c => ({ model: c.id, maxSeconds: c.maxDurationSeconds })),
  } };
  const estimates = await Promise.all(requests.map(estimateModelPrice));
  const priced = estimates.map((e, index) => ({ index, ...e })).filter(e => e.status === 'estimated' && e.credits != null);
  const sameTaskQuantities = new Set(priced.map(e => JSON.stringify([e.request.kind, e.request.operation ?? 'generate',
    e.request.kind === 'image' ? null : e.request.duration_seconds, e.request.image_count, e.request.video_reference_count,
    e.request.reference_video_seconds ?? 0, e.request.audio_reference_count, e.request.reference_audio_seconds ?? 0,
    e.request.reference_image_pixels ?? 0, e.request.output_fps ?? null, e.request.options ?? null]))).size <= 1;
  const comparable = sameTaskQuantities ? priced : [];
  const lowest = comparable.length ? Math.min(...comparable.map(e => e.credits!)) : null;
  return { ...common, estimates, comparison: {
    warning: 'Numerical comparison only, not a quality/capability equivalence or automatic model recommendation. Unknown/preflight-only amounts are excluded.',
    sameTaskQuantities, lowestKnownCredits: lowest,
    rows: comparable.map(e => ({ requestIndex: e.index, credits: e.credits, ratioToLowest: lowest != null && lowest > 0 ? e.credits! / lowest : null,
      atLeastTwiceLowest: lowest != null && lowest > 0 && e.credits! >= lowest * 2 })),
  } };
}

export function createModelPriceTool() {
  return tool({
    description: 'On-demand estimate for user questions about price, budget or model comparisons. Ordinary generation follows its normal routing without this tool. Estimate or compare customer-facing Makaron credits for image, video and audio. Supply all input media counts/durations. Returns estimated credits, billed quantities and factors, or explicit unknown/missing inputs. Preflight estimates are not final charges or caps. Usage-only models quote no amount. Empty requests discovers IDs. Read-only, with no media generation or balance access.',
    inputSchema: modelPriceInputSchema,
    execute: queryModelPrices,
  });
}
