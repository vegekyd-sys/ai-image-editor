/** Models offered to new Agent and MCP requests. */
export const IMAGE_MODEL_IDS = ['gemini', 'gemini-2.1', 'gemini-lite', 'qwen-spicy', 'openai', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'wan2.7-image'] as const;
/** Accept the old Qwen ID at API/tool boundaries; it is normalized before routing and billing. */
export const IMAGE_MODEL_INPUT_IDS = [...IMAGE_MODEL_IDS, 'qwen'] as const;
/** Keep old IDs at the input boundary so existing clients get a deliberate migration/error. */
export type ModelId = typeof IMAGE_MODEL_IDS[number] | 'qwen' | 'pony' | 'wai';
/** Default for ordinary photo edits and image generation; legacy gemini remains selectable. */
export const DEFAULT_IMAGE_MODEL: ModelId = 'gemini-2.1';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type ImageBackground = 'auto' | 'opaque' | 'transparent';

export interface GenerateImageRequest {
  image?: string;           // input image (URL/base64). Missing = text-to-image
  prompt: string;           // English editPrompt
  model?: ModelId;          // explicit model choice (agent tool param or UI selector)
  category?: string;        // tip category (for auto-routing)
  aspectRatio?: string;
  /** Nano Banana 2.1 output resolution, default 1K. */
  imageResolution?: '1K' | '2K' | '4K';
  /** Output background contract. Transparent output defaults to GPT Image 2.5 Flare. */
  background?: ImageBackground;
  thinkingEffort?: ReasoningEffort;
  references?: { url: string; role: string }[];  // multi-image references (Gemini + Qwen)
  fallbackPrompt?: string;  // clean prompt without skill template — used when falling back to a model that can't digest .md templates
  isNsfw?: boolean;         // project-level NSFW flag — skip Gemini entirely when true
  /** Prefer the authenticated user's Codex subscription for GPT Image 2. */
  codexSubscription?: {
    userId: string;
    projectId: string;
    agentModelId?: string;
  };
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
  model: ModelId;           // model that actually produced the image
  fallbackUsed: boolean;
  failedModels?: ModelId[]; // models that were tried and returned null/error
  contentBlocked?: boolean; // Gemini refused content (NSFW) — caller should set isNsfw flag
  usage?: TokenUsage;       // token usage for billing (available for Gemini/OpenRouter)
  provider?: string;        // provider that actually produced the image
}

export interface ModelBackend {
  id: ModelId;
  canHandle(req: GenerateImageRequest): boolean;
  generate(req: GenerateImageRequest): Promise<{ image: string | null; usage?: TokenUsage; provider?: string }>;
}

export const FAL_IMAGE25_IDS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;
export type FalImage25Id = typeof FAL_IMAGE25_IDS[number];
export function isFalImage25(model?: string | null): model is FalImage25Id {
  return FAL_IMAGE25_IDS.some(id => id === model);
}

export function resolveImageModel(model?: ModelId, background?: ImageBackground): ModelId | undefined {
  // Persisted selections and older clients used "openai" for Image 2.
  // Migrate those requests before pricing and provider selection.
  if (model === 'pony' || model === 'wai') throw new Error(`${model} has been retired. Choose an available image model explicitly.`);
  const activeModel = model === 'qwen' ? 'qwen-spicy' : model === 'openai' ? 'gpt-image-2.5-flare' : model;
  return background === 'transparent' && !isFalImage25(activeModel) ? 'gpt-image-2.5-flare' : activeModel;
}
