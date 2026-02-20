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
      description: `Edit the current photo using a detailed prompt.
When originalImage is available (different from currentImage), TWO images are sent to the generator:
  - Image 1 (原图/original): use for face, person identity, and scene reference — preserve what the user liked
  - Image 2 (当前版本/current): the base image to edit from
In your editPrompt, always reference these roles explicitly, e.g.:
  "Referring to Image 1 (original) for exact face shape and identity preservation: [describe original face]
   Edit Image 2 (current version): [describe what to change]"
When user says "face changed" or "person looks different", use Image 1 as strict face reference.
When no originalImage, only Image 1 (current) is sent.`,
      inputSchema: z.object({
        editPrompt: z.string().describe('Detailed English prompt. Reference Image 1/Image 2 roles when multiple images are available.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
      }),
      execute: async ({ editPrompt, aspectRatio }) => {
        const hasOriginal = ctx.originalImage && ctx.originalImage !== ctx.currentImage;
        let result: string | null;

        if (hasOriginal) {
          result = await generateImageWithReferences(
            [
              { url: ctx.originalImage!, role: '原图（人脸/人物/场景保真参考）' },
              { url: ctx.currentImage,   role: '当前编辑版本（编辑基础，在此基础上修改）' },
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
