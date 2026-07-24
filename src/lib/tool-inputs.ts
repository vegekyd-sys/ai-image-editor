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

export function normalizeToolCallInputs(messages: ModelMessage[]): ModelMessage[] {
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
