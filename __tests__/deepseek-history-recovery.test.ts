import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { classifyModelTermination } from '../src/lib/agent-terminal';
import { prepareDeepSeekHistoryRecovery } from '../src/lib/deepseek-history-recovery';

const original = '版本一🎞️ abc\n'.repeat(2800);
const later = 'version 2 📺\n'.repeat(1300);
const tail: ModelMessage[] = Array.from({ length: 24 }, (_, i) => ({ role: 'user', content: String(i) }));
function result(output: unknown, toolName = 'read_file'): ModelMessage {
  return { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call1', toolName, output }] } as ModelMessage;
}
const refFrom = (m: ModelMessage) => JSON.stringify(m).match(/ref ([a-f0-9]{64})/)![1];

describe('DeepSeek context rejection', () => {
  const message = "This model's maximum context length is 1048576 tokens. However, you requested 1086949 tokens.";
  const observation = { sawFinish: false, finalStepTextChars: 0, finalStepToolCalls: 0, finalStepDeliveredArtifact: false };
  it.each([
    ['deepseek', 400, message, 'context_length_exceeded'],
    ['deepseek', 503, message, 'stream_error'],
    ['another', 400, message, 'stream_error'],
    ['deepseek', 400, 'invalid tool arguments', 'stream_error'],
  ])('classifies %s %s %s', (provider, statusCode, msg, code) => {
    expect(classifyModelTermination({ ...observation, provider: String(provider),
      streamError: Object.assign(new Error(String(msg)), { statusCode }),
    })).toMatchObject({ code, retryable: code === 'stream_error' });
  });

  it('round-trips different saved versions of the same path without rereading the workspace', () => {
    const raw = [result({ type: 'json', value: { path: 'script.ts', type: 'text/plain', content: original } }),
      result({ type: 'text', value: '[script.ts]\n\n' + later }), ...tail];
    const saved = JSON.stringify(raw);
    const h = prepareDeepSeekHistoryRecovery(raw);
    expect(h.size).toBe(2);
    expect(JSON.stringify(h.messages)).toContain('script.ts');
    expect(JSON.stringify(raw)).toBe(saved);
    expect(h.messages).toHaveLength(raw.length);
    expect(h.messages.slice(-24)).toEqual(tail);
    for (const [i, expected] of [original, later].entries()) {
      const ref = refFrom(h.messages[i]);
      let text = '', offset: number | null = 0;
      do {
        const page = h.readPage(ref, offset);
        expect(page.error).toBeUndefined();
        text += page.text;
        offset = page.nextOffset ?? null;
      } while (offset != null);
      expect(text).toBe(expected);
    }
    expect(h.readPage('missing')).toHaveProperty('error');
    expect(h.readPage(refFrom(h.messages[0]), -1)).toHaveProperty('error');
    expect(prepareDeepSeekHistoryRecovery(tail).readPage(refFrom(h.messages[0]))).toHaveProperty('error');
  });

  it('leaves recent results, user instructions, tool calls, errors and non-file outputs inline', () => {
    const file = result({ type: 'text', value: '[file]\n\n' + original });
    const raw: ModelMessage[] = [
      { role: 'user', content: original },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call1', toolName: 'read_file', input: { path: 'file' } }] },
      result({ type: 'error-text', value: original }), result({ type: 'json', value: { path: 'file', content: original } }, 'run_code'),
      ...tail, file,
    ];
    const h = prepareDeepSeekHistoryRecovery(raw);
    expect(h.messages).toEqual(raw);
    expect(h.size).toBe(0);
  });
});
