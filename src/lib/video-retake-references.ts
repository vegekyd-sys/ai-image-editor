import type { ProjectAnimation, Snapshot } from '@/types';
import type { RetakeModel } from './video-retake-contract';

/** Timeline indices are not the provider's image/video positions. */
export function bindRetakeReferences(input: {
  prompt: string;
  model: RetakeModel;
  sourceIndex: number;
  referenceIndices: number[];
  middleIndex?: number;
  endIndex?: number;
  correctedStartIndex?: number;
  correctedEndIndex?: number;
  cameraChange?: boolean;
  boundaryMode?: 'exact' | 'scene';
}): string {
  const indices = [...input.referenceIndices, ...(input.middleIndex ? [input.middleIndex] : []),...(input.endIndex ? [input.endIndex] : []),...(input.correctedStartIndex ? [input.correctedStartIndex] : []),...(input.correctedEndIndex ? [input.correctedEndIndex] : [])];
  if (new Set(indices).size !== indices.length || indices.includes(input.sourceIndex)) {
    throw new Error('Use distinct image references; the source video and middle keyframe have separate roles.');
  }
  for (const index of [...input.referenceIndices,...(input.endIndex ? [input.endIndex] : []),...(input.correctedStartIndex ? [input.correctedStartIndex] : []),...(input.correctedEndIndex ? [input.correctedEndIndex] : [])]) {
    if (!new RegExp(`<<<(?:media|image)_${index}>>>`, 'i').test(input.prompt)) {
      throw new Error(`Reference image @${index} must appear as <<<media_${index}>>> in the final prompt.`);
    }
  }
  return input.prompt.replace(/<<<(?:media|image)_(\d+)>>>/gi, (_, raw: string) => {
    const index = Number(raw);
    if (index === input.correctedStartIndex) return 'Image 1';
    if (index === input.correctedEndIndex) return 'Image 2';
    if(index===input.endIndex) return input.model === 'fal-h3-max' ? 'Image 2' : `<<<image_${input.referenceIndices.length + 1}>>>`;
    if (index === input.sourceIndex) return input.model === 'fal-h3-max'
      ? input.correctedStartIndex || input.endIndex || input.cameraChange || input.boundaryMode === 'scene' ? 'the inspected original scene' : 'Video 1' : input.model === 'kling-4' || input.model === 'kling-4-flash' ? '<<<video_1>>>' : '@video1';
    if (index === input.middleIndex) return 'Image 3';
    const position = input.referenceIndices.indexOf(index);
    if (position < 0) throw new Error(`Media @${index} has no supplied reference. Add its image index to reference_media_indices.`);
    return input.model === 'fal-h3-max'
      ? `Image ${position + (input.middleIndex ? 4 : 3)}`
      : `<<<image_${position + 1}>>>`;
  });
}

/** Retake receipts store the source video first, followed by the submitted image references. */
export function resolveRetakeDetailPrompt(animation: ProjectAnimation, snapshots: Snapshot[], referenceLabel: string): string {
  return animation.prompt.replace(/<<<(?:image|media)_(\d+)>>>/g, (_marker, slot: string) => {
    const position = Number(slot);
    const url = animation.snapshotUrls[position];
    // H3 native frame controls have their own ordering. Its bound agent prompts
    // use plain "Image N" text, not these compact reference markers.
    if (!position || !url || animation.videoModel === 'fal-h3-max'
      || animation.snapshotUrls[0] !== animation.retake?.sourceUrl) return referenceLabel;
    const matches = snapshots.flatMap((snapshot, index) =>
      snapshot.type !== 'video' && !snapshot.videoMeta && (snapshot.imageUrl || snapshot.image) === url ? [index + 1] : [],
    );
    return matches.length === 1 ? `<<<media_${matches[0]}>>>` : referenceLabel;
  });
}
