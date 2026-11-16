import { createHash } from 'node:crypto';
import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';

// Only used after the provider has rejected this run's full input. Keep recent
// tool work inline, and never replace conversation turns, calls or error results.
const RECENT_MESSAGES = 24;
const INLINE_CHARS = 4096;
const PAGE_CHARS = 8192;

export function prepareDeepSeekHistoryRecovery(history: ModelMessage[]) {
  const bodies = new Map<string, string>();
  const pointer = (body: string) => {
    const ref = createHash('sha256').update(body, 'utf16le').digest('hex');
    bodies.set(ref, body);
    return `[Historical file text: ${body.length} characters. Use read_history_file with ref ${ref} for the exact text.]`;
  };
  const messages = history.map((message, index): ModelMessage => {
    if (index >= history.length - RECENT_MESSAGES || message.role !== 'tool') return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== 'tool-result' || part.toolName !== 'read_file') return part;
      const out = part.output;
      if (out.type === 'text' && out.value.length > INLINE_CHARS) {
        // Replayed read_file text is "[path]\n\n<body>". Keep the path inline.
        const prefix = /^\[[^\r\n]{1,2048}\]\n\n/.exec(out.value)?.[0];
        if (!prefix || out.value.length - prefix.length <= INLINE_CHARS) return part;
        return { ...part, output: { ...out, value: prefix + pointer(out.value.slice(prefix.length)) } };
      }
      if (out.type === 'json' && out.value && typeof out.value === 'object' && !Array.isArray(out.value)) {
        const v = out.value;
        if (typeof v.path === 'string' && typeof v.content === 'string' && v.content.length > INLINE_CHARS) {
          return { ...part, output: { ...out, value: { ...v, content: pointer(v.content) } } };
        }
      }
      return part;
    }) };
  });

  function readPage(ref: string, offset = 0) {
    const body = bodies.get(ref);
    if (body === undefined) return { error: 'Unknown historical file reference in this request.' };
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > body.length) return { error: 'Offset outside file.' };
    let end = Math.min(body.length, offset + PAGE_CHARS);
    // Keep supplementary Unicode characters intact when displaying a page.
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1]) && /[\uDC00-\uDFFF]/.test(body[end])) end--;
    return { text: body.slice(offset, end), nextOffset: end < body.length ? end : null };
  }
  return {
    messages, size: bodies.size, readPage,
    reader: tool({
      description: 'Read the exact recorded text from a historical read_file reference, including when the workspace file has since changed. Supply the returned nextOffset to read the next page.',
      inputSchema: z.object({ ref: z.string(), offset: z.number().int().min(0).optional() }),
      execute: async ({ ref, offset }) => readPage(ref, offset),
    }),
  };
}
