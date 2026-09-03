import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { geminiLiteBackend } from './gemini-lite';
import { qwenBackend } from './qwen';
import { ponyBackend } from './pony';
import { waiBackend } from './wai';
import { openaiBackend } from './openai';
import { wanImageBackend } from './wan-image';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['gemini-lite', geminiLiteBackend],
  ['qwen', qwenBackend],
  ['pony', ponyBackend],
  ['wai', waiBackend],
  ['openai', openaiBackend],
  ['wan2.7-image', wanImageBackend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}

export function getAllBackends(): ModelBackend[] {
  return [...backends.values()];
}
