import { ensureJpeg } from '../gemini';
import { buildCameraPrompt, snapToNearest, AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS } from '../camera-utils';
import { InferenceClient } from '@huggingface/inference';
import type { SkillContext, SkillResult } from './index';

export interface RotateCameraInput {
  azimuth: number;    // 0-360
  elevation: number;  // -30 to 60
  distance: number;   // 0.6 to 1.4
}

export async function rotateCamera(
  input: RotateCameraInput,
  ctx: SkillContext,
): Promise<SkillResult> {
  const { azimuth, elevation, distance } = input;
  const image = ctx.currentImage;
  if (!image) return { success: false, message: 'No image available' };

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) return { success: false, message: 'HF_TOKEN not configured' };

  const prompt = buildCameraPrompt(azimuth, elevation, distance);

  try {
    // Convert image to Blob (URL or base64)
    let imgBytes: Uint8Array;
    if (image.startsWith('http')) {
      const res = await fetch(image);
      imgBytes = new Uint8Array(await res.arrayBuffer());
    } else {
      const raw = image.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(raw, 'base64');
      imgBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const blob = new Blob([imgBytes as BlobPart], { type: 'image/jpeg' });

    const client = new InferenceClient(hfToken);
    const result = await client.imageToImage({
      provider: 'fal-ai',
      model: 'fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA',
      inputs: blob,
      parameters: { prompt },
    });

    const resultBuf = Buffer.from(await result.arrayBuffer());
    const rawBase64 = `data:image/png;base64,${resultBuf.toString('base64')}`;
    const resultBase64 = await ensureJpeg(rawBase64);

    const azName = AZIMUTH_MAP[snapToNearest(azimuth, AZIMUTH_STEPS)];
    const elName = ELEVATION_MAP[snapToNearest(elevation, ELEVATION_STEPS)];
    const dsName = DISTANCE_MAP[snapToNearest(distance, DISTANCE_STEPS)];
    return { success: true, message: `Camera rotated: ${azName}, ${elName}, ${dsName}`, image: resultBase64 };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}
