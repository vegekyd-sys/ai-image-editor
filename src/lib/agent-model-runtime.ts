import { createBedrockAnthropic } from '@ai-sdk/amazon-bedrock/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel, ModelMessage } from 'ai';
import {
  resolveAgentModelSpec,
  type AgentModelPreference,
  type AgentModelSpec,
} from './agent-models';
import { normalizeBedrockToolUseInputs } from './bedrock-tool-inputs';

const BEDROCK_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
} as const;

export interface AgentModelRuntime {
  spec: AgentModelSpec;
  model: LanguageModel;
  cachePointProviderOptions?: Record<string, any>;
  normalizeMessages(messages: ModelMessage[]): ModelMessage[];
}

export function createAgentModelRuntime(
  preference: AgentModelPreference | undefined,
  projectId: string,
): AgentModelRuntime {
  const spec = resolveAgentModelSpec(preference, process.env.AGENT_MODEL);

  if (spec.provider === 'bedrock-anthropic') {
    const bedrockAnthropic = createBedrockAnthropic({
      region: process.env.AWS_REGION?.trim(),
      accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    });
    return {
      spec,
      model: bedrockAnthropic(spec.providerModelId),
      cachePointProviderOptions: BEDROCK_CACHE_CONTROL,
      normalizeMessages: normalizeBedrockToolUseInputs,
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
      normalizeMessages: normalizeBedrockToolUseInputs,
    };
  }

  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY?.trim(),
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
    normalizeMessages: normalizeBedrockToolUseInputs,
  };
}

export function getAgentProviderOptions(
  runtime: AgentModelRuntime,
  options: {
    anthropicThinkingMode?: string;
    reasoningEffort?: string;
    anthropicContextManagement?: Record<string, unknown>;
  },
): Record<string, any> {
  if (runtime.spec.provider === 'bedrock-anthropic') {
    return {
      anthropic: {
        disableParallelToolUse: true,
        toolStreaming: false,
        ...(options.anthropicThinkingMode
          ? { thinking: { type: options.anthropicThinkingMode } }
          : {}),
        ...(options.anthropicThinkingMode !== 'disabled' && options.reasoningEffort
          ? { effort: options.reasoningEffort }
          : {}),
        ...(options.anthropicContextManagement
          ? { contextManagement: options.anthropicContextManagement }
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

  // Keep provider overrides independent so a temporary Sonnet high/max setting
  // does not silently change Grok. Both providers default to the dev baseline:
  // medium reasoning effort.
  const configuredOpenRouterEffort = process.env.OPENROUTER_AGENT_REASONING_EFFORT?.trim().toLowerCase();
  const allowedOpenRouterEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  const openRouterEffort = configuredOpenRouterEffort && allowedOpenRouterEfforts.has(configuredOpenRouterEffort)
    ? configuredOpenRouterEffort
    : runtime.spec.id === 'grok-4.5'
      ? 'medium'
      : undefined;

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
