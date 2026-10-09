import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { nanoBanana21Backend } from './nano-banana-21';
import { geminiLiteBackend } from './gemini-lite';
import { qwenSpicyBackend } from './qwen-spicy';
import { createImage25Backend } from './image25';
import { wanImageBackend } from './wan-image';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['gemini-2.1', nanoBanana21Backend],
  ['gemini-lite', geminiLiteBackend],
  ['qwen-spicy', qwenSpicyBackend],
  ['gpt-image-2.5-flare', createImage25Backend('gpt-image-2.5-flare')],
  ['gpt-image-2.5-sunburst', createImage25Backend('gpt-image-2.5-sunburst')],
  ['wan2.7-image', wanImageBackend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}
