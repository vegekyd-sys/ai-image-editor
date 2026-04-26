import { generateImage } from '../model-router';
import type { ModelId } from '../models/types';
import type { SkillContext, SkillResult } from './index';
import * as workspace from '../workspace';

export interface EditImageInput {
  editPrompt: string;
  skill?: 'enhance' | 'creative' | 'wild' | 'captions';
  useOriginalAsReference?: boolean;
  aspectRatio?: string;
  transparentBackground?: boolean;
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
  const { editPrompt, skill, useOriginalAsReference, aspectRatio, skillPrompts, preferredModel, isNsfw } = input;
  const hasOriginal = ctx.originalImage && ctx.originalImage !== ctx.currentImage;
  const hasReference = !!ctx.referenceImages?.length;

  // Inject skill template if provided
  // Qwen can't digest creative/wild/captions .md templates — only enhance works well
  const qwenIncompatibleSkill = preferredModel === 'qwen' && skill && skill !== 'enhance';
  // Load skill template from workspace (unified source) or legacy skillPrompts
  let skillTemplate: string | null = null;
  if (skill && !qwenIncompatibleSkill) {
    // Try workspace first, then legacy skillPrompts for backward compat
    skillTemplate = await workspace.getSkillTemplate(skill) ?? skillPrompts?.[skill] ?? null;
  }
  const finalPrompt = skillTemplate
    ? `${skillTemplate}\n\n---\n\nAPPLY THE ABOVE SKILL TO THIS SPECIFIC REQUEST:\n${editPrompt}`
    : editPrompt;

  const t0 = Date.now();
  if (qwenIncompatibleSkill) console.log(`⚠️ [edit_image] Skipping ${skill} template for qwen (incompatible)`);
  console.log(`\n🎨 [edit_image] skill=${skill ?? 'none'} useOriginalAsReference=${!!useOriginalAsReference} hasOriginal=${!!hasOriginal} hasReference=${hasReference} model=${preferredModel ?? 'auto'}\neditPrompt: ${editPrompt.slice(0, 200)}\nfinalPrompt length: ${finalPrompt.length} chars\n`);

  // Build references array for multi-image mode
  let references: { url: string; role: string }[] | undefined;
  if (hasReference && useOriginalAsReference && hasOriginal) {
    const refs = ctx.referenceImages!;
    console.log(`📸 Multi-image mode (original + ${refs.length} user reference(s))`);
    references = [
      { url: ctx.currentImage!,   role: 'Image 1 = 当前编辑版本【编辑基础】' },
      { url: ctx.originalImage!, role: 'Image 2 = 原图【参考基准，还原偏离元素】' },
      ...refs.map((r, i) => ({ url: r, role: `Image ${i + 3} = 用户上传的参考图${refs.length > 1 ? `（第${i + 1}张）` : ''}【按用户指令使用】` })),
    ];
  } else if (hasReference) {
    const refs = ctx.referenceImages!;
    console.log(`📸 Multi-image mode (${refs.length} user reference(s))`);
    references = [
      { url: ctx.currentImage!, role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景】' },
      ...refs.map((r, i) => ({ url: r, role: `Image ${i + 2} = 用户上传的参考图${refs.length > 1 ? `（第${i + 1}张）` : ''}【按用户指令使用，例如将此人物/物体合成到 Image 1 中】` })),
    ];
  } else if (useOriginalAsReference && hasOriginal) {
    console.log('📸 Two-image mode (original as reference)');
    references = [
      { url: ctx.currentImage!,   role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景/人物位置】' },
      { url: ctx.originalImage!, role: 'Image 2 = 原图【参考基准：用于还原任何已偏离的元素（人脸/颜色/背景等），构图基础仍以 Image 1 为准】' },
    ];
  } else {
    console.log('📸 Single-image mode');
  }

  let result: string | null = null;
  let usedModel: ModelId = 'gemini';
  let lastFailedModels: ModelId[] | undefined;
  let contentBlocked = false;
  let lastUsage: { inputTokens: number; outputTokens: number; modelId: string } | undefined;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const genResult = await generateImage({
      image: references ? undefined : ctx.currentImage,
      prompt: finalPrompt,
      model: preferredModel,
      category: skill,
      aspectRatio,
      transparentBackground: input.transparentBackground,
      thinkingEffort: 'minimal',
      references,
      fallbackPrompt: skillTemplate ? editPrompt : undefined,
      isNsfw,
    });

    result = genResult.image;
    usedModel = genResult.model;
    lastFailedModels = genResult.failedModels;
    if (genResult.contentBlocked) contentBlocked = true;
    if (genResult.usage) lastUsage = genResult.usage;

    if (result) break;
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`⚠️ [edit_image] attempt ${attempt} returned null (failedModels=${genResult.failedModels}), retrying...`);
    }
  }

  if (!result) {
    console.error(`❌ [edit_image] all attempts failed after ${((Date.now() - t0) / 1000).toFixed(1)}s, failedModels=${lastFailedModels}`);
    return {
      success: false,
      contentBlocked,
      message: 'Image generation failed after retry. The AI model returned no image — this can happen with complex prompts or temporary API issues. Please try rephrasing your request.',
    };
  }

  console.log(`✅ [edit_image] done in ${((Date.now() - t0) / 1000).toFixed(1)}s (image ${(result.length / 1024).toFixed(0)}KB) model=${usedModel}`);
  return { success: true, message: 'Image generated successfully.', image: result, usedModel, contentBlocked, usage: lastUsage };
}
