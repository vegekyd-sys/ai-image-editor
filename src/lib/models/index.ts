import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { nanoBanana21Backend } from './nano-banana-21';
import { geminiLiteBackend } from './gemini-lite';
import { qwenSpicyBackend } from './qwen-spicy';
import { createImage26Backend } from './openai-image26';
import { midjourneyBackend } from './midjourney';
import { seedream55Backend } from './seedream55';
import { wanImageBackend } from './wan-image';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['gemini-2.1', nanoBanana21Backend],
  ['gemini-lite', geminiLiteBackend],
  ['qwen-spicy', qwenSpicyBackend],
  // 2.6: the owner's direct OpenAI key first (monthly budget), then fal. Same model, never a model substitute.
  ['gpt-image-2.6-flare', createImage26Backend('gpt-image-2.6-flare')],
  ['gpt-image-2.6-sunburst', createImage26Backend('gpt-image-2.6-sunburst')],
  ['wan2.7-image', wanImageBackend],
  ['mj-v8.2', midjourneyBackend],
  ['seedream-5.5', seedream55Backend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}
