import { openai } from '@ai-sdk/openai';

export type AgentWebSearchContextSize = 'low' | 'medium' | 'high';

export function isAgentWebSearchEnabled(
  value = process.env.AGENT_WEB_SEARCH_ENABLED,
): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

export function resolveAgentWebSearchContextSize(
  value = process.env.AGENT_WEB_SEARCH_CONTEXT_SIZE ?? process.env.AZURE_OPENAI_WEB_SEARCH_CONTEXT_SIZE,
): AgentWebSearchContextSize {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'medium' || normalized === 'high' ? normalized : 'low';
}

export function createAgentWebSearchTool(options?: {
  contextSize?: string;
}) {
  return openai.tools.webSearch({
    searchContextSize: resolveAgentWebSearchContextSize(options?.contextSize),
  });
}
