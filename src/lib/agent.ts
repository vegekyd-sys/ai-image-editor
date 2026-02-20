import { streamText, generateText, tool, stepCountIs } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';
import { generatePreviewImage, generateImageWithReferences } from './gemini';
import agentPrompt from './prompts/agent.md';
import enhancePrompt from './prompts/enhance.md';
import creativePrompt from './prompts/creative.md';
import wildPrompt from './prompts/wild.md';
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
  currentImage: string;    // base64 data URL – updated after each generation
  originalImage?: string;  // base64 data URL – the very first image, never changes
  projectId: string;
  /** Images generated during this run (base64). Streamed to frontend out-of-band. */
  generatedImages: string[];
}

export type AgentStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'content'; text: string }
  | { type: 'new_turn' }  // signals start of a new assistant response (after tool result)
  | { type: 'image'; image: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string };

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
      description: `Edit the current photo. Write a detailed English editPrompt and optionally set useOriginalAsBase.

--- DECIDING useOriginalAsBase ---
Before calling this tool, answer: does the user want to FIX the current version, or START FRESH from the original?
- Fix current (default, useOriginalAsBase=false): "再调整一下" / "人脸不对" / "保留效果但..." / "去掉某个元素"
- Start fresh (useOriginalAsBase=true): "P的不好重新做" / "不满意重来" / "换个方式"

--- IMAGES SENT TO GEMINI ---
When useOriginalAsBase=false (default): Image 1 = current version (BASE), Image 2 = original (face reference only)
When useOriginalAsBase=true: only the original photo is sent (single image, start fresh)
When no originalImage exists: only current photo is sent (single image)

--- EDITPROMPT STRUCTURE ---
BASE: State which image is the foundation (omit if useOriginalAsBase=true — original is implicitly the base)
FACE (when people are present): Copy face from original exactly:
  - Large face (>10% of frame): "Restore/preserve each person's face to exactly match the original photo: copy the exact face shape, eye shape, nose, mouth, jaw line, skin tone and texture. Do NOT slim, beautify, enlarge eyes, or alter any facial feature."
  - Small face (<10% of frame): "CRITICAL: Faces are small. Leave ALL face areas completely untouched — do NOT sharpen, retouch, relight, or process any face region. Treat face areas as masked off."
EDIT: What to actually change, in detail.`,
      inputSchema: z.object({
        editPrompt: z.string().describe('Detailed English prompt following the BASE/REFERENCE/FACE/EDIT structure from agent.md.'),
        useOriginalAsBase: z.boolean().optional().describe('Set true when user wants to start fresh from the original photo (e.g. "P的不好重新做"). Default false = use current version as base.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
      }),
      execute: async ({ editPrompt, useOriginalAsBase, aspectRatio }) => {
        const hasOriginal = ctx.originalImage && ctx.originalImage !== ctx.currentImage;
        // Determine which image is the base
        const baseImage = (useOriginalAsBase && hasOriginal) ? ctx.originalImage! : ctx.currentImage;
        const refImage = hasOriginal ? (useOriginalAsBase ? ctx.currentImage : ctx.originalImage!) : null;

        console.log(`\n🎨 [generate_image] base=${useOriginalAsBase ? 'ORIGINAL' : 'CURRENT'} hasRef=${!!refImage}\neditPrompt:\n${editPrompt}\n`);

        let result: string | null;
        if (useOriginalAsBase && hasOriginal) {
          // Start fresh from original — single image, no reference to current version
          result = await generatePreviewImage(ctx.originalImage!, editPrompt, aspectRatio);
        } else if (!useOriginalAsBase && hasOriginal) {
          // Edit current version, reference original for face/details
          result = await generateImageWithReferences(
            [
              { url: ctx.currentImage,   role: '当前编辑版本【主图】— 输出图片必须以这张图为基础进行修改' },
              { url: ctx.originalImage!, role: '原图【人脸参考】— 仅用于还原人脸细节，保持与原图人脸完全一致' },
            ],
            editPrompt,
            aspectRatio,
          );
        } else {
          result = await generatePreviewImage(ctx.currentImage, editPrompt, aspectRatio);
        }

        if (!result) {
          return { success: false as const, message: 'Image generation failed. Try a different prompt.' };
        }
        ctx.currentImage = result;
        ctx.generatedImages.push(result);
        return { success: true as const, message: 'Image generated successfully and shown to the user.' };
      },
    }),

    analyze_image: tool({
      description: 'See and analyze the current photo. Returns the image so you can view it directly with your vision capabilities.',
      inputSchema: z.object({
        question: z.string().optional().describe('Optional focus area for the analysis'),
      }),
      execute: async ({ question }) => {
        const base64Data = ctx.currentImage.replace(/^data:image\/\w+;base64,/, '');
        const mimeType = ctx.currentImage.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
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

  };
}

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

// Used for initial upload analysis
const ANALYSIS_PROMPT_INITIAL = `描述这张照片里的内容，1-2句，语气像朋友分享。直接从主体开始说（"一个..."/"画面里..."）。禁止用"我来看看"/"让我看一下"等任何铺垫语。`;

// Used for post-edit analysis — acknowledges the edit context
const ANALYSIS_PROMPT_POSTEDIT = `P完图了，看看效果。以"P完之后，"开头，用1句话描述一下现在这张图的整体效果和氛围。禁止用"我来看看"等铺垫语，直接说结果。`;

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,
  options?: { analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; tipReactionOnly?: boolean; originalImage?: string },
): AsyncGenerator<AgentStreamEvent> {
  const ctx: AgentContext = {
    currentImage,
    originalImage: options?.originalImage,
    projectId,
    generatedImages: [],
  };

  const allTools = createTools(ctx);
  let imagesSent = 0;
  let stepCount = 0;

  const analysisOnly = options?.analysisOnly ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : 10;
  const analysisPrompt = options?.analysisContext === 'post-edit'
    ? ANALYSIS_PROMPT_POSTEDIT
    : ANALYSIS_PROMPT_INITIAL;

  // Determine which tools to expose
  // tipReactionOnly: no tools (text-only response)
  // analysisOnly: only analyze_image (agent uses tool to see the photo)
  // normal chat: all tools (generate_image + analyze_image)
  const tools = tipReactionOnly ? undefined : analysisOnly
    ? { analyze_image: allTools.analyze_image }
    : allTools;

  try {
    const result = streamText({
      model: MODEL,
      system: getAgentSystemPrompt(),
      messages: [{ role: 'user', content: analysisOnly ? analysisPrompt : prompt }],
      ...(tools ? { tools } : {}),
      ...(analysisOnly && tools ? { activeTools: ['analyze_image' as const] } : {}),
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
        if (event.toolName === 'analyze_image') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: q ? `分析图片：${q.slice(0, 25)}` : '分析图片' };
        } else if (event.toolName === 'generate_image') {
          yield { type: 'status', text: '生成图片中...' };
        }
        yield { type: 'tool_call', tool: event.toolName, input: event.input as Record<string, unknown> };
        continue;
      }

      // ── Tool result — flush generated images ────────────────────────────────
      if (event.type === 'tool-result') {
        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent] };
          imagesSent++;
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

const TIPS_JSON_FORMAT = `\n\n请严格以JSON数组格式回复，只输出JSON，不要其他文字：
[{"emoji":"1个emoji","label":"中文3-6字动词开头","desc":"中文10-25字短描述","editPrompt":"Detailed English editing prompt","category":"enhance|creative|wild"}, ...]`;

const TIPS_PROMPTS: Record<'enhance' | 'creative' | 'wild', string> = {
  enhance: enhancePrompt,
  creative: creativePrompt,
  wild: wildPrompt,
};

export async function* streamTipsWithClaude(
  imageBase64: string,
  category: 'enhance' | 'creative' | 'wild',
): AsyncGenerator<Tip> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const template = TIPS_PROMPTS[category];

  const systemPrompt = `你是图片编辑建议专家。分析图片后生成2条${category}编辑建议。label必须用中文3-6字，动词开头。editPrompt用英文，极其具体。`;

  const userPrompt = `在生成建议之前，先分析这张图片：判断人脸大小（大脸>10% / 小脸<10%）；识别画面中的具体物品/食物/道具；判断照片情绪基调。

基于分析，严格遵循以下所有规则，给出2条${category}编辑建议：

${template}${TIPS_JSON_FORMAT}`;

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
