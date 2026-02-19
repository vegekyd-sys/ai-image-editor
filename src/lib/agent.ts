import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { generatePreviewImage } from './gemini';

// Allow running inside a Claude Code session (dev environment)
if (process.env.CLAUDECODE) delete process.env.CLAUDECODE;

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
// System prompt (loaded from src/lib/prompts/agent.md)
// ---------------------------------------------------------------------------

let _agentPromptCache: string | null = null;

function getAgentSystemPrompt(): string {
  if (_agentPromptCache) return _agentPromptCache;
  const promptPath = path.join(process.cwd(), 'src/lib/prompts/agent.md');
  _agentPromptCache = fs.readFileSync(promptPath, 'utf-8');
  return _agentPromptCache;
}

// ---------------------------------------------------------------------------
// MCP tools (closure over AgentContext)
// ---------------------------------------------------------------------------

function createMakaronTools(ctx: AgentContext) {
  const generateImage = tool(
    'generate_image',
    'Edit the current photo. Takes a detailed English editing prompt and produces an edited image. The result is automatically shown to the user.',
    {
      editPrompt: z.string().describe('Detailed English prompt describing the desired edits'),
      aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
    },
    async (args: { editPrompt: string; aspectRatio?: string }) => {
      const result = await generatePreviewImage(
        ctx.currentImage,
        args.editPrompt,
        args.aspectRatio,
      );
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: 'Image generation failed. The model could not produce an edited image. You can try a different prompt.' }],
        };
      }
      ctx.currentImage = result;
      ctx.generatedImages.push(result);
      return {
        content: [{ type: 'text' as const, text: 'Image generated successfully and shown to the user.' }],
      };
    },
  );

  const analyzeImage = tool(
    'analyze_image',
    'See and analyze the current photo. Returns the image so you can view it directly with your vision capabilities.',
    {
      question: z.string().optional().describe('Optional focus area for the analysis'),
    },
    async (args: { question?: string }) => {
      const base64Data = ctx.currentImage.replace(/^data:image\/\w+;base64,/, '');
      const mimeType = ctx.currentImage.startsWith('data:image/png') ? 'image/png' as const : 'image/jpeg' as const;
      return {
        content: [
          { type: 'image' as const, data: base64Data, mimeType },
          {
            type: 'text' as const,
            text: args.question
              ? `Analyze the image above, focusing on: ${args.question}`
              : 'Analyze this image in detail for photo editing purposes.',
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: 'makaron',
    version: '0.1.0',
    tools: [generateImage, analyzeImage],
  });
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

  const makaronServer = createMakaronTools(ctx);
  let imagesSent = 0;
  let currentTurnStreamed = false;
  let turnCount = 0; // to detect when a new turn starts after a tool result

  try {
    const analysisOnly = options?.analysisOnly ?? false;
    const tipReactionOnly = options?.tipReactionOnly ?? false;
    const analysisPrompt = options?.analysisContext === 'post-edit'
      ? ANALYSIS_PROMPT_POSTEDIT
      : ANALYSIS_PROMPT_INITIAL;
    for await (const message of query({
      prompt: analysisOnly ? analysisPrompt : prompt,
      options: {
        systemPrompt: getAgentSystemPrompt(),
        model: 'sonnet',
        mcpServers: { makaron: makaronServer },
        allowedTools: analysisOnly
          ? ['mcp__makaron__analyze_image']
          : tipReactionOnly
            ? []
            : ['mcp__makaron__generate_image', 'mcp__makaron__analyze_image'],
        settingSources: [],
        maxTurns: analysisOnly ? 2 : tipReactionOnly ? 1 : 5,
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
      },
    })) {
      // ── Streaming text deltas ──────────────────────────────────────────────
      if (message.type === 'stream_event') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = message.event as any;
        if (e.type === 'message_start') {
          currentTurnStreamed = false;
          turnCount++;
          // Signal a new assistant response bubble after the first turn
          if (turnCount > 1) {
            yield { type: 'new_turn' };
          }
        }
        if (
          e.type === 'content_block_delta' &&
          e.delta?.type === 'text_delta' &&
          typeof e.delta.text === 'string' &&
          e.delta.text.length > 0
        ) {
          currentTurnStreamed = true;
          yield { type: 'content', text: e.delta.text };
        }
        continue; // don't fall through to assistant/result handling
      }

      // ── Flush newly generated images ───────────────────────────────────────
      while (imagesSent < ctx.generatedImages.length) {
        yield { type: 'image', image: ctx.generatedImages[imagesSent] };
        imagesSent++;
      }

      // ── Complete assistant message ─────────────────────────────────────────
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          // Yield text only if we didn't already stream it incrementally
          if (!currentTurnStreamed && 'text' in block && block.text) {
            yield { type: 'content', text: block.text };
          }
          // Always emit tool_call events (tool use blocks are never streamed)
          if ('name' in block) {
            const input = ('input' in block ? block.input : {}) as Record<string, unknown>;
            // Emit concise Chinese task status
            if (block.name.includes('analyze_image')) {
              const q = input.question as string | undefined;
              yield { type: 'status', text: q ? `分析图片：${q.slice(0, 25)}` : '分析图片' };
            } else if (block.name.includes('generate_image')) {
              yield { type: 'status', text: '生成图片中...' };
            }
            yield {
              type: 'tool_call',
              tool: block.name,
              input,
            };
          }
        }
        currentTurnStreamed = false; // reset for next turn
      }

      // ── Result (final) ─────────────────────────────────────────────────────
      if (message.type === 'result') {
        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent] };
          imagesSent++;
        }
        if (message.subtype === 'success') {
          yield { type: 'done' };
        } else {
          yield { type: 'error', message: `Agent finished with: ${message.subtype}` };
        }
      }
    }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
