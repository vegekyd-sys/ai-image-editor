import { AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS, snapToNearest } from '../camera-utils';
import { generateWithFalQwenRotate } from '../fal-qwen-rotate';
import type { SkillContext, SkillResult } from './index';

export interface RotateCameraInput {
  azimuth: number;    // 0-360
  elevation: number;  // -30 to 60
  distance: number;   // 0.6 to 1.4
}

export async function rotateCamera(input: RotateCameraInput, ctx: SkillContext): Promise<SkillResult> {
  if (!ctx.currentImage) return { success: false, message: 'No image available' };

  const azName = AZIMUTH_MAP[snapToNearest(input.azimuth % 360, AZIMUTH_STEPS)];
  const elName = ELEVATION_MAP[snapToNearest(input.elevation, ELEVATION_STEPS)];
  const dsName = DISTANCE_MAP[snapToNearest(input.distance, DISTANCE_STEPS)];

  try {
    const result = await generateWithFalQwenRotate({ ...input, image: ctx.currentImage });
    return {
      success: true,
      message: `Camera rotated: ${azName}, ${elName}, ${dsName}. Provider: fal; request: ${result.requestId}.`,
      image: result.image,
      provider: 'fal',
    };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Camera rotation failed.' };
  }
}
