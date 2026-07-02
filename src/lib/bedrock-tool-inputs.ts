import type { ModelMessage } from 'ai';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (isPlainObject(parsed)) return parsed;
      return { value: parsed };
    } catch {
      return { value };
    }
  }

  if (value === undefined || value === null) return {};
  return { value };
}

export function normalizeBedrockToolUseInputs(messages: ModelMessage[]): ModelMessage[] {
  let changed = false;
  const normalized = messages.map((message) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return message;

    let contentChanged = false;
    const content = message.content.map((part) => {
      if (part.type !== 'tool-call') return part;
      const input = normalizeToolInput(part.input);
      if (input === part.input) return part;
      contentChanged = true;
      return { ...part, input };
    });

    if (!contentChanged) return message;
    changed = true;
    return { ...message, content };
  });

  return changed ? normalized : messages;
}

export function describeBedrockToolUseInputIssue(error: unknown): string | null {
  const requestBodyValues = (error as { requestBodyValues?: unknown })?.requestBodyValues;
  if (!isPlainObject(requestBodyValues)) return null;
  const messages = requestBodyValues.messages;
  if (!Array.isArray(messages)) return null;

  const issue = String((error as { message?: string })?.message ?? '').match(/messages\.(\d+)\.content\.(\d+)\.toolUse\.input/);
  if (!issue) return null;

  const messageIndex = Number(issue[1]);
  const contentIndex = Number(issue[2]);
  const content = (messages[messageIndex] as { content?: unknown[] } | undefined)?.content?.[contentIndex];
  if (!isPlainObject(content)) return `messages.${messageIndex}.content.${contentIndex} is ${typeof content}`;
  const input = (content as { toolUse?: { input?: unknown } }).toolUse?.input;
  return `messages.${messageIndex}.content.${contentIndex}.toolUse.input type=${Array.isArray(input) ? 'array' : typeof input} value=${JSON.stringify(input).slice(0, 300)}`;
}
