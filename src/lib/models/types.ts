export type ModelId = 'gemini' | 'qwen' | 'pony' | 'wai';

export interface GenerateImageRequest {
  image?: string;           // input image (URL/base64). Missing = text-to-image
  prompt: string;           // English editPrompt
  model?: ModelId;          // explicit model choice (agent tool param or UI selector)
  category?: string;        // tip category (for auto-routing)
  aspectRatio?: string;
  thinkingEffort?: 'minimal' | 'high';
  references?: { url: string; role: string }[];  // multi-image references (Gemini + Qwen)
  fallbackPrompt?: string;  // clean prompt without skill template — used when falling back to a model that can't digest .md templates
}

export interface GenerateImageResult {
  image: string | null;
  model: ModelId;           // model that actually produced the image
  fallbackUsed: boolean;
  failedModels?: ModelId[]; // models that were tried and returned null/error
}

export interface ModelBackend {
  id: ModelId;
  canHandle(req: GenerateImageRequest): boolean;
  generate(req: GenerateImageRequest): Promise<string | null>;
}
