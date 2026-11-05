import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { nanoBanana21Backend } from './nano-banana-21';
import { geminiLiteBackend } from './gemini-lite';
import { qwenSpicyBackend } from './qwen-spicy';
import { createFalImage25Backend } from './fal-image25';
import { midjourneyBackend } from './midjourney';
import { wanImageBackend } from './wan-image';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['gemini-2.1', nanoBanana21Backend],
  ['gemini-lite', geminiLiteBackend],
  ['qwen-spicy', qwenSpicyBackend],
  // 2.6 is explicitly fal-only; the 2.5 provider setting cannot substitute a model.
  ['gpt-image-2.6-flare', createFalImage25Backend('gpt-image-2.6-flare')],
  ['gpt-image-2.6-sunburst', createFalImage25Backend('gpt-image-2.6-sunburst')],
  ['wan2.7-image', wanImageBackend],
  ['mj-v8.2', midjourneyBackend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}
