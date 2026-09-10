import type { FalImage25Id, ModelBackend } from './types';
import { createFalImage25Backend, FalImage25RequestError } from './fal-image25';
import { createSegmindImage25Backend } from './segmind-image25';

/** Explicit provider selection; a failed request never falls through to another provider. */
export function createImage25Backend(model: FalImage25Id): ModelBackend {
  const fal = createFalImage25Backend(model);
  const segmind = createSegmindImage25Backend(model);
  const selected = () => {
    const provider = process.env.GPT_IMAGE25_PROVIDER ?? 'fal';
    if (provider === 'fal') return fal;
    if (provider === 'segmind') return segmind;
    throw new FalImage25RequestError('Invalid GPT_IMAGE25_PROVIDER; expected fal or segmind.');
  };
  return { id: model, canHandle: req => selected().canHandle(req), generate: req => selected().generate(req) };
}
