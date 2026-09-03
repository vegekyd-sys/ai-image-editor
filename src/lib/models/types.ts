export const IMAGE_MODEL_IDS = ['gemini', 'gemini-lite', 'qwen', 'pony', 'wai', 'openai', 'wan2.7-image'] as const;
export type ModelId = typeof IMAGE_MODEL_IDS[number];
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type ImageBackground = 'auto' | 'opaque' | 'transparent';

export interface GenerateImageRequest {
  image?: string;           // input image (URL/base64). Missing = text-to-image
  prompt: string;           // English editPrompt
  model?: ModelId;          // explicit model choice (agent tool param or UI selector)
  category?: string;        // tip category (for auto-routing)
  aspectRatio?: string;
  /** Output background contract. Transparent output is currently GPT Image 2 only. */
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
