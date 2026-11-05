/** Models offered to new Agent and MCP requests. */
export const IMAGE_MODEL_IDS = ['gemini', 'gemini-2.1', 'gemini-lite', 'qwen-spicy', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'wan2.7-image', 'mj-v8.2'] as const;
/** Accept the old Qwen ID at API/tool boundaries; it is normalized before routing and billing. */
export const IMAGE_MODEL_INPUT_IDS = [...IMAGE_MODEL_IDS, 'openai', 'qwen', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;
/** Keep old IDs at the input boundary so existing clients get a capability-aware migration. */
export type ModelId = typeof IMAGE_MODEL_IDS[number] | 'openai' | 'qwen' | 'pony' | 'wai' | 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst';
/** Default for ordinary photo edits and image generation; legacy gemini remains selectable. */
export { DEFAULT_IMAGE_MODEL, resolveImageModel } from '../image-model-capabilities';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageReasoningEffort = 'low' | 'medium' | 'high';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg';
export type ImageGenerationOptions = { imageQuality?: ImageQuality; imageReasoningEffort?: ImageReasoningEffort; outputFormat?: ImageOutputFormat; frameCount?: number; frameDurationMs?: number; gifFrameSize?: GifFrameSize };
/** GIF frame canvas: sticker = ~512px frames (about half the cost and faster), full = largest native sheet size. */
export type GifFrameSize = 'sticker' | 'full';
export type ImageBackground = 'auto' | 'opaque' | 'transparent';

export interface GenerateImageRequest extends ImageGenerationOptions {
  image?: string;           // input image (URL/base64). Missing = text-to-image
  prompt: string;           // model contract owns scene/context/edit preparation
  model?: string;          // explicit model preference; unknown IDs use Auto
  category?: string;        // tip category (for auto-routing)
  aspectRatio?: string;
  /** Native resolution preference, planned against each image model's canvas limits. */
  imageResolution?: string;
  /** Output background contract. Transparent output defaults to GPT Image 2.6 Flare. */
  background?: ImageBackground;
  thinkingEffort?: ReasoningEffort;
  references?: { url: string; role: string }[];  // multi-image references (Gemini + Qwen)
  midjourney?: Omit<import('../midjourney').MidjourneyRequest, 'prompt' | 'aspectRatio' | 'imageUrls'>;
  /** Persist accepted MJ receipt before polling; server-side only. */
  onMidjourneyReceipt?: (task: import('../midjourney').MidjourneyTask, request: import('../midjourney').MidjourneyRequest) => Promise<void>;
  isNsfw?: boolean;         // project-level NSFW flag — skip Gemini entirely when true

}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: string;          // full model ID for billing (e.g. 'gemini-3.1-flash-image-preview')
  /** Provider-reported exact routed cost when available (for example OpenRouter). */
  providerCostUsd?: number;
  /** Actual provider used. Codex subscription usage is not billed as Makaron API usage. */
  provider?: string;
}

export interface GenerateImageResult {
  image: string | null;
  images?: string[];          // complete batch, includes image at index 0
  taskId?: string;
  model: ModelId;           // model that actually produced the image
  fallbackUsed: boolean;
  adjustments?: string[];  // capability preferences relaxed before submission
  contentBlocked?: boolean; // Gemini refused content (NSFW) — caller should set isNsfw flag
  usage?: TokenUsage;       // token usage for billing (available for Gemini/OpenRouter)
  provider?: string;        // provider that actually produced the image
}

export interface ModelBackend {
  id: ModelId;
  canHandle(req: GenerateImageRequest): boolean;
  generate(req: GenerateImageRequest): Promise<{ image: string | null; images?: string[]; taskId?: string; adjustments?: string[]; usage?: TokenUsage; provider?: string }>;
}

export const FAL_IMAGE25_IDS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;
export type FalImage25Id = typeof FAL_IMAGE25_IDS[number];
export function isFalImage25(model?: string | null): model is FalImage25Id {
  return FAL_IMAGE25_IDS.some(id => id === model);
}

export const FAL_IMAGE26_IDS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] as const;
export type FalImage26Id = typeof FAL_IMAGE26_IDS[number];
export type FalGptImageId = FalImage25Id | FalImage26Id;
export function isFalGptImage(model?: string | null): model is FalGptImageId {
  return isFalImage25(model) || FAL_IMAGE26_IDS.some(id => id === model);
}
