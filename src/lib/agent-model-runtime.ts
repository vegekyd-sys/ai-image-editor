import { createHash } from 'node:crypto';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { wrapLanguageModel, type LanguageModel, type ModelMessage } from 'ai';
import { openRouterResponsesUsage } from './openrouter-responses-usage';
import {
  resolveAgentModelSpecForUser,
  type AgentModelPreference,
  type AgentModelProvider,
  type AgentReasoningEffort,
  type AgentModelSpec,
} from './agent-models';
import { normalizeToolCallInputs } from './tool-inputs';
import { normalizeDeepSeekToolVision } from './deepseek-tool-vision';
import {
  createAgentWebSearchTool as createNativeWebSearchTool,
  isAgentWebSearchEnabled,
} from './agent-web-search-tool';
import { createCodexSubscriptionResponsesModel } from './codex-subscription';
import { createGrokSubscriptionFetch } from './grok-subscription';
import { createOpenAIDirectFetch, getOpenAIDirectApiKey, OPENAI_API_BASE_URL } from './openai-direct';

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
  const modelTier = modelId.replace(/^gpt-(?:5\.6|6(?:\.[12])?)-/, '').replace(/[^a-z0-9-]/gi, '-');
  const projectHash = createHash('sha256').update(projectId).digest('hex').slice(0, 40);
  return `mk-${modelTier}-${projectHash}`;
}

export function createAgentModelRuntime(
  preference: AgentModelPreference | undefined,
  projectId: string,
  configuredGPT56Provider?: AgentModelProvider,
  userId?: string,
  codexSubscriptionAllowed?: boolean,
): AgentModelRuntime {
  // An explicit provider (route decision or fallback) is honoured as-is; only
  // the env default goes through the direct-OpenAI-first budget rule.
  const spec = resolveAgentModelSpecForUser(
    preference,
    process.env.AGENT_MODEL,
    userId,
    configuredGPT56Provider,
    codexSubscriptionAllowed,
  );

  if (spec.provider === 'openai') {
    const apiKey = getOpenAIDirectApiKey();
    if (!apiKey) throw new Error('OPENAI_DIRECT_UNAVAILABLE: OPENAI_API_KEY is required for the direct OpenAI provider');
    const openaiDirect = createOpenAI({
      name: 'openai',
      baseURL: OPENAI_API_BASE_URL,
      apiKey,
      fetch: createOpenAIDirectFetch(),
    });
    return {
      spec,
      model: openaiDirect.responses(spec.providerModelId),
      promptCacheKey: createAzureAgentPromptCacheKey(spec.id, projectId),
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

  if (spec.provider === 'grok-subscription') {
    if (!userId) throw new Error('GROK_SUBSCRIPTION_USER_REQUIRED');
    const grokSubscription = createOpenAI({
      name: 'grok-subscription',
      baseURL: 'https://grok-subscription-relay.invalid/v1',
      apiKey: 'relay-auth-is-hmac-signed-server-side',
      fetch: createGrokSubscriptionFetch(userId),
    });
    return {
      spec,
      model: grokSubscription.chat(spec.providerModelId),
      normalizeMessages: normalizeToolCallInputs,
    };
  }

  if (spec.provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is required for DeepSeek Agent models');
    }
    if (spec.id === 'deepseek-flash') {
      const deepseek = createDeepSeek({ apiKey });
      return {
        spec,
        model: deepseek.chat(spec.providerModelId),
        normalizeMessages: (messages) => normalizeDeepSeekToolVision(normalizeToolCallInputs(messages)),
      };
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
  if (usesOpenRouterResponses(spec)) {
    const openrouterResponses = createOpenAI({
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      headers: { 'HTTP-Referer': 'https://www.makaron.app', 'X-Title': 'Makaron' },
    });
    return {
      spec,
      model: wrapLanguageModel({ model: openrouterResponses.responses(spec.providerModelId), middleware: openRouterResponsesUsage }),
      promptCacheKey: createAzureAgentPromptCacheKey(spec.id, projectId),
      normalizeMessages: normalizeToolCallInputs,
    };
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

function usesOpenRouterResponses(spec: AgentModelSpec): boolean {
  return spec.provider === 'openrouter' && spec.providerModelId?.startsWith('openai/gpt-') === true;
}

function getSupportedAgentReasoningEfforts(modelId: string): readonly AgentReasoningEffort[] {
  if (modelId === 'gpt-6.2-sol' || modelId === 'gpt-6.2-astra') return ['low', 'medium', 'high', 'xhigh', 'max'];
  if (modelId === 'gpt-6.1-terra') return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (modelId === 'gpt-6.1-sol' || modelId === 'grok-4.7') return ['low', 'medium', 'high', 'xhigh'];
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
}

export function getAgentProviderOptions(
  runtime: AgentModelRuntime,
  options?: { compactAtTokens?: number },
): Record<string, any> {
  if (runtime.spec.provider === 'openai') {
    const allowedEfforts = new Set(getSupportedAgentReasoningEfforts(runtime.spec.id));
    const configuredEffort = (process.env.OPENAI_AGENT_REASONING_EFFORT || process.env.AZURE_OPENAI_AGENT_REASONING_EFFORT)
      ?.trim()
      .toLowerCase() as AgentReasoningEffort | undefined;
    const reasoningEffort = runtime.spec.id === 'gpt-6-luna'
      ? 'high'
      : (configuredEffort && allowedEfforts.has(configuredEffort)
        ? configuredEffort
        : runtime.spec.defaultReasoningEffort);
    return {
      openai: {
        ...(runtime.spec.id.startsWith('gpt-6') ? { forceReasoning: true } : {}),
        parallelToolCalls: false,
        maxToolCalls: resolveAzureOpenAIWebSearchMaxCalls(),
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

  if (runtime.spec.provider === 'codex-subscription') {
    const allowedEfforts = new Set(getSupportedAgentReasoningEfforts(runtime.spec.id));
    const configuredEffort = process.env.CODEX_SUBSCRIPTION_REASONING_EFFORT
      ?.trim()
      .toLowerCase() as AgentReasoningEffort | undefined;
    const reasoningEffort = runtime.spec.id === 'gpt-6-luna'
      ? 'high'
      : (configuredEffort && allowedEfforts.has(configuredEffort)
        ? configuredEffort
        : runtime.spec.defaultReasoningEffort);
    return {
      openai: {
        ...(runtime.spec.id.startsWith('gpt-6') ? { forceReasoning: true } : {}),
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

  if (runtime.spec.id === 'deepseek-flash') {
    return { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'high' } };
  }

  if (runtime.spec.provider === 'deepseek') {
    return {
      openai: {
        parallelToolCalls: false,
      },
    };
  }

  if (runtime.spec.provider === 'grok-subscription') {
    return {
      openai: {
        parallelToolCalls: false,
      },
    };
  }

  const configuredOpenRouterEffort = process.env.OPENROUTER_AGENT_REASONING_EFFORT?.trim().toLowerCase();
  const supportedEfforts = new Set<string>(getSupportedAgentReasoningEfforts(runtime.spec.id));
  if (!usesOpenRouterResponses(runtime.spec) && runtime.spec.id !== 'grok-4.7') supportedEfforts.add('max');
  const openRouterEffort = runtime.spec.id === 'gpt-6-luna'
    ? 'high'
    : configuredOpenRouterEffort && supportedEfforts.has(configuredOpenRouterEffort)
      ? configuredOpenRouterEffort
      : runtime.spec.defaultReasoningEffort;

  if (usesOpenRouterResponses(runtime.spec)) {
    // The OpenAI-compatible Responses adapter reads this namespace.
    return {
      openai: {
        forceReasoning: true,
        parallelToolCalls: false,
        store: false,
        maxToolCalls: resolveAzureOpenAIWebSearchMaxCalls(),
        promptCacheKey: runtime.promptCacheKey,
        ...(openRouterEffort ? { reasoningEffort: openRouterEffort } : {}),
      },
    };
  }

  return {
    openrouter: {
      ...(openRouterEffort
        ? { reasoning: { effort: openRouterEffort } }
        : {}),
    },
  };
}

export function resolveAzureOpenAIWebSearchMaxCalls(
  value = process.env.AGENT_WEB_SEARCH_MAX_CALLS ?? process.env.AZURE_OPENAI_WEB_SEARCH_MAX_CALLS,
): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : 2;
}

export function getAgentProviderTools(runtime: AgentModelRuntime): Record<string, any> {
  if (!isAgentWebSearchEnabled() || (!usesOpenRouterResponses(runtime.spec)
    && !['openai', 'codex-subscription'].includes(runtime.spec.provider))) {
    return {};
  }
  return {
    web_search: createNativeWebSearchTool(),
  };
}

export function sumOpenRouterProviderCost(
  runtime: AgentModelRuntime,
  steps: Array<{ providerMetadata?: Record<string, unknown> }>,
): number | undefined {
  if (runtime.spec.provider !== 'openrouter') return undefined;
  let total = 0;
  for (const step of steps) {
    const openrouter = step.providerMetadata?.openrouter as Record<string, unknown> | undefined;
    const usage = openrouter?.usage as Record<string, unknown> | undefined;
    const cost = usage?.cost;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return undefined;
    total += cost;
  }
  return steps.length ? total : undefined;
}
