import assert from 'node:assert/strict';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import sharp from 'sharp';
import { z } from 'zod';
import {
  createAgentModelRuntime,
  getAgentProviderOptions,
} from '../src/lib/agent-model-runtime';
import {
  isAgentModelId,
  type AgentModelId,
} from '../src/lib/agent-models';
import {
  runMakaronAgent,
  type AgentStreamEvent,
} from '../src/lib/agent';

async function collectAgentEvents(
  stream: AsyncIterable<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function assertSuccessfulAgentRun(events: AgentStreamEvent[], expectedBillingModel: string) {
  const error = events.find((event) => event.type === 'error');
  assert.equal(error, undefined, error?.message);
  assert.ok(events.some((event) => event.type === 'done'));
  const usage = events.find((event) => event.type === 'usage');
  assert.equal(usage?.model, expectedBillingModel);
  return usage;
}

async function main() {
  process.env.AGENT_DEBUG_DUMP = '0';
  const configuredModel = process.env.GPT56_AGENT_SMOKE_MODEL?.trim();
  const agentModel: AgentModelId | 'auto' = configuredModel && isAgentModelId(configuredModel)
    ? configuredModel
    : 'auto';
  const runtime = createAgentModelRuntime(agentModel, 'gpt56-live-smoke');
  if (agentModel === 'auto') assert.equal(runtime.spec.id, 'gpt-5.6-terra');

  const streamStartedAt = Date.now();
  const stream = streamText({
    model: runtime.model,
    prompt: 'Reply with exactly STREAM_OK',
    providerOptions: getAgentProviderOptions(runtime),
  });
  let streamedText = '';
  let firstTextMs: number | null = null;
  for await (const delta of stream.textStream) {
    if (firstTextMs === null) firstTextMs = Date.now() - streamStartedAt;
    streamedText += delta;
  }
  assert.equal(streamedText.trim(), 'STREAM_OK');
  const streamUsage = await stream.usage;

  let toolExecutions = 0;
  const toolResult = await generateText({
    model: runtime.model,
    prompt: 'Call get_status exactly once. After it returns, reply with exactly TOOL_OK.',
    tools: {
      get_status: tool({
        description: 'Return the deterministic smoke-test status.',
        inputSchema: z.object({}),
        execute: async () => {
          toolExecutions += 1;
          return { status: 'ready' };
        },
      }),
    },
    stopWhen: stepCountIs(3),
    providerOptions: getAgentProviderOptions(runtime),
  });
  assert.equal(toolExecutions, 1);
  assert.equal(toolResult.text.trim(), 'TOOL_OK');

  const redPng = await sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  }).png().toBuffer();
  const visionResult = await generateText({
    model: runtime.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', image: redPng },
        { type: 'text', text: 'If the image is predominantly red, reply with exactly VISION_RED_OK.' },
      ],
    }],
    providerOptions: getAgentProviderOptions(runtime),
  });
  assert.equal(visionResult.text.trim(), 'VISION_RED_OK');

  // Exercise the real Makaron Agent with its full production system prompt and
  // complete tool schema. No persistence client is provided, so this run has no
  // project/database side effects.
  const mainAgentEvents = await collectAgentEvents(runMakaronAgent(
    'This is a deployment smoke test. Do not call tools. Reply with exactly MAIN_AGENT_OK.',
    '',
    'gpt56-main-agent-smoke',
    {
      agentModel: runtime.spec.id,
      locale: 'en',
      disableToolCalls: true,
      snapshotImages: [],
      userSkills: [],
      history: [],
    },
  ));
  const mainUsage = assertSuccessfulAgentRun(mainAgentEvents, runtime.spec.billingModelId);
  const mainText = mainAgentEvents
    .filter((event): event is Extract<AgentStreamEvent, { type: 'content' }> => event.type === 'content')
    .map((event) => event.text)
    .join('')
    .trim();
  assert.equal(mainText, 'MAIN_AGENT_OK');

  // Exercise the production analyze_image tool result path. This sends the
  // image back to the model as function-call output, which differs from a
  // direct image in the initial user message.
  const redDataUrl = `data:image/png;base64,${redPng.toString('base64')}`;
  const analysisEvents = await collectAgentEvents(runMakaronAgent(
    '',
    redDataUrl,
    'gpt56-analysis-smoke',
    {
      agentModel: runtime.spec.id,
      analysisOnly: true,
      analysisContext: 'initial',
      locale: 'en',
      snapshotImages: [redDataUrl],
      currentSnapshotIndex: 0,
    },
  ));
  const analysisUsage = assertSuccessfulAgentRun(analysisEvents, runtime.spec.billingModelId);
  assert.equal(analysisEvents.filter(
    (event) => event.type === 'tool_call' && event.tool === 'analyze_image',
  ).length, 1);
  assert.equal(analysisEvents.filter(
    (event) => event.type === 'tool_result' && event.tool === 'analyze_image',
  ).length, 1);
  assert.ok(analysisEvents.some((event) => event.type === 'image_analyzed'));
  const analysisText = analysisEvents
    .filter((event): event is Extract<AgentStreamEvent, { type: 'content' }> => event.type === 'content')
    .map((event) => event.text)
    .join('')
    .trim();
  assert.ok(analysisText.length > 0);
  assert.match(analysisText, /red|crimson/i);
  assert.ok(
    (analysisUsage?.inputTokens ?? 0)
      + (analysisUsage?.cacheReadTokens ?? 0)
      + (analysisUsage?.cacheWriteTokens ?? 0) > 0,
  );
  assert.ok((analysisUsage?.outputTokens ?? 0) > 0);

  console.log(JSON.stringify({
    model: runtime.spec.id,
    provider: runtime.spec.provider,
    providerModel: runtime.spec.providerModelId,
    stream: {
      text: streamedText.trim(),
      firstTextMs,
      inputTokens: streamUsage.inputTokens,
      outputTokens: streamUsage.outputTokens,
      cachedInputTokens: streamUsage.inputTokenDetails?.cacheReadTokens ?? 0,
    },
    tool: {
      executions: toolExecutions,
      text: toolResult.text.trim(),
      steps: toolResult.steps.length,
    },
    vision: visionResult.text.trim(),
    productionAgent: {
      text: mainText,
      events: mainAgentEvents.length,
      inputTokens: mainUsage?.inputTokens,
      cacheReadTokens: mainUsage?.cacheReadTokens,
      cacheWriteTokens: mainUsage?.cacheWriteTokens,
      cacheWriteTelemetryComplete: mainUsage?.cacheWriteTelemetryComplete,
      outputTokens: mainUsage?.outputTokens,
    },
    productionAnalysis: {
      imageAnalyzed: true,
      events: analysisEvents.length,
      inputTokens: analysisUsage?.inputTokens,
      cacheReadTokens: analysisUsage?.cacheReadTokens,
      cacheWriteTokens: analysisUsage?.cacheWriteTokens,
      cacheWriteTelemetryComplete: analysisUsage?.cacheWriteTelemetryComplete,
      outputTokens: analysisUsage?.outputTokens,
      descriptionChars: analysisText.length,
    },
  }, null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
