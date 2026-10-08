import type { RetakeModel } from './video-retake-contract';

/** Timeline indices are not the provider's image/video positions. */
export function bindRetakeReferences(input: {
  prompt: string;
  model: RetakeModel;
  sourceIndex: number;
  referenceIndices: number[];
  middleIndex?: number;
  endIndex?: number;
  cameraChange?: boolean;
}): string {
  const indices = [...input.referenceIndices, ...(input.middleIndex ? [input.middleIndex] : []),...(input.endIndex ? [input.endIndex] : [])];
  if (new Set(indices).size !== indices.length || indices.includes(input.sourceIndex)) {
    throw new Error('Use distinct image references; the source video and middle keyframe have separate roles.');
  }
  for (const index of [...input.referenceIndices,...(input.endIndex ? [input.endIndex] : [])]) {
    if (!new RegExp(`<<<(?:media|image)_${index}>>>`, 'i').test(input.prompt)) {
      throw new Error(`Reference image @${index} must appear as <<<media_${index}>>> in the final prompt.`);
    }
  }
  return input.prompt.replace(/<<<(?:media|image)_(\d+)>>>/gi, (_, raw: string) => {
    const index = Number(raw);
    if(index===input.endIndex) return input.model === 'fal-h3-max' ? 'Image 2' : `<<<image_${input.referenceIndices.length + 1}>>>`;
    if (index === input.sourceIndex) return input.model === 'fal-h3-max'
      ? input.middleIndex || input.endIndex || input.cameraChange ? 'the inspected original scene' : 'Video 1' : '@video1';
    if (index === input.middleIndex) return 'Image 3';
    const position = input.referenceIndices.indexOf(index);
    if (position < 0) throw new Error(`Media @${index} has no supplied reference. Add its image index to reference_media_indices.`);
    return input.model === 'fal-h3-max'
      ? `Image ${position + (input.middleIndex ? 4 : 3)}`
      : `<<<image_${position + 1}>>>`;
  });
}
