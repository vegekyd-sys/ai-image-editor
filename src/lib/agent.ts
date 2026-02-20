import { streamText, tool, stepCountIs } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { z } from 'zod';
import { generatePreviewImage } from './gemini';
import agentPrompt from './prompts/agent.md';

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
  currentImage: string; // base64 data URL – updated by tools
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
      description: 'Edit the current photo. Takes a detailed English editing prompt and produces an edited image. The result is automatically shown to the user.',
      inputSchema: z.object({
        editPrompt: z.string().describe('Detailed English prompt describing the desired edits'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
      }),
      execute: async ({ editPrompt, aspectRatio }) => {
        const result = await generatePreviewImage(
          ctx.currentImage,
          editPrompt,
          aspectRatio,
        );
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
  options?: { analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; tipReactionOnly?: boolean },
): AsyncGenerator<AgentStreamEvent> {
  const ctx: AgentContext = {
    currentImage,
    projectId,
    generatedImages: [],
  };

  const allTools = createTools(ctx);
  let imagesSent = 0;
  let stepCount = 0;

  const analysisOnly = options?.analysisOnly ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : 5;
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
