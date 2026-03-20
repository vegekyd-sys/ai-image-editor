import type { ModelBackend, ModelId } from './types';
import { geminiBackend } from './gemini';
import { qwenBackend } from './qwen';
import { ponyBackend } from './pony';
import { waiBackend } from './wai';

const backends: Map<ModelId, ModelBackend> = new Map([
  ['gemini', geminiBackend],
  ['qwen', qwenBackend],
  ['pony', ponyBackend],
  ['wai', waiBackend],
]);

export function getBackend(id: ModelId): ModelBackend | undefined {
  return backends.get(id);
}

export function getAllBackends(): ModelBackend[] {
  return [...backends.values()];
}
