import { streamText, tool, stepCountIs } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';
import sharp from 'sharp';
import { generatePreviewImage, generateImageWithReferences } from './gemini';
import { createKlingTask } from './kling';
import { buildCameraPrompt, snapToNearest, AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS } from './camera-utils';
import { InferenceClient } from '@huggingface/inference';
import agentPrompt from './prompts/agent.md';
import enhancePrompt from './prompts/enhance.md';
import creativePrompt from './prompts/creative.md';
import wildPrompt from './prompts/wild.md';
import captionsPrompt from './prompts/captions.md';
import generateImageToolPrompt from './prompts/generate_image_tool.md';
import type { Tip } from '@/types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION?.trim(),
  accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
});
const MODEL = bedrock('us.anthropic.claude-sonnet-4-5-20250929-v1:0');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentContext {
  currentImage: string;       // base64 data URL – updated after each generation
  originalImage?: string;     // base64 data URL – the very first image, never changes
  referenceImages?: string[]; // base64 data URLs – user-uploaded references (up to 3)
  projectId: string;
  /** Images generated during this run (base64). Streamed to frontend out-of-band. */
  generatedImages: string[];
  /** Supabase Storage URLs for animation (set when in animation mode) */
  animationImageUrls?: string[];
  /** PiAPI task ID set by generate_animation tool, emitted as animation_task event */
  animationTaskId?: string;
}

export type AgentStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'content'; text: string }
  | { type: 'new_turn' }  // signals start of a new assistant response (after tool result)
  | { type: 'image'; image: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown>; images?: string[] }
  | { type: 'animation_task'; taskId: string }  // emitted when generate_animation tool creates a PiAPI task
  | { type: 'done' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Skill template map — reuses already-imported .md files
// ---------------------------------------------------------------------------

const SKILL_PROMPTS: Record<string, string> = {
  enhance: enhancePrompt,
  creative: creativePrompt,
  wild: wildPrompt,
  captions: captionsPrompt,
};

// ---------------------------------------------------------------------------
// System prompt (bundled via webpack asset/source)
// ---------------------------------------------------------------------------

function getAgentSystemPrompt(): string {
  return agentPrompt;
}

// ---------------------------------------------------------------------------
// Tools (Vercel AI SDK style, closure over AgentContext)
// ---------------------------------------------------------------------------

function createTools(ctx: AgentContext) {
  return {
    generate_image: tool({
      description: generateImageToolPrompt,
      inputSchema: z.object({
        editPrompt: z.string().describe('The specific creative direction for this edit (English). When skill is set, write only the direction — template rules are auto-injected.'),
        skill: z.enum(['enhance', 'creative', 'wild', 'captions']).optional().describe('Activate a skill template. See tool description for routing rules.'),
        useOriginalAsReference: z.boolean().optional().describe('Set true when you judge that the original photo would help as a reference — e.g. face has drifted, colors changed, user wants to restore something, or after many edits. Default false = single image edit.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
      }),
      execute: async ({ editPrompt, skill, useOriginalAsReference, aspectRatio }) => {
        const hasOriginal = ctx.originalImage && ctx.originalImage !== ctx.currentImage;
        const hasReference = !!ctx.referenceImages?.length;

        // Inject skill template if provided
        const skillTemplate = skill ? SKILL_PROMPTS[skill] : null;
        const finalPrompt = skillTemplate
          ? `${skillTemplate}\n\n---\n\nAPPLY THE ABOVE SKILL TO THIS SPECIFIC REQUEST:\n${editPrompt}`
          : editPrompt;

        console.log(`\n🎨 [generate_image] skill=${skill ?? 'none'} useOriginalAsReference=${!!useOriginalAsReference} hasOriginal=${!!hasOriginal} hasReference=${hasReference} thinking=high\neditPrompt:\n${editPrompt}\n`);

        // CUI agent always uses Flash High reasoning for best quality
        // Retry once on failure (transient API errors, rate limits, etc.)
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
              finalPrompt, aspectRatio, 'high',
            );
          } else if (hasReference) {
            const refs = ctx.referenceImages!;
            if (attempt === 1) console.log(`📸 Multi-image mode (${refs.length} user reference(s))`);
            result = await generateImageWithReferences(
              [
                { url: ctx.currentImage, role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景】' },
                ...refs.map((r, i) => ({ url: r, role: `Image ${i + 2} = 用户上传的参考图${refs.length > 1 ? `（第${i + 1}张）` : ''}【按用户指令使用，例如将此人物/物体合成到 Image 1 中】` })),
              ],
              finalPrompt, aspectRatio, 'high',
            );
          } else if (useOriginalAsReference && hasOriginal) {
            if (attempt === 1) console.log('📸 Two-image mode (original as reference)');
            result = await generateImageWithReferences(
              [
                { url: ctx.currentImage,   role: 'Image 1 = 当前编辑版本【编辑基础，保持此图的构图/场景/人物位置】' },
                { url: ctx.originalImage!, role: 'Image 2 = 原图【参考基准：用于还原任何已偏离的元素（人脸/颜色/背景等），构图基础仍以 Image 1 为准】' },
              ],
              finalPrompt, aspectRatio, 'high',
            );
          } else {
            if (attempt === 1) console.log('📸 Single-image mode');
            result = await generatePreviewImage(ctx.currentImage, finalPrompt, aspectRatio, 'high');
          }

          if (result) break;
          if (attempt < MAX_ATTEMPTS) {
            console.warn(`⚠️ [generate_image] attempt ${attempt} returned null, retrying...`);
          }
        }

        if (!result) {
          console.error('❌ [generate_image] all attempts failed');
          return { success: false as const, message: 'Image generation failed after retry. The AI model returned no image — this can happen with complex prompts or temporary API issues. Please try rephrasing your request.' };
        }
        ctx.currentImage = result;
        ctx.generatedImages.push(result);
        return { success: true as const, message: 'Image generated successfully and shown to the user.' };
      },
    }),

    generate_animation: tool({
      description: 'Create a 10-second animation video from the project snapshots using Kling AI. Only available when the user is in animation mode (animationImageUrls exist). Call this AFTER you have written the story script and the user has confirmed.',
      inputSchema: z.object({
        story_prompt: z.string().describe('The cinematic story prompt in Chinese, with <<<image_1>>>, <<<image_2>>> etc. referencing each snapshot'),
        duration: z.number().optional().describe('Duration in seconds: 5 or 10. Default 10.'),
      }),
      execute: async ({ story_prompt, duration }) => {
        const imageUrls = ctx.animationImageUrls;
        if (!imageUrls?.length) {
          return { success: false as const, message: '没有可用的图片 URL，无法生成动画。' };
        }
        try {
          const taskId = await createKlingTask({
            prompt: story_prompt,
            images: imageUrls.slice(0, 7),
            duration: duration ?? 10,
            aspect_ratio: '9:16',
          });
          ctx.animationTaskId = taskId;
          return { success: true as const, taskId, message: '视频生成任务已创建！大约需要 3-5 分钟，生成完成后会直接显示在这里。' };
        } catch (e) {
          return { success: false as const, message: String(e) };
        }
      },
    }),

    analyze_image: tool({
      description: 'See and analyze the current photo. Returns the image so you can view it directly with your vision capabilities.',
      inputSchema: z.object({
        question: z.string().optional().describe('Optional focus area for the analysis'),
      }),
      execute: async ({ question }) => {
        // Resolve image to base64 buffer — handles both URL and base64 input
        let buf: Buffer;
        if (ctx.currentImage.startsWith('http')) {
          const res = await fetch(ctx.currentImage);
          buf = Buffer.from(await res.arrayBuffer());
        } else {
          const raw = ctx.currentImage.replace(/^data:image\/\w+;base64,/, '');
          buf = Buffer.from(raw, 'base64');
        }
        // Compress for analysis — vision doesn't need full resolution, ~600KB is enough
        if (buf.length > 600_000) {
          buf = Buffer.from(await sharp(buf)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toBuffer());
        }
        const base64Data = buf.toString('base64');
        const mimeType = 'image/jpeg';
        return { base64Data, mimeType, question };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [
            { type: 'media' as const, data: output.base64Data, mediaType: output.mimeType },
            {
              type: 'text' as const,
              text: output.question
                ? `Analyze the image above, focusing on: ${output.question}`
                : 'Analyze this image in detail for photo editing purposes.',
            },
          ],
        };
      },
    }),

    rotate_camera: tool({
      description: `Rotate the virtual camera around the subject to show a different perspective/angle.
Use this when the user wants to see the image from a different viewpoint — e.g. "show from the side", "bird's eye view", "rotate left", "show the back", "zoom in".
This uses Qwen Image Edit to regenerate the image from the requested camera angle.

Parameters:
- azimuth: horizontal rotation (0=front, 45=front-right, 90=right, 135=back-right, 180=back, 225=back-left, 270=left, 315=front-left)
- elevation: vertical angle (-30=low angle, 0=eye level, 30=elevated, 60=high angle)
- distance: zoom (0.6=close-up, 1.0=medium, 1.4=wide shot)`,
      inputSchema: z.object({
        azimuth: z.number().min(0).max(360).describe('Horizontal rotation degrees (0=front, 90=right, 180=back, 270=left)'),
        elevation: z.number().min(-30).max(60).describe('Vertical angle degrees (-30=low, 0=eye level, 30=elevated, 60=high)'),
        distance: z.number().min(0.6).max(1.4).describe('Zoom distance (0.6=close-up, 1.0=medium, 1.4=wide)'),
      }),
      execute: async ({ azimuth, elevation, distance }) => {
        const image = ctx.currentImage;
        if (!image) return { success: false as const, message: 'No image available' };

        const hfToken = process.env.HF_TOKEN;
        if (!hfToken) return { success: false as const, message: 'HF_TOKEN not configured' };

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
          const resultBase64 = `data:image/jpeg;base64,${resultBuf.toString('base64')}`;

          ctx.currentImage = resultBase64;
          ctx.generatedImages.push(resultBase64);

          const azName = AZIMUTH_MAP[snapToNearest(azimuth, AZIMUTH_STEPS)];
          const elName = ELEVATION_MAP[snapToNearest(elevation, ELEVATION_STEPS)];
          const dsName = DISTANCE_MAP[snapToNearest(distance, DISTANCE_STEPS)];
          return { success: true as const, message: `Camera rotated: ${azName}, ${elName}, ${dsName}` };
        } catch (e) {
          return { success: false as const, message: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

  };
}

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

/** Append a language reply instruction to any prompt based on locale.
 *  Only appends when locale is explicitly set — undefined means no override. */
export function withLocale(prompt: string, locale?: string): string {
  if (locale === 'en') return `${prompt}\n\nReply in English.`;
  if (locale === 'zh') return `${prompt}\n\nReply in Chinese.`;
  return prompt;
}

// Used for initial upload analysis
const ANALYSIS_PROMPT_INITIAL = `描述这张照片里的内容，1-2句，语气像朋友分享。直接从主体开始说（"一个..."/"画面里..."）。禁止用"我来看看"/"让我看一下"等任何铺垫语。`;

// Used for post-edit analysis — acknowledges the edit context
const ANALYSIS_PROMPT_POSTEDIT = `P完图了，看看效果。以"P完之后，"开头，用1句话描述一下现在这张图的整体效果和氛围。禁止用"我来看看"等铺垫语，直接说结果。`;

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,
  options?: { analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; tipReactionOnly?: boolean; originalImage?: string; referenceImages?: string[]; animationImageUrls?: string[]; animationImages?: string[]; locale?: string },
): AsyncGenerator<AgentStreamEvent> {
  const ctx: AgentContext = {
    currentImage,
    originalImage: options?.originalImage,
    referenceImages: options?.referenceImages,
    projectId,
    generatedImages: [],
    animationImageUrls: options?.animationImageUrls,
  };

  const allTools = createTools(ctx);
  let imagesSent = 0;
  let stepCount = 0;

  const analysisOnly = options?.analysisOnly ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : 10;
  const analysisPrompt = withLocale(
    options?.analysisContext === 'post-edit' ? ANALYSIS_PROMPT_POSTEDIT : ANALYSIS_PROMPT_INITIAL,
    options?.locale,
  );

  // Determine which tools to expose
  // tipReactionOnly: no tools (text-only response)
  // analysisOnly: only analyze_image (agent uses tool to see the photo)
  // animation mode: generate_animation + analyze_image (no image generation)
  // normal chat: all tools
  const hasAnimationImages = !!options?.animationImageUrls?.length;
  const tools = tipReactionOnly ? undefined : analysisOnly
    ? { analyze_image: allTools.analyze_image }
    : hasAnimationImages
      ? { generate_animation: allTools.generate_animation, analyze_image: allTools.analyze_image }
      : allTools;

  // Build user message content — animation mode includes all snapshot images as visual content
  const animImages = options?.animationImages;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let userContent: any;
  if (animImages?.length && !analysisOnly && !tipReactionOnly) {
    // Multi-image user message: text + all snapshot images
    userContent = [
      { type: 'text' as const, text: prompt },
      ...animImages.map((img: string) =>
        img.startsWith('data:')
          ? { type: 'image' as const, image: img }
          : { type: 'image' as const, image: new URL(img) }
      ),
    ];
  } else {
    userContent = analysisOnly ? analysisPrompt : prompt;
  }

  const systemPrompt = getAgentSystemPrompt();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (streamText as any)({
      model: MODEL,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      ...(tools ? { tools } : {}),
      ...(analysisOnly && tools ? { activeTools: ['analyze_image'] } : {}),
      stopWhen: stepCountIs(maxSteps),
      onStepFinish: () => { stepCount++; },
    });

    for await (const event of result.fullStream) {
      // ── Text delta ──────────────────────────────────────────────────────────
      if (event.type === 'text-delta') {
        yield { type: 'content', text: event.text };
        continue;
      }

      // ── Tool call ───────────────────────────────────────────────────────────
      if (event.type === 'tool-call') {
        const isEnLocale = options?.locale === 'en';
        if (event.toolName === 'analyze_image') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: isEnLocale
            ? (q ? `Analyzing image: ${q.slice(0, 30)}` : 'Analyzing image')
            : (q ? `分析图片：${q.slice(0, 25)}` : '分析图片') };
        } else if (event.toolName === 'generate_image') {
          yield { type: 'status', text: isEnLocale ? 'Generating image...' : '生成图片中...' };
        } else if (event.toolName === 'rotate_camera') {
          yield { type: 'status', text: isEnLocale ? 'Rotating camera...' : '旋转相机中...' };
        }
        let toolCallImages: string[] | undefined;
        if (event.toolName === 'generate_image') {
          const inp = event.input as { useOriginalAsReference?: boolean };
          const twoImageMode = inp.useOriginalAsReference && ctx.originalImage && ctx.originalImage !== ctx.currentImage;
          toolCallImages = [
            ctx.currentImage,
            ...(twoImageMode ? [ctx.originalImage!] : []),
            ...(ctx.referenceImages ?? []),
          ];
        }
        yield {
          type: 'tool_call',
          tool: event.toolName,
          input: event.input as Record<string, unknown>,
          ...(toolCallImages ? { images: toolCallImages } : {}),
        };
        continue;
      }

      // ── Tool result — flush generated images + animation task ───────────────
      if (event.type === 'tool-result') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolName = (event as any).toolName as string | undefined;

        // Detect generate_image failure: tool was called but no new image produced
        if (toolName === 'generate_image' && imagesSent === ctx.generatedImages.length) {
          const isEn = options?.locale === 'en';
          yield { type: 'status', text: isEn ? 'Image generation failed' : '图片生成失败' };
        }

        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent] };
          imagesSent++;
        }
        if (ctx.animationTaskId) {
          yield { type: 'animation_task', taskId: ctx.animationTaskId };
          ctx.animationTaskId = undefined;
        }
        continue;
      }

      // ── Error from stream ──────────────────────────────────────────────────
      if (event.type === 'error') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = (event as any).error;
        const errMsg = err instanceof Error ? err.message : String(err);
        yield { type: 'error', message: errMsg };
        return;
      }

      // ── New step start (after tool result, model begins next turn) ──────────
      if (event.type === 'start-step' && stepCount > 0) {
        yield { type: 'new_turn' };
      }
    }

    // Flush remaining images
    while (imagesSent < ctx.generatedImages.length) {
      yield { type: 'image', image: ctx.generatedImages[imagesSent] };
      imagesSent++;
    }

    yield { type: 'done' };
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Tips Skill: generate tips text using Claude (fast, ~2-3s vs Gemini ~15s)
// ---------------------------------------------------------------------------

const TIPS_JSON_FORMAT_ZH = `\n\n以JSON数组格式输出，只输出JSON：
[{"emoji":"emoji","label":"2-4个中文字","desc":"中文短描述20字以内","editPrompt":"(MUST be in English) Detailed English editing instructions...","category":"enhance|creative|wild|captions"}, ...]`;

const TIPS_JSON_FORMAT_EN = `\n\nOutput as JSON array only, no other text:
[{"emoji":"emoji","label":"2-3 English words","desc":"English description under 20 words","editPrompt":"Detailed English editing prompt","category":"enhance|creative|wild|captions"}, ...]`;

const TIPS_PROMPTS: Record<'enhance' | 'creative' | 'wild' | 'captions', string> = {
  enhance: enhancePrompt,
  creative: creativePrompt,
  wild: wildPrompt,
  captions: captionsPrompt,
};

// Category-specific system prompts (restored from original gemini.ts structure)
const TIPS_CATEGORY_INFO: Record<'enhance' | 'creative' | 'wild' | 'captions', { cn: string; definition: string; selfCheck: string; rules: string }> = {
  enhance: {
    cn: 'enhance（专业增强）',
    definition: 'enhance = 让照片整体变好看（光影/色彩/通透感），变化必须肉眼明显',
    selfCheck: `enhance自检：
- 放在原图旁边，任何人都能一眼看出提升吗？（"看不出变化"=3分）
- 风格与照片情绪匹配吗？（搞笑照片配阴沉暗调=4分）
- 有通透感+景深分离+色调层次吗？
- enhance可以调整构图，但必须基于原图——编辑后还能一眼认出是同一张照片（"画面变化太多了"=3分）
- 编辑后的背景还是原图的背景吗？enhance是提升原图不是生成新图（"背景被换掉了"=3分，"人物都变了"=1分）`,
    rules: `⚠️ enhance的editPrompt必须包含背景锚定：
"Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."`,
  },
  creative: {
    cn: 'creative（趣味创意）',
    definition: 'creative = 往画面里加入一个与画面内容有因果关系的有趣新元素',
    selfCheck: `creative自检（三问全过才输出）：
- Q1 为什么是这个元素？能不能一句话说清"因为画面里有X所以加Y"？说不清=换一个
- Q2 情绪对吗？让人笑/惊喜=好，让人害怕/困惑=换
- Q3 这个创意能用在其他照片上吗？能=太通用=换一个`,
    rules: `creative品质标准：
- 加入的动物/角色必须是photorealistic写实风（cartoon/卡通=贴纸感）
- 足够大且显眼，至少占画面5-10%面积
- 必须与人物有互动/眼神交流，不能像贴纸`,
  },
  wild: {
    cn: 'wild（疯狂脑洞）',
    definition: 'wild = 让画面中已有的物品发生疯狂变化（不是加新东西！）',
    selfCheck: `wild自检（四问全过才输出）：
- Q1 变化的主角是画面中已有的什么东西？指不出来=不是wild
- Q2 变化够大吗？一眼就能看到变化=好。改镜片/眼镜反射内容=太小不够大(3分"眼镜idea傻")
- Q3 变化是基于物品本身特点还是随便套的？表面视觉类比（层状=蛋糕/抹茶、圆形=球）=换一个。"变成食物/饮品"除非厨房场景否则=万金油套路
- Q4 这个变化会不会让人不适/恐怖？→ 换一个有趣的方向`,
    rules: `wild额外规则：只选画面中重要/显眼的元素做变化，不要选边缘模糊的小物件`,
  },
  captions: {
    cn: 'captions（创意文案）',
    definition: 'captions = 为照片添加与内容高度相关的创意文字叠加，字体风格必须与照片情绪一致',
    selfCheck: `captions自检（三问全过才输出）：
- Q1 这段文字只适合这张照片吗？换到其他照片上还合适=太通用=重写
- Q2 字体风格与画面情绪匹配吗？（童趣照配严肃字体=4分，搞笑配优雅花体=3分）
- Q3 有metadata时自然融入了吗？有地点/时间必须结合进文案`,
    rules: `captions品质标准：
- 文字必须是photorealistic渲染，不是卡通贴纸
- 明确写出要叠加的文字内容（不能让Gemini自己编）
- 一个tip只加一句/一行文字，简洁有力
- 两个tip风格必须不同（如一中一英，或一童趣一简洁）`,
  },
};

function buildTipsSystemPrompt(category: 'enhance' | 'creative' | 'wild' | 'captions', locale?: string): string {
  const info = TIPS_CATEGORY_INFO[category];
  const labelNote = category === 'captions'
    ? 'label: 2-3 words, include scene/style context.'
    : 'label: 2-3 words.';
  const base = `Photo editing expert. Analyze image and generate 2 ${category} edit suggestions. ${labelNote} editPrompt in English, highly specific.

${info.definition}

⚠️ 第一步：判断人脸大小！
分析图片时首先判断人脸在画面中的占比：
- 大脸（特写/半身照，脸部占画面>10%）→ 正常处理
- 小脸（全身照/合照/远景/广角，脸部占画面<10%）→ 触发小脸保护模式
小脸保护模式下所有editPrompt必须包含：
"CRITICAL: Faces in this photo are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region in any way. Treat face areas as if they are masked off and invisible to you."
小脸时人物反应只能用身体语言（身体后仰/转头/手指向变化），绝不能要求面部表情变化。

自检框架（输出每个tip前先过一遍）：

${info.selfCheck}

${info.rules}

⚠️ 人脸保真是最大扣分项！涉及人物的editPrompt必须包含：
"Preserve each person's identity, bone structure, face shape exactly. Do not make faces wider or rounder."

⚠️ 所有editPrompt都必须包含背景净化：
"Clean up the scene like a professional photographer would before shooting: remove any object that draws attention away from the main subject but adds no compositional value. Replace cleaned areas with natural-looking continuation of the scene."

2个tip必须选不同方向。结尾加"Do NOT add any text, watermarks, or borders."`;
  // No withLocale — language of label/desc controlled by TIPS_JSON_FORMAT per locale.
  // editPrompt must ALWAYS be English regardless of locale.
  return base;
}

export async function* streamTipsWithClaude(
  imageBase64: string,
  category: 'enhance' | 'creative' | 'wild' | 'captions',
  metadata?: { takenAt?: string; location?: string },
  locale?: string,
): AsyncGenerator<Tip> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const template = TIPS_PROMPTS[category];
  const systemPrompt = buildTipsSystemPrompt(category);

  // Build metadata context string
  const metaLines: string[] = [];
  if (metadata?.takenAt) metaLines.push(`拍摄时间：${metadata.takenAt}`);
  if (metadata?.location) metaLines.push(`拍摄地点：${metadata.location}`);
  const metaContext = metaLines.length > 0
    ? `[照片元数据]\n${metaLines.join('\n')}\n（可用于更贴切的创意联想，例如地点特色元素、时间对应的光线氛围等）\n\n`
    : '';

  const userPrompt = `${metaContext}在生成建议之前，先分析这张图片：判断人脸大小；识别画面中的具体物品/食物/道具；判断照片情绪基调。

基于分析，给出2条${category}编辑建议。以下是详细规范（必须遵循）：

${template}${locale === 'en' ? TIPS_JSON_FORMAT_EN : TIPS_JSON_FORMAT_ZH}`;

  const { textStream } = streamText({
    model: MODEL,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: dataUrl },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });

  // Collect full text then parse JSON
  let fullText = '';
  for await (const delta of textStream) {
    fullText += delta;
  }

  // Extract JSON array from response
  const jsonMatch = fullText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return;

  try {
    const tips = JSON.parse(jsonMatch[0]) as Tip[];
    for (const tip of tips) {
      if (tip.label && tip.editPrompt && tip.category) {
        yield tip;
      }
    }
  } catch { /* parse error, yield nothing */ }
}
