import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { normalizeToolCallInputs } from '@/lib/tool-inputs';

describe('normalizeToolCallInputs', () => {
  it('keeps object tool inputs unchanged', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 't1', toolName: 'run_code', input: { code: 'return 1' } },
        ],
      },
    ];

    expect(normalizeToolCallInputs(messages)).toBe(messages);
  });

  it('parses JSON string tool inputs into objects', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 't1', toolName: 'run_code', input: '{"code":"return 1"}' as never },
        ],
      },
    ];

    const normalized = normalizeToolCallInputs(messages);
    expect((normalized[0].content[0] as { input: unknown }).input).toEqual({ code: 'return 1' });
  });

  it('wraps non-object tool inputs for provider-safe history replay', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 't1', toolName: 'run_code', input: undefined as never },
          { type: 'tool-call', toolCallId: 't2', toolName: 'list_files', input: '[]' as never },
        ],
      },
    ];

    const normalized = normalizeToolCallInputs(messages);
    const content = normalized[0].content as Array<{ input: unknown }>;
    expect(content[0].input).toEqual({});
    expect(content[1].input).toEqual({ value: [] });
  });
});
