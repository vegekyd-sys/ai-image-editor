import { generateImage } from '../model-router';
import type { ImageBackground, ModelId, TokenUsage } from '../models/types';
import type { SkillContext, SkillResult } from './index';

export interface EditImageInput {
  editPrompt: string;
  skill?: 'enhance' | 'creative' | 'wild' | 'captions';
  aspectRatio?: string;
  /** Explicit output background. Transparent requests route strictly to GPT Image 2. */
  background?: ImageBackground;
  /** @deprecated Use workspace service instead. Kept for backward compat. */
  skillPrompts?: Record<string, string>;
  /** User's preferred model override — bypasses default routing */
  preferredModel?: ModelId;
  /** NSFW flag — skip Gemini entirely */
  isNsfw?: boolean;
}

export async function editImage(
  input: EditImageInput,
  ctx: SkillContext,
): Promise<SkillResult> {
  const { editPrompt, skill, aspectRatio, background, preferredModel, isNsfw } = input;
  const requestedModel = background === 'transparent' ? 'openai' : preferredModel;
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

  let result: string | null = null;
  let usedModel: ModelId = 'gemini';
  let lastFailedModels: ModelId[] | undefined;
  let contentBlocked = false;
  let lastUsage: TokenUsage | undefined;
  let usedProvider: string | undefined;
  // A transparent request is a strict, paid provider call. Do not fan it out
  // or repeat it after failure; surface the capability error to the user.
  const MAX_ATTEMPTS = background === 'transparent' ? 1 : 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const genResult = await generateImage({
      image: references ? undefined : ctx.currentImage,
      prompt: finalPrompt,
      model: requestedModel,
      category: skill,
      aspectRatio,
      background,
      thinkingEffort: 'minimal',
      references,
      fallbackPrompt: undefined,
      isNsfw,
      codexSubscription: ctx.codexSubscription,
    });

    result = genResult.image;
    usedModel = genResult.model;
    lastFailedModels = genResult.failedModels;
    if (genResult.contentBlocked) contentBlocked = true;
    if (genResult.usage) lastUsage = genResult.usage;
    usedProvider = genResult.provider;

    if (result) break;
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`⚠️ [edit_image] attempt ${attempt} returned null (failedModels=${genResult.failedModels}), retrying...`);
    }
  }

  if (!result) {
    console.error(`❌ [edit_image] all attempts failed after ${((Date.now() - t0) / 1000).toFixed(1)}s, failedModels=${lastFailedModels}`);
    const message = background === 'transparent'
      ? 'Transparent image generation is not available from the configured GPT Image 2 provider yet. No opaque fallback was returned.'
      : 'Image generation failed after retry. The AI model returned no image — this can happen with complex prompts or temporary API issues. Please try rephrasing your request.';
    return {
      success: false,
      contentBlocked,
      message,
    };
  }

  console.log(`✅ [edit_image] done in ${((Date.now() - t0) / 1000).toFixed(1)}s (image ${(result.length / 1024).toFixed(0)}KB) model=${usedModel} provider=${usedProvider ?? 'default'}${requestedModel && usedModel !== requestedModel ? ` (requested=${requestedModel}, fallback from ${lastFailedModels?.join(',')})` : ''}`);
  let msg = 'Image generated successfully.';
  if (requestedModel && usedModel !== requestedModel) {
    msg += ` ⚠️ Note: requested model "${requestedModel}" failed, fell back to "${usedModel}". Tell the user.`;
  } else if (background === 'transparent' && preferredModel && preferredModel !== 'openai') {
    msg += ' Transparent output required the OpenAI image model.';
  }
  if (usedProvider === 'codex-subscription') {
    msg += ' Provider: Codex subscription.';
  }
  return { success: true, message: msg, image: result, usedModel, provider: usedProvider, contentBlocked, usage: lastUsage };
}
