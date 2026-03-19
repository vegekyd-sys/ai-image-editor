import { readFileSync } from 'fs';
import { join } from 'path';
import { generatePreviewImage, generateImageWithReferences, lastUsedModel } from '../gemini';
import type { SkillContext, SkillResult } from './index';

// Lazy-loaded skill prompts from disk (for standalone MCP server / non-webpack environments)
let _diskPrompts: Record<string, string> | null = null;
function loadSkillPromptsFromDisk(): Record<string, string> {
  if (!_diskPrompts) {
    const dir = join(process.cwd(), 'src', 'lib', 'prompts');
    _diskPrompts = {
      enhance: readFileSync(join(dir, 'enhance.md'), 'utf-8'),
      creative: readFileSync(join(dir, 'creative.md'), 'utf-8'),
      wild: readFileSync(join(dir, 'wild.md'), 'utf-8'),
      captions: readFileSync(join(dir, 'captions.md'), 'utf-8'),
    };
  }
  return _diskPrompts;
}

export interface EditImageInput {
  editPrompt: string;
  skill?: 'enhance' | 'creative' | 'wild' | 'captions';
  useOriginalAsReference?: boolean;
  aspectRatio?: string;
  /** Pre-loaded skill prompt templates (from webpack). If omitted, loads from disk. */
  skillPrompts?: Record<string, string>;
  /** User's preferred model override ('gemini' | 'qwen') — bypasses default routing */
  preferredModel?: string;
}

export async function editImage(
  input: EditImageInput,
  ctx: SkillContext,
): Promise<SkillResult> {
  const { editPrompt, skill, useOriginalAsReference, aspectRatio, skillPrompts, preferredModel } = input;
  const hasOriginal = ctx.originalImage && ctx.originalImage !== ctx.currentImage;
  const hasReference = !!ctx.referenceImages?.length;

  // Inject skill template if provided
  const prompts = skillPrompts ?? loadSkillPromptsFromDisk();
  const skillTemplate = skill ? prompts[skill] : null;
  const finalPrompt = skillTemplate
    ? `${skillTemplate}\n\n---\n\nAPPLY THE ABOVE SKILL TO THIS SPECIFIC REQUEST:\n${editPrompt}`
    : editPrompt;

  const t0 = Date.now();
  console.log(`\n🎨 [edit_image] skill=${skill ?? 'none'} useOriginalAsReference=${!!useOriginalAsReference} hasOriginal=${!!hasOriginal} hasReference=${hasReference}\neditPrompt: ${editPrompt.slice(0, 200)}\nfinalPrompt length: ${finalPrompt.length} chars\n`);

  let result: string | null = null;
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (hasReference && useOriginalAsReference && hasOriginal) {
      const refs = ctx.referenceImages!;
      if (attempt === 1) console.log(`📸 Multi-image mode (original + ${refs.length} user reference(s))`);
      result = await generateImageWithReferences(
        [
          { url: ctx.currentImage,   role: 'Image 1 = 当前编辑版本【编辑基础】' },
          { url: ctx.originalImage!, role: 'Image 2 = 原图【参考基准，还原偏离元素】' },
          ...refs.map((r, i) => ({ url: r, role: `Image ${i + 3} = 用户上传的参考图${refs.length > 1 ? `（第${i + 1}张）` : ''}【按用户指令使用】` })),
        ],
        finalPrompt, aspectRatio, 'minimal',
      );
    } else if (hasReference) {
      const refs = ctx.referenceImages!;
      if (attempt === 1) console.log(`📸 Multi-image mode (${refs.length} user reference(s))`);
      result = await generateImageWithReferences(
        [
          { url: ctx.currentImage, role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景】' },
          ...refs.map((r, i) => ({ url: r, role: `Image ${i + 2} = 用户上传的参考图${refs.length > 1 ? `（第${i + 1}张）` : ''}【按用户指令使用，例如将此人物/物体合成到 Image 1 中】` })),
        ],
        finalPrompt, aspectRatio, 'minimal',
      );
    } else if (useOriginalAsReference && hasOriginal) {
      if (attempt === 1) console.log('📸 Two-image mode (original as reference)');
      result = await generateImageWithReferences(
        [
          { url: ctx.currentImage,   role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景/人物位置】' },
          { url: ctx.originalImage!, role: 'Image 2 = 原图【参考基准：用于还原任何已偏离的元素（人脸/颜色/背景等），构图基础仍以 Image 1 为准】' },
        ],
        finalPrompt, aspectRatio, 'minimal',
      );
    } else {
      if (attempt === 1) console.log('📸 Single-image mode');
      result = await generatePreviewImage(ctx.currentImage, finalPrompt, aspectRatio, 'minimal', skill, preferredModel);
    }

    if (result) break;
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`⚠️ [edit_image] attempt ${attempt} returned null, retrying...`);
    }
  }

  if (!result) {
    console.error(`❌ [edit_image] all attempts failed after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return {
      success: false,
      message: 'Image generation failed after retry. The AI model returned no image — this can happen with complex prompts or temporary API issues. Please try rephrasing your request.',
    };
  }

  console.log(`✅ [edit_image] done in ${((Date.now() - t0) / 1000).toFixed(1)}s (image ${(result.length / 1024).toFixed(0)}KB) model=${lastUsedModel}`);
  return { success: true, message: 'Image generated successfully.', image: result, usedModel: lastUsedModel };
}
