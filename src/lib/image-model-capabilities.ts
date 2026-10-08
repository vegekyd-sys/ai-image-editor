import type { GenerateImageRequest, ImageBackground, ModelId } from './models/types';

export type ActiveImageModelId = Exclude<ModelId, 'openai' | 'qwen' | 'pony' | 'wai'>;
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
  supportsTransparency: boolean;
  supportsNsfw: boolean;
  promptMode: 'context' | 'edit';
  provider: string;
  notes: string;
}

const STANDARD_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const PANORAMIC_RATIOS = [...STANDARD_RATIOS, '1:4', '4:1', '1:8', '8:1'] as const;
const FLARE: ImageModelCapability = {
  id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', autoPriority: 1,
  maxInputImages: 16, aspectRatio: { kind: 'range', min: 1 / 3, max: 3 },
  supportsTransparency: true, supportsNsfw: false, promptMode: 'context', provider: 'fal',
  notes: 'Primary image model, including product, text, layout, face restoration and director storyboards. Pass the original user brief with prior feedback verbatim. Low quality; no subscription substitution.',
};

/** Current Makaron adapter contracts, not every capability advertised upstream. */
const IMAGE_CAPABILITIES: Record<ActiveImageModelId, ImageModelCapability> = {
  'gpt-image-2.5-flare': FLARE,
  'gpt-image-2.5-sunburst': {
    ...FLARE, id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', autoPriority: undefined,
    notes: 'Explicit Sunburst only; pass the original user brief verbatim. Low quality; no subscription substitution.',
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
  'wan2.7-image': {
    id: 'wan2.7-image', label: 'Wan 2.7 Image', maxInputImages: 9,
    aspectRatio: { kind: 'range', min: 1 / 8, max: 8 },
    supportsTransparency: false, supportsNsfw: false, promptMode: 'edit', provider: 'dashscope',
    notes: 'Explicit Wan only; approximately 1MP, input size/format preflight remains in its provider adapter.',
  },
};

export const DEFAULT_IMAGE_MODEL: ActiveImageModelId = 'gpt-image-2.5-flare';

export function normalizeImageModelId(model?: string | null): ActiveImageModelId | undefined {
  if (!model || model === 'auto') return undefined;
  if (model === 'pony' || model === 'wai') return undefined;
  const id = model === 'openai' ? 'gpt-image-2.5-flare' : model === 'qwen' ? 'qwen-spicy' : model;
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
  const count = (req.image ? 1 : 0) + (req.references?.length ?? 0);
  if (capability.maxInputImages !== undefined && count > capability.maxInputImages) conflicts.push(`inputImages=${count}; supports at most ${capability.maxInputImages} input images including the base`);
  if (req.isNsfw && !capability.supportsNsfw) conflicts.push('NSFW is not supported by this route');
  if (req.background === 'transparent' && !capability.supportsTransparency) conflicts.push('transparent output is not supported');
  if (req.imageResolution && !capability.resolutions?.includes(req.imageResolution)) conflicts.push(`imageResolution=${req.imageResolution}; supported: ${capability.resolutions?.join(', ') ?? 'no imageResolution parameter'}`);
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
  if (req.imageResolution && !capability.resolutions?.includes(req.imageResolution)) {
    request.imageResolution = undefined;
    adjustments.push(`Requested resolution ${req.imageResolution} was left to ${capability.label}'s native output.`);
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
      + (req.imageResolution && !plan.request.imageResolution ? 2 : 0);
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
    'Omit model for Auto. Set model only for a user/active Skill explicit choice. Assess NSFW from the user request and supplied media; set isNsfw=true before generation, never probe another provider first. Existing NSFW context stays active.',
    'Legacy openai means Flare; qwen means Spicy; unversioned nano banana means gemini-2.1. Explicit Nano Banana 2 means gemini; Lite means gemini-lite. Unknown/retired IDs use Auto, Flare first.',
    'Aim to deliver an image instead of reporting capability errors. Prefer retaining reference content, then requested ratio, transparency and resolution. Transparent 8:1 normally uses Nano Banana 2.1 opaque output; another conflict may preserve transparency instead. NSFW always uses Spicy for generation/editing: ignore unsupported size, resolution or alpha requirements. If inputs exceed every suitable model limit, keep the base and first supported references. Explain actual adjustments briefly without calling them a generation failure. No automatic retry or model switch after a failed/unknown paid submission.',
    ...listImageModelCapabilities().map(c => `- ${c.id} (${c.label}): ratio=${ratioDescription(c.aspectRatio)}${c.editAspectRatio ? `; editing ratio=${ratioDescription(c.editAspectRatio)}` : ''}; ${c.maxInputImages === undefined ? 'legacy input limit remains provider-owned' : `max ${c.maxInputImages} total input images`}; ${c.resolutions ? `imageResolution=${c.resolutions.join('/')}` : 'no imageResolution parameter'}; transparent=${c.supportsTransparency}; NSFW=${c.supportsNsfw}. ${c.notes}`),
  ].join('\n');
}
