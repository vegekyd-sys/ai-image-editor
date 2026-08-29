import { createHash } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel, ModelMessage } from 'ai';
import {
  resolveAgentModelSpecForUser,
  type AgentModelPreference,
  type GPT56AgentProvider,
  type AgentReasoningEffort,
  type AgentModelSpec,
} from './agent-models';
import { normalizeToolCallInputs } from './tool-inputs';
import { createAzureOpenAIResponsesModel } from './azure-openai-responses';
import { createCodexSubscriptionResponsesModel } from './codex-subscription';

export interface AgentModelRuntime {
  spec: AgentModelSpec;
  model: LanguageModel;
  promptCacheKey?: string;
  normalizeMessages(messages: ModelMessage[]): ModelMessage[];
}

export function createAzureAgentPromptCacheKey(
  modelId: string,
  projectId: string,
): string {
  const modelTier = modelId.replace(/^gpt-5\.6-/, '').replace(/[^a-z0-9-]/gi, '-');
  const projectHash = createHash('sha256').update(projectId).digest('hex').slice(0, 40);
  return `mk-${modelTier}-${projectHash}`;
}

export function createAgentModelRuntime(
  preference: AgentModelPreference | undefined,
  projectId: string,
  configuredGPT56Provider?: GPT56AgentProvider,
  userId?: string,
): AgentModelRuntime {
  const spec = resolveAgentModelSpecForUser(
    preference,
    process.env.AGENT_MODEL,
    userId,
    configuredGPT56Provider ?? process.env.GPT56_AGENT_PROVIDER,
  );

  if (spec.provider === 'azure-openai') {
    const promptCacheKey = createAzureAgentPromptCacheKey(spec.id, projectId);
    return {
      spec,
      model: createAzureOpenAIResponsesModel(spec.providerModelId),
      promptCacheKey,
      normalizeMessages: normalizeToolCallInputs,
    };
  }

  if (spec.provider === 'codex-subscription') {
    return {
      spec,
      model: createCodexSubscriptionResponsesModel(
        spec.providerModelId,
        projectId,
        { userId },
      ),
      promptCacheKey: createAzureAgentPromptCacheKey(spec.id, projectId),
      normalizeMessages: normalizeToolCallInputs,
    };
  }

  if (spec.provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is required for DeepSeek V4 Pro');
    }
    const deepseek = createOpenAI({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      apiKey,
    });
    return {
      spec,
      model: deepseek.chat(spec.providerModelId),
      normalizeMessages: normalizeToolCallInputs,
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required for OpenRouter Agent models');
  }
  const openrouter = createOpenRouter({
    apiKey,
    compatibility: 'strict',
    appName: 'Makaron',
    appUrl: 'https://www.makaron.app',
  });
  return {
    spec,
    model: openrouter.chat(spec.providerModelId, {
      parallelToolCalls: false,
      usage: { include: true },
      extraBody: {
        session_id: `makaron:${projectId}`,
      },
    }),
    normalizeMessages: normalizeToolCallInputs,
  };
}

export function getAgentProviderOptions(
  runtime: AgentModelRuntime,
  options?: { compactAtTokens?: number },
): Record<string, any> {
  if (runtime.spec.provider === 'azure-openai') {
    const allowedEfforts = new Set<AgentReasoningEffort>([
      'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
    ]);
    const configuredEffort = process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT
      ?.trim()
      .toLowerCase() as AgentReasoningEffort | undefined;
    const reasoningEffort = configuredEffort && allowedEfforts.has(configuredEffort)
      ? configuredEffort
      : runtime.spec.defaultReasoningEffort;
    return {
      azure: {
        parallelToolCalls: false,
        store: false,
        promptCacheKey: runtime.promptCacheKey,
        promptCacheOptions: {
          mode: 'implicit',
          ttl: '30m',
        },
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(options?.compactAtTokens
          ? {
              contextManagement: [{
                type: 'compaction',
                compactThreshold: options.compactAtTokens,
              }],
            }
          : {}),
      },
    };
  }

  if (runtime.spec.provider === 'codex-subscription') {
    const allowedEfforts = new Set<AgentReasoningEffort>([
      'none', 'minimal', 'low', 'medium', 'high', 'xhigh',
    ]);
    const configuredEffort = process.env.CODEX_SUBSCRIPTION_REASONING_EFFORT
      ?.trim()
      .toLowerCase() as AgentReasoningEffort | undefined;
    const reasoningEffort = configuredEffort && allowedEfforts.has(configuredEffort)
      ? configuredEffort
      : runtime.spec.defaultReasoningEffort;
    return {
      openai: {
        parallelToolCalls: false,
        store: false,
        promptCacheKey: runtime.promptCacheKey,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(options?.compactAtTokens
          ? {
              contextManagement: [{
                type: 'compaction',
                compactThreshold: options.compactAtTokens,
              }],
            }
          : {}),
      },
    };
  }

  if (runtime.spec.provider === 'deepseek') {
    return {
      openai: {
        parallelToolCalls: false,
      },
    };
  }

  // Keep OpenRouter reasoning independent from Azure so one provider's tuning
  // cannot silently add several minutes of latency to another provider.
  const configuredOpenRouterEffort = process.env.OPENROUTER_AGENT_REASONING_EFFORT?.trim().toLowerCase();
  const allowedOpenRouterEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  const openRouterEffort = configuredOpenRouterEffort && allowedOpenRouterEfforts.has(configuredOpenRouterEffort)
    ? configuredOpenRouterEffort
    : runtime.spec.defaultReasoningEffort
      ?? (runtime.spec.id === 'grok-4.5' ? 'medium' : undefined);

  return {
    openrouter: {
      ...(openRouterEffort
        ? { reasoning: { effort: openRouterEffort } }
        : {}),
    },
  };
}

export function sumOpenRouterProviderCost(
  runtime: AgentModelRuntime,
  steps: Array<{ providerMetadata?: Record<string, unknown> }>,
): number | undefined {
  if (runtime.spec.provider !== 'openrouter') return undefined;
  let total = 0;
  let found = false;
  for (const step of steps) {
    const openrouter = step.providerMetadata?.openrouter as Record<string, unknown> | undefined;
    const usage = openrouter?.usage as Record<string, unknown> | undefined;
    const cost = usage?.cost;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) {
      total += cost;
      found = true;
    }
  }
  return found ? total : undefined;
}
