import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { qwenBackend } from './qwen';
import { ponyBackend } from './pony';
import { waiBackend } from './wai';
import { openaiBackend } from './openai';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['qwen', qwenBackend],
  ['pony', ponyBackend],
  ['wai', waiBackend],
  ['openai', openaiBackend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}

export function getAllBackends(): ModelBackend[] {
  return [...backends.values()];
}
