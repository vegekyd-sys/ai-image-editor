import { generateImage } from '../model-router';
import type { ImageBackground } from '../models/types';
import type { SkillContext, SkillResult } from './index';
import { ProviderImageInputError } from '../provider-image-preflight';
import { FalImage25RequestError } from '../models/fal-image25';
import { NanoBanana21RequestError } from '../models/nano-banana-21';
import { WanImageRequestError } from '../models/wan-image';
import { ImageCapabilityError, planImageGeneration } from '../image-model-capabilities';

export interface EditImageInput {
  editPrompt: string;
  skill?: 'enhance' | 'creative' | 'wild' | 'captions';
  aspectRatio?: string;
  imageResolution?: string;
  /** Explicit output background. Transparent requests default to Flare and preserve selected Sunburst. */
  background?: ImageBackground;
  /** Explicit model preference, normalized and planned against capabilities. */
  preferredModel?: string;
  /** Main Agent assessment routes directly to Spicy. */
  isNsfw?: boolean;
}

export async function editImage(
  input: EditImageInput,
  ctx: SkillContext,
): Promise<SkillResult> {
  const { editPrompt, skill, aspectRatio, imageResolution, background, preferredModel, isNsfw } = input;
  const requestedModel = preferredModel;
  const hasReference = !!ctx.referenceImages?.length;

  // Agent reads skill templates via read_file and internalizes rules into editPrompt.
  // No template injection here — keeps the prompt short for the image generation model.
  const finalPrompt = editPrompt;

  const t0 = Date.now();
  console.log(`\n🎨 [edit_image] skill=${skill ?? 'none'} hasReference=${hasReference} model=${requestedModel ?? 'auto'} background=${background ?? 'default'}\neditPrompt: ${editPrompt.slice(0, 200)}\n`);

  // Build references array for multi-image mode
  let references: { url: string; role: string }[] | undefined;
  if (hasReference && ctx.currentImage) {
    const refs = ctx.referenceImages!;
    console.log(`📸 Multi-image mode (${refs.length} user reference(s))`);
    references = [
      { url: ctx.currentImage, role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景】' },
      ...refs.map((r, i) => ({ url: r, role: `Image ${i + 2} = 用户上传的参考图${refs.length > 1 ? `（第${i + 1}张）` : ''}【按用户指令使用，例如将此人物/物体合成到 Image 1 中】` })),
    ];
  } else if (hasReference) {
    const refs = ctx.referenceImages!;
    console.log(`📸 Text-to-image with ${refs.length} reference(s)`);
    references = refs.map((r, i) => ({ url: r, role: `Image ${i + 1} = reference image` }));
  } else {
    console.log('📸 Single-image mode');
  }

  const request = {
    image: references ? undefined : ctx.currentImage,
    references, prompt: finalPrompt, model: requestedModel, category: skill,
    aspectRatio, imageResolution, background, isNsfw,
    thinkingEffort: 'minimal' as const,
  };
  try {
    // Validate before a supplier call; the same resolver is used by billing preflight.
    const plan = planImageGeneration(request);
    const result = await generateImage(plan.request);
    if (!result.image) return { success: false, message: 'Image generation returned no image. Do not retry automatically.' };
    console.log(`✅ [edit_image] done in ${((Date.now() - t0) / 1000).toFixed(1)}s model=${result.model} provider=${result.provider ?? 'default'}`);
    let message = 'Image generated successfully.';
    const adjustments = [...new Set([...plan.adjustments, ...(result.adjustments ?? [])])];
    if (adjustments.length) message += ` ${adjustments.join(' ')}`;
    return { success: true, message, image: result.image, usedModel: result.model, provider: result.provider, contentBlocked: result.contentBlocked, usage: result.usage };
  } catch (error) {
    if (error instanceof ImageCapabilityError || error instanceof NanoBanana21RequestError || error instanceof ProviderImageInputError || error instanceof WanImageRequestError || error instanceof FalImage25RequestError) {
      return { success: false, message: `${error.message} Do not bypass a failed required image edit by sending the unedited original into dependent video generation.` };
    }
    // A paid outcome can be unknown: preserve a durable failure, never fan out or resubmit.
    return { success: false, message: 'Image generation did not complete. The provider outcome may be unknown. Do not retry automatically or silently switch models; explain the failure to the user. Do not bypass a failed required image edit by sending the unedited original into dependent video generation.' };
  }
}
