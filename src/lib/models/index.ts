import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { geminiLiteBackend } from './gemini-lite';
import { qwenBackend } from './qwen';
import { ponyBackend } from './pony';
import { waiBackend } from './wai';
import { openaiBackend } from './openai';
import { createImage25Backend } from './image25';
import { wanImageBackend } from './wan-image';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['gemini-lite', geminiLiteBackend],
  ['qwen', qwenBackend],
  ['pony', ponyBackend],
  ['wai', waiBackend],
  ['openai', openaiBackend],
  ['gpt-image-2.5-flare', createImage25Backend('gpt-image-2.5-flare')],
  ['gpt-image-2.5-sunburst', createImage25Backend('gpt-image-2.5-sunburst')],
  ['wan2.7-image', wanImageBackend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}

export function getAllBackends(): ModelBackend[] {
  return [...backends.values()];
}
