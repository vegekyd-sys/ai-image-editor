import assert from 'node:assert/strict';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import {
  createAgentModelRuntime,
  getAgentProviderOptions,
} from '../src/lib/agent-model-runtime';
import {
  DEFAULT_AGENT_MODEL_ID,
  isAgentModelId,
  type AgentModelId,
} from '../src/lib/agent-models';
import {
  runMakaronAgent,
  type AgentStreamEvent,
} from '../src/lib/agent';

function redactSensitiveText(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]');
}

function safeErrorDetails(error: unknown): Record<string, unknown> {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  return {
    name: typeof record.name === 'string' ? record.name : 'Error',
    message: redactSensitiveText(error),
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : undefined,
    responseBody: typeof record.responseBody === 'string'
      ? redactSensitiveText(record.responseBody).slice(0, 2_000)
      : undefined,
  };
}

async function main() {
  const configuredModel = process.env.CODEX_SUBSCRIPTION_SMOKE_MODEL?.trim();
  const modelId: AgentModelId = configuredModel && isAgentModelId(configuredModel)
    ? configuredModel
    : DEFAULT_AGENT_MODEL_ID;
  const ownerUserId = process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID?.trim()
    || 'makaron-local-subscription-smoke-owner';

  // A synthetic owner id keeps this probe self-contained. Production must set
  // CODEX_SUBSCRIPTION_OWNER_USER_ID to the owner's real Supabase Auth user id.
  process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = ownerUserId;
  const runtime = createAgentModelRuntime(
    modelId,
    'codex-subscription-live-smoke',
    'codex-subscription',
    ownerUserId,
  );
  assert.equal(runtime.spec.provider, 'codex-subscription');

  const startedAt = Date.now();
  const result = streamText({
    model: runtime.model,
    prompt: 'Reply with exactly CODEX_SUBSCRIPTION_OK',
    providerOptions: getAgentProviderOptions(runtime),
  });
  let text = '';
  let firstTextMs: number | null = null;
  for await (const delta of result.textStream) {
    if (firstTextMs === null) firstTextMs = Date.now() - startedAt;
    text += delta;
  }
  const usage = await result.usage;
  assert.equal(text.trim(), 'CODEX_SUBSCRIPTION_OK');

  let toolExecutions = 0;
  const toolStream = streamText({
    model: runtime.model,
    prompt: 'Call get_status exactly once. Then reply with exactly CODEX_TOOL_OK.',
    tools: {
      get_status: tool({
        description: 'Return the deterministic Makaron subscription smoke status.',
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
  let toolText = '';
  for await (const delta of toolStream.textStream) toolText += delta;
  const toolSteps = await toolStream.steps;
  assert.equal(toolExecutions, 1);
  assert.equal(toolText.trim(), 'CODEX_TOOL_OK');

  const agentEvents: AgentStreamEvent[] = [];
  for await (const event of runMakaronAgent(
    'This is a provider smoke test. Do not call tools. Reply with exactly MAKARON_AGENT_OK.',
    '',
    'codex-subscription-agent-smoke',
    {
      agentModel: modelId,
      agentProvider: 'codex-subscription',
      userId: ownerUserId,
      locale: 'en',
      disableToolCalls: true,
      snapshotImages: [],
      history: [],
    },
  )) {
    agentEvents.push(event);
  }
  const agentError = agentEvents.find((event) => event.type === 'error');
  assert.equal(agentError, undefined, agentError?.message);
  assert.ok(agentEvents.some((event) => event.type === 'done'));
  const agentText = agentEvents
    .filter((event): event is Extract<AgentStreamEvent, { type: 'content' }> => (
      event.type === 'content'
    ))
    .map(event => event.text)
    .join('')
    .trim();
  assert.equal(agentText, 'MAKARON_AGENT_OK');

  console.log(JSON.stringify({
    model: runtime.spec.id,
    provider: runtime.spec.provider,
    result: text.trim(),
    firstTextMs,
    totalMs: Date.now() - startedAt,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    tool: {
      executions: toolExecutions,
      result: toolText.trim(),
      steps: toolSteps.length,
    },
    makaronAgent: {
      result: agentText,
      events: agentEvents.length,
    },
  }, null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(JSON.stringify(safeErrorDetails(error), null, 2));
    process.exit(1);
  },
);
