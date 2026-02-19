import Anthropic from '@anthropic-ai/sdk';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import fs from 'fs';
import path from 'path';
import { generatePreviewImage } from './gemini';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'content'; text: string }
  | { type: 'new_turn' }
  | { type: 'image'; image: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Anthropic client (Bedrock in prod, direct API in dev)
// ---------------------------------------------------------------------------

function createClient(): Anthropic | AnthropicBedrock {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return new AnthropicBedrock({
      awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
      awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    });
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

let _agentPromptCache: string | null = null;

function getAgentSystemPrompt(): string {
  if (_agentPromptCache) return _agentPromptCache;
  const promptPath = path.join(process.cwd(), 'src/lib/prompts/agent.md');
  _agentPromptCache = fs.readFileSync(promptPath, 'utf-8');
  return _agentPromptCache;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'generate_image',
    description:
      'Edit the current photo. Takes a detailed English editing prompt and produces an edited image. The result is automatically shown to the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        editPrompt: {
          type: 'string',
          description: 'Detailed English prompt describing the desired edits',
        },
        aspectRatio: {
          type: 'string',
          description: 'Target aspect ratio e.g. "4:5", "1:1", "16:9"',
        },
      },
      required: ['editPrompt'],
    },
  },
  {
    name: 'analyze_image',
    description:
      'See and analyze the current photo. Returns the image so you can view it directly with your vision capabilities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'Optional focus area for the analysis',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Analysis prompts
// ---------------------------------------------------------------------------

const ANALYSIS_PROMPT_INITIAL =
  `描述这张照片里的内容，1-2句，语气像朋友分享。直接从主体开始说（"一个..."/"画面里..."）。禁止用"我来看看"/"让我看一下"等任何铺垫语。`;

const ANALYSIS_PROMPT_POSTEDIT =
  `P完图了，看看效果。以"P完之后，"开头，用1句话描述一下现在这张图的整体效果和氛围。禁止用"我来看看"等铺垫语，直接说结果。`;

// ---------------------------------------------------------------------------
// Model ID helper
// ---------------------------------------------------------------------------

function getModelId(client: Anthropic | AnthropicBedrock): string {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';
  }
  return 'claude-3-5-sonnet-20241022';
}

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,
  options?: {
    analysisOnly?: boolean;
    analysisContext?: 'initial' | 'post-edit';
    tipReactionOnly?: boolean;
  },
): AsyncGenerator<AgentStreamEvent> {
  const analysisOnly = options?.analysisOnly ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;

  const effectivePrompt = analysisOnly
    ? (options?.analysisContext === 'post-edit' ? ANALYSIS_PROMPT_POSTEDIT : ANALYSIS_PROMPT_INITIAL)
    : prompt;

  // Which tools are allowed
  const allowedTools = analysisOnly
    ? TOOLS.filter(t => t.name === 'analyze_image')
    : tipReactionOnly
    ? []
    : TOOLS;

  const maxTurns = analysisOnly ? 2 : tipReactionOnly ? 1 : 5;

  const client = createClient();
  const model = getModelId(client);

  // Mutable state across turns
  let imageBase64 = currentImage; // updated when generate_image runs
  const generatedImages: string[] = [];

  // Build initial messages
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: effectivePrompt },
  ];

  let turnCount = 0;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      turnCount++;

      // Signal new turn bubble after first
      if (turnCount > 1) {
        yield { type: 'new_turn' };
      }

      // Stream this turn
      const streamParams: Anthropic.MessageStreamParams = {
        model,
        max_tokens: 4096,
        system: getAgentSystemPrompt(),
        tools: allowedTools.length > 0 ? allowedTools : undefined,
        tool_choice: allowedTools.length > 0 ? { type: 'auto' as const } : undefined,
        messages,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (client as any).messages.stream(streamParams);

      let assistantText = '';
      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

      // Stream text deltas
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text
        ) {
          assistantText += event.delta.text;
          yield { type: 'content', text: event.delta.text };
        }
        if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'tool_use'
        ) {
          // Will be captured in finalMessage
        }
      }

      const finalMessage = await stream.finalMessage();

      // Collect tool use blocks from the final message
      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
          const input = block.input as Record<string, unknown>;

          if (block.name === 'analyze_image') {
            const q = input.question as string | undefined;
            yield { type: 'status', text: q ? `分析图片：${q.slice(0, 25)}` : '分析图片' };
          } else if (block.name === 'generate_image') {
            yield { type: 'status', text: '生成图片中...' };
          }
          yield { type: 'tool_call', tool: block.name, input };
        }
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: finalMessage.content });

      // If no tool calls, we're done
      if (toolUseBlocks.length === 0 || finalMessage.stop_reason === 'end_turn') {
        // Flush any generated images
        for (const img of generatedImages) {
          yield { type: 'image', image: img };
        }
        yield { type: 'done' };
        return;
      }

      // Execute tools and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        const input = toolBlock.input as Record<string, unknown>;

        if (toolBlock.name === 'generate_image') {
          const editPrompt = input.editPrompt as string;
          const aspectRatio = input.aspectRatio as string | undefined;
          const result = await generatePreviewImage(imageBase64, editPrompt, aspectRatio);
          if (result) {
            imageBase64 = result;
            generatedImages.push(result);
            // Emit image immediately
            yield { type: 'image', image: result };
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: 'Image generated successfully and shown to the user.',
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: 'Image generation failed. Try a different prompt.',
              is_error: true,
            });
          }
        } else if (toolBlock.name === 'analyze_image') {
          const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
          const mimeType = (imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg';
          const question = input.question as string | undefined;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
              {
                type: 'text',
                text: question
                  ? `Analyze the image above, focusing on: ${question}`
                  : 'Analyze this image in detail for photo editing purposes.',
              },
            ],
          });
        }
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults });
    }

    // Reached maxTurns
    yield { type: 'done' };
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
