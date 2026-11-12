import type { GenerateImageRequest, ImageBackground, ModelId } from './models/types';

export type ActiveImageModelId = Exclude<ModelId, 'openai' | 'qwen' | 'pony' | 'wai' | 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst'>;
export type ImageAspectRatioCapability =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'source' };

export interface ImageModelCapability {
  id: ActiveImageModelId;
  label: string;
  /** Only these models participate in automatic selection, in ascending order. */
  autoPriority?: number;
  maxInputImages?: number;
  textToImageSize?: { longSide: number; minShortSide: number };
  aspectRatio: ImageAspectRatioCapability;
  editAspectRatio?: ImageAspectRatioCapability;
  resolutions?: readonly string[];
  /** Native 4K at this edge fits the provider pixel budget only at this ratio or wider. */
  fourKSize?: { longSide: number; minLongToShortRatio: number };
  supportsTransparency: boolean;
  supportsNsfw: boolean;
  promptMode: 'context' | 'edit' | 'scene';
  provider: string;
  notes: string;
}

const STANDARD_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const PANORAMIC_RATIOS = [...STANDARD_RATIOS, '1:4', '4:1', '1:8', '8:1'] as const;
const FLARE: ImageModelCapability = {
  id: 'gpt-image-2.6-flare', label: 'GPT Image 2.6 Flare', autoPriority: 1,
  maxInputImages: 16, aspectRatio: { kind: 'range', min: 1 / 3, max: 3 },
  resolutions: ['1K', '2K', '4K'], fourKSize: { longSide: 3840, minLongToShortRatio: 16 / 9 },
  supportsTransparency: true, supportsNsfw: false, promptMode: 'context', provider: 'fal',
  notes: 'Primary image model, including product, text, layout, face restoration and director storyboards. Pass the original user brief with prior feedback verbatim. Native 2K up to 2048 long edge; 4K uses 3840 long edge, <=8294400 pixels, so requires 16:9 through 3:1 landscape or portrait. 4K without a ratio defaults to 16:9. Square 4K requires Nano Banana 2.1; transparent square 4K relaxes to 2K. Default low quality and high reasoning. Administrator Codex Subscription Agents use this same image tool; image API usage is billed separately.',
};

/** Current Makaron adapter contracts, not every capability advertised upstream. */
const IMAGE_CAPABILITIES: Record<ActiveImageModelId, ImageModelCapability> = {
  'gpt-image-2.6-flare': {
    ...FLARE, id: 'gpt-image-2.6-flare', label: 'GPT Image 2.6 Flare', autoPriority: 1,
    notes: 'GPT Image 2.6 Flare via the direct OpenAI key first (monthly budget), then fal. PNG/JPEG/WebP, animated GIF (generation/edit), SVG vector (text-to-image only). imageQuality auto/low/medium/high, imageReasoningEffort low/medium/high; default low quality + high reasoning. Up to 16 ordered inputs; native 1K/2K/4K, ratio 1:3–3:1, max edge 3840 and 8294400 pixels. GIF frameCount 2–16 (provider-enforced), frameDurationMs 20–2000 in steps of 10; frames are drawn on one native sheet, so square frames are 960px up to 9 frames, 816px for 10–12 and 720px for 13–16; gifFrameSize sticker uses ~512px frames at about half the cost. New GIF stickers/memes/loops follow skills/gif-maker/SKILL.md. GIF 2K/4K is unsupported. SVG requires no source/references; a text model traces the raster into vector paths; verified live on both direct OpenAI and fal (2026-11-05). Never silently rasterize. Unsupported format/tier requests fail before generation, never flatten or substitute.',
  },
  'gpt-image-2.6-sunburst': {
    ...FLARE, id: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst', autoPriority: undefined,
    notes: 'GPT Image 2.6 Sunburst via the direct OpenAI key first (monthly budget), then fal. PNG/JPEG/WebP, animated GIF (generation/edit), SVG vector (text-to-image only). imageQuality auto/low/medium/high, imageReasoningEffort low/medium/high; default low quality + high reasoning. Up to 16 ordered inputs; native 1K/2K/4K, ratio 1:3–3:1, max edge 3840 and 8294400 pixels. GIF frameCount 2–16 (provider-enforced), frameDurationMs 20–2000 in steps of 10; frames are drawn on one native sheet, so square frames are 960px up to 9 frames, 816px for 10–12 and 720px for 13–16; gifFrameSize sticker uses ~512px frames at about half the cost. New GIF stickers/memes/loops follow skills/gif-maker/SKILL.md. GIF 2K/4K is unsupported. SVG requires no source/references; a text model traces the raster into vector paths; verified live on both direct OpenAI and fal (2026-11-05). Never silently rasterize. Unsupported format/tier requests fail before generation, never flatten or substitute.',
  },
  'gemini-2.1': {
    id: 'gemini-2.1', label: 'Nano Banana 2.1', autoPriority: 2, maxInputImages: 14,
    aspectRatio: { kind: 'enum', values: PANORAMIC_RATIOS }, resolutions: ['1K', '2K', '4K'],
    supportsTransparency: false, supportsNsfw: false, promptMode: 'edit', provider: 'openrouter',
    notes: 'Panoramic generation and reference editing. Default 1K; request 2K/4K only when asked. Native aspect-ratio presets do not promise exact mathematical ratios or user pixel dimensions (8:1 at 1K currently yields 2928x352).',
  },
  'qwen-spicy': {
    id: 'qwen-spicy', label: 'Qwen Spicy', autoPriority: 3, maxInputImages: 3,
    textToImageSize: { longSide: 1536, minShortSide: 256 },
    aspectRatio: { kind: 'range', min: 1 / 6, max: 6 }, editAspectRatio: { kind: 'source' },
    supportsTransparency: false, supportsNsfw: true, promptMode: 'edit', provider: 'mulerouter',
    notes: 'NSFW routes here directly. Text-to-image uses Z-Image (long side 1536, minimum short side 256); Qwen image editing exposes no hard output-ratio control. Provider may still reject content.',
  },
  gemini: {
    id: 'gemini', label: 'Nano Banana 2', maxInputImages: 14,
    aspectRatio: { kind: 'enum', values: PANORAMIC_RATIOS },
    supportsTransparency: false, supportsNsfw: false, promptMode: 'edit', provider: 'gemini',
    notes: 'Explicit classic Nano Banana 2 only; configured legacy Gemini adapter. No imageResolution control in Makaron.',
  },
  'gemini-lite': {
    id: 'gemini-lite', label: 'Nano Banana 2 Lite', maxInputImages: 14,
    aspectRatio: { kind: 'enum', values: STANDARD_RATIOS },
    supportsTransparency: false, supportsNsfw: false, promptMode: 'edit', provider: 'openrouter',
    notes: 'Explicit fast draft model only; no imageResolution control in Makaron.',
  },
  'mj-v8.2': {
    id: 'mj-v8.2', label: 'Midjourney V8.2', maxInputImages: 20,
    aspectRatio: { kind: 'range', min: 1 / 14, max: 14 }, resolutions: ['1K', '2K'],
    supportsTransparency: false, supportsNsfw: false, promptMode: 'scene', provider: 'evolink',
    notes: 'Explicit creative generation only. Fast returns 4 candidates; Draft returns 24 small drafts; HD returns 4 regenerated candidates, not lossless upscaling. 2K means native HD, approximate size, ratio <=4:1/1:4. Pass the original natural-language brief; the adapter prepares the concise scene prompt. Omit media_index: no precise source edit, alpha cutout, strict identity or Edit Model. Generic references are image prompts (loose inspiration); use midjourney style references for appearance. Do not switch to MJ for required edits. No automatic fallback or paid resubmission.',
  },
  'seedream-5.5': {
    id: 'seedream-5.5', label: 'Seedream 5.5', maxInputImages: 10,
    aspectRatio: { kind: 'enum', values: [...STANDARD_RATIOS, '1:2', '2:1', '1:3', '3:1', '9:21'] },
    resolutions: ['1K', '1.5K', '2K', '3K'], supportsTransparency: true, supportsNsfw: false,
    promptMode: 'context', provider: 'wavespeed',
    notes: 'Explicit candidate only; never Auto. WaveSpeed bytedance/seedream-v5.5, /edit when any input exists; up to 10 ordered inputs including the base. PNG (default) or JPEG, native transparent PNG; no quality/reasoning/GIF/SVG controls. Default 1K. Editing without a ratio keeps the first input shape; tier does not promise exact pixel dimensions. One paid submission only; preserve task receipt and query the same task on failure/timeout. No provider/model fallback. Published output tariff $0.02/$0.02/$0.027/$0.054 for 1K/1.5K/2K/3K, plus $0.008 per input; invoice and real quality/latency not yet verified.',
  },
  'wan2.7-image': {
    id: 'wan2.7-image', label: 'Wan 2.7 Image', maxInputImages: 9,
    aspectRatio: { kind: 'range', min: 1 / 8, max: 8 },
    supportsTransparency: false, supportsNsfw: false, promptMode: 'edit', provider: 'dashscope',
    notes: 'Explicit Wan only; approximately 1MP, input size/format preflight remains in its provider adapter.',
  },
};

export const DEFAULT_IMAGE_MODEL: ActiveImageModelId = 'gpt-image-2.6-flare';

export function normalizeImageModelId(model?: string | null): ActiveImageModelId | undefined {
  if (!model || model === 'auto') return undefined;
  if (model === 'pony' || model === 'wai') return undefined;
  const id = model === 'openai' || model === 'gpt-image-2.5-flare' ? 'gpt-image-2.6-flare' : model === 'gpt-image-2.5-sunburst' ? 'gpt-image-2.6-sunburst' : model === 'qwen' ? 'qwen-spicy' : model;
  if (!Object.hasOwn(IMAGE_CAPABILITIES, id)) return undefined;
  return id as ActiveImageModelId;
}

export function getImageModelCapability(model: string): ImageModelCapability {
  const id = normalizeImageModelId(model);
  return IMAGE_CAPABILITIES[id ?? DEFAULT_IMAGE_MODEL];
}

export function listImageModelCapabilities(): ImageModelCapability[] {
  return Object.values(IMAGE_CAPABILITIES);
}

/** Preserve the existing transparent-output override, including selected Sunburst. */
export function resolveImageModel(model?: string, background?: ImageBackground): ActiveImageModelId | undefined {
  const id = normalizeImageModelId(model);
  return background === 'transparent' && (!id || !getImageModelCapability(id).supportsTransparency)
    ? DEFAULT_IMAGE_MODEL : id;
}

function ratioDescription(ratio: ImageAspectRatioCapability): string {
  if (ratio.kind === 'enum') return ratio.values.join(', ');
  if (ratio.kind === 'source') return 'source/model-chosen canvas; no hard output-ratio control';
  return `1:${1 / ratio.min} portrait through ${ratio.max}:1 landscape`;
}

export function getImageRequestConflicts(req: GenerateImageRequest, capability: ImageModelCapability): string[] {
  const conflicts: string[] = [];
  const format = req.outputFormat ?? 'png';
  const is26 = capability.id.startsWith('gpt-image-2.6-');
  if (((req.outputFormat && !(capability.id === 'seedream-5.5' && ['png', 'jpeg'].includes(req.outputFormat))) || req.imageQuality || req.imageReasoningEffort || req.frameCount !== undefined || req.frameDurationMs !== undefined || req.gifFrameSize !== undefined) && !is26) conflicts.push('explicit image format/quality/reasoning controls require GPT Image 2.6');
  if (!['png', 'jpeg', 'webp', 'gif', 'svg'].includes(format)) conflicts.push('unsupported outputFormat');
  if (format === 'svg' && (req.image || req.references?.length)) conflicts.push('SVG supports text-to-image only; omit source and references');
  if (req.background === 'transparent' && format === 'jpeg') conflicts.push('JPEG cannot preserve transparency');
  if (req.imageQuality && !['auto', 'low', 'medium', 'high'].includes(req.imageQuality)) conflicts.push('unsupported imageQuality');
  if (req.imageReasoningEffort && !['low', 'medium', 'high'].includes(req.imageReasoningEffort)) conflicts.push('unsupported imageReasoningEffort');
  if ((req.frameCount !== undefined || req.frameDurationMs !== undefined || req.gifFrameSize !== undefined) && format !== 'gif') conflicts.push('frame controls require outputFormat=gif');
  if (req.gifFrameSize !== undefined && !['sticker', 'full'].includes(req.gifFrameSize)) conflicts.push('gifFrameSize must be sticker or full');
  if (req.frameCount !== undefined && (!Number.isInteger(req.frameCount) || req.frameCount < 2 || req.frameCount > 16)) conflicts.push('frameCount must be an integer 2–16');
  if (req.frameDurationMs !== undefined && (!Number.isInteger(req.frameDurationMs) || req.frameDurationMs < 20 || req.frameDurationMs > 2000 || req.frameDurationMs % 10 !== 0)) conflicts.push('frameDurationMs must be 20–2000 in steps of 10');
  const count = (req.image ? 1 : 0) + (req.references?.length ?? 0);
  if (capability.id === 'mj-v8.2') {
    if (req.image) conflicts.push('precise source-image editing is not supported; omit the source only for a new generation');
    if ((req.midjourney?.quality === 'hd' || req.imageResolution === '2K') && req.aspectRatio && req.aspectRatio !== 'auto') {
      const [w, h] = req.aspectRatio.split(':').map(Number);
      if (w / h > 4 || w / h < 1 / 4) conflicts.push('HD requires ratio between 1:4 and 4:1');
    }
  }
  if (capability.maxInputImages !== undefined && count > capability.maxInputImages) conflicts.push(`inputImages=${count}; supports at most ${capability.maxInputImages} input images including the base`);
  if (req.isNsfw && !capability.supportsNsfw) conflicts.push('NSFW is not supported by this route');
  if (req.background === 'transparent' && !capability.supportsTransparency) conflicts.push('transparent output is not supported');
  if (req.imageResolution && !capability.resolutions?.includes(req.imageResolution)) conflicts.push(`imageResolution=${req.imageResolution}; supported: ${capability.resolutions?.join(', ') ?? 'no imageResolution parameter'}`);
  if (req.imageResolution === '4K' && capability.fourKSize && req.aspectRatio && req.aspectRatio !== 'auto') {
    const [w, h] = req.aspectRatio.split(':').map(Number);
    const ratio = Math.max(w / h, h / w);
    if (Number.isFinite(ratio) && ratio < capability.fourKSize.minLongToShortRatio) conflicts.push('imageResolution=4K exceeds the pixel budget at this ratio; use 2K or another model');
  }
  if (req.aspectRatio && req.aspectRatio !== 'auto') {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(req.aspectRatio);
    const ratio = match ? Number(match[1]) / Number(match[2]) : NaN;
    const contract = count > 0 ? capability.editAspectRatio ?? capability.aspectRatio : capability.aspectRatio;
    const supported = Number.isFinite(ratio) && ratio > 0 && (contract.kind === 'enum'
      ? contract.values.includes(req.aspectRatio)
      : contract.kind === 'range' && ratio >= contract.min && ratio <= contract.max);
    if (!supported) conflicts.push(`aspectRatio=${req.aspectRatio}; supported: ${ratioDescription(contract)}`);
  }
  return conflicts;
}

export class ImageCapabilityError extends Error {
  readonly code = 'unsupported_image_capability';
  constructor(public readonly model: string | undefined, public readonly conflicts: string[], public readonly compatibleModels: ActiveImageModelId[]) {
    super(`${model ? `${getImageModelCapability(model).label} cannot satisfy this request` : 'No automatic image model can satisfy this request'}: ${conflicts.join('; ')}. ${compatibleModels.length ? `Compatible models: ${compatibleModels.join(', ')}.` : 'No compatible image model is available.'} No generation was submitted. Do not change the requested canvas or drop references.`);
  }
}

export function validateImageModelRequest(req: GenerateImageRequest, model: string): void {
  const conflicts = getImageRequestConflicts(req, getImageModelCapability(model));
  if (conflicts.length) throw new ImageCapabilityError(model, conflicts, listImageModelCapabilities()
    .filter(c => !getImageRequestConflicts(req, c).length).map(c => c.id));
}

export interface ImageGenerationPlan {
  model: ActiveImageModelId;
  request: GenerateImageRequest;
  adjustments: string[];
}

/** Project a request onto a provider's real contract before any paid submission. */
export function prepareImageModelRequest(req: GenerateImageRequest, model: ActiveImageModelId): ImageGenerationPlan {
  const capability = getImageModelCapability(model);
  const request = { ...req, model };
  const adjustments: string[] = [];
  const referenceLimit = Math.max(0, (capability.maxInputImages ?? Infinity) - (req.image ? 1 : 0));
  if (req.references && req.references.length > referenceLimit) {
    request.references = req.references.slice(0, referenceLimit);
    adjustments.push(`Used the first ${capability.maxInputImages} input images supported by ${capability.label}, keeping the base image.`);
  }
  if (getImageRequestConflicts(request, capability).some(reason => reason.startsWith('aspectRatio='))) {
    request.aspectRatio = undefined;
    adjustments.push(`Requested ratio ${req.aspectRatio} was left to ${capability.label}'s available canvas.`);
  }
  if (getImageRequestConflicts(request, capability).some(reason => reason.startsWith('imageResolution='))) {
    request.imageResolution = req.imageResolution === '4K' && capability.fourKSize ? '2K' : undefined;
    adjustments.push(request.imageResolution === '2K'
      ? `Used native 2K to retain the requested canvas and other image requirements within ${capability.label}'s pixel limit.`
      : `Requested resolution ${req.imageResolution} was left to ${capability.label}'s native output.`);
  }
  if (req.background === 'transparent' && !capability.supportsTransparency) {
    request.background = 'opaque';
    adjustments.push('Generated an opaque image to preserve the other requested content and canvas.');
  }
  return { model, request, adjustments };
}

/** Prefer delivering an image. Capabilities guide tradeoffs instead of blocking users. */
export function planImageGeneration(req: GenerateImageRequest): ImageGenerationPlan {
  const normalized = normalizeImageModelId(req.model);
  if (req.outputFormat || req.imageQuality || req.imageReasoningEffort || req.frameCount !== undefined || req.frameDurationMs !== undefined || req.gifFrameSize !== undefined) {
    const selected = resolveImageModel(req.model, req.background) ?? DEFAULT_IMAGE_MODEL;
    validateImageModelRequest(req, selected);
    return { model: selected, request: { ...req, model: selected }, adjustments: [] };
  }
  // Candidate requests are exact: do not silently change the paid experiment's model or inputs.
  if (normalized === 'seedream-5.5') {
    validateImageModelRequest(req, normalized);
    return { model: normalized, request: { ...req, model: normalized }, adjustments: [] };
  }
  // Explicit batch generation has a different editing contract. Never silently reroute it.
  if (normalized === 'mj-v8.2') {
    validateImageModelRequest(req, normalized);
    return { model: normalized, request: { ...req, model: normalized }, adjustments: [] };
  }
  const explicit = resolveImageModel(req.model, req.background);
  const ranked = listImageModelCapabilities().filter(c => c.autoPriority !== undefined)
    .sort((a, b) => a.autoPriority! - b.autoPriority!).map(c => c.id);
  const candidates = req.isNsfw || normalized === 'qwen-spicy' ? ['qwen-spicy' as const]
    : [...new Set([...(explicit ? [explicit] : []), ...ranked])];
  const originalCount = (req.image ? 1 : 0) + (req.references?.length ?? 0);
  const plans = candidates.map(model => {
    const plan = prepareImageModelRequest(req, model);
    const count = (plan.request.image ? 1 : 0) + (plan.request.references?.length ?? 0);
    // Content references first, then canvas, transparency, resolution; stable ties preserve preference/rank.
    const loss = (originalCount - count) * 100
      + (req.aspectRatio && req.aspectRatio !== 'auto' && !plan.request.aspectRatio ? 10 : 0)
      + (req.background === 'transparent' && plan.request.background !== 'transparent' ? 5 : 0)
      + (req.imageResolution && plan.request.imageResolution !== req.imageResolution ? 2 : 0);
    return { plan, loss };
  }).sort((a, b) => a.loss - b.loss);
  const plan = plans[0].plan;
  if (req.model && req.model !== 'auto' && !normalized) plan.adjustments.unshift(`Unrecognized or retired image model ${req.model}; used capability-aware Auto.`);
  else if (normalized && normalized !== plan.model) plan.adjustments.unshift(`Used ${getImageModelCapability(plan.model).label} to meet more of the requested image requirements.`);
  return plan;
}

export function resolveImageModelChain(req: GenerateImageRequest): ActiveImageModelId[] {
  return [planImageGeneration(req).model];
}

export function formatImageCapabilitiesForAgent(): string {
  return [
    'Image Model Capability (current Makaron routes):',
    `Auto priority: ${listImageModelCapabilities().filter(c => c.autoPriority !== undefined).sort((a, b) => a.autoPriority! - b.autoPriority!).map(c => c.id).join(' > ')}. Prefer compatible models, then relax conflicting output preferences to deliver an image.`,
    'Omit model for Auto. Set model only for a user/active Skill explicit choice. Assess NSFW (nudity, sexual content, gore or explicit edits) from the user request and supplied media; set isNsfw=true before generation, never probe another provider first. Existing NSFW context stays active.',
    'Context Mode (promptMode=context): pass the user request verbatim as editPrompt; do not rewrite, translate, expand, or invent layout/color details. Include prior feedback for multi-turn layout/mockup image tasks. Edit Mode follows the face, edit and preservation rules in the tool contract and image guide.',
    'Scene Mode (promptMode=scene, MJ): pass the original user brief, without translating or adding Edit Mode face/source-preservation boilerplate. The adapter compiles the scene and structured parameters. Describe completion as a batch of candidates; the user picks one before exact refinement.',
    'Legacy openai means Flare; qwen means Spicy; unversioned nano banana means gemini-2.1. Explicit Nano Banana 2 means gemini; Lite means gemini-lite. Unknown/retired IDs use Auto, Flare first.',
    'Aim to deliver an image instead of reporting capability errors. Prefer retaining reference content, then requested ratio, transparency and resolution. Transparent 8:1 normally uses Nano Banana 2.1 opaque output; another conflict may preserve transparency instead. NSFW always uses Spicy for generation/editing: ignore unsupported size, resolution or alpha requirements. If inputs exceed every suitable model limit, keep the base and first supported references. Explain actual adjustments briefly without calling them a generation failure. Unknown paid submissions must not be repeated. The shared image executor alone may recover an independently assessed benignCharacterContent request with one strictly compatible alternate after a terminal provider refusal. Never add caller retries or infer NSFW from a refusal.',
    ...listImageModelCapabilities().map(c => `- ${c.id} (${c.label}): ratio=${ratioDescription(c.aspectRatio)}${c.editAspectRatio ? `; editing ratio=${ratioDescription(c.editAspectRatio)}` : ''}; ${c.maxInputImages === undefined ? 'legacy input limit remains provider-owned' : `max ${c.maxInputImages} total input images`}; ${c.resolutions ? `imageResolution=${c.resolutions.join('/')}` : 'no imageResolution parameter'}; promptMode=${c.promptMode}; transparent=${c.supportsTransparency}; NSFW=${c.supportsNsfw}. ${c.notes}`),
  ].join('\n');
}
