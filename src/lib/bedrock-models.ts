export const DEFAULT_CLAUDE_SONNET_MODEL = 'us.anthropic.claude-sonnet-5';

export function getAgentModelId(): string {
  return process.env.AGENT_MODEL?.trim() || DEFAULT_CLAUDE_SONNET_MODEL;
}

export function getTipsBedrockModelId(): string {
  return process.env.TIPS_BEDROCK_MODEL?.trim() || getAgentModelId();
}

export function supportsTemperature(modelId: string): boolean {
  return !/anthropic\.claude-sonnet-5$/i.test(modelId);
}

export function isClaudeSonnet5Model(modelId: string): boolean {
  return /anthropic\.claude-sonnet-5$/i.test(modelId);
}
