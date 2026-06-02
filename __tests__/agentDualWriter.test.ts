import { describe, expect, it } from 'vitest';
import { AgentDualWriter } from '../src/lib/agentDualWriter';

describe('AgentDualWriter', () => {
  it('clears content buffer before awaiting DB inserts', async () => {
    const inserted: Array<{ type: string; data: { text?: string } }> = [];
    const fakeSupabase = {
      from: () => ({
        insert: async (row: { type: string; data: { text?: string } }) => {
          inserted.push(row);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { error: null };
        },
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    (writer as unknown as { contentBuffer: string }).contentBuffer = 'first chunk';
    const firstFlush = writer.flushContent();
    expect((writer as unknown as { contentBuffer: string }).contentBuffer).toBe('');

    (writer as unknown as { contentBuffer: string }).contentBuffer = 'second chunk';
    const secondFlush = writer.flushContent();

    await Promise.all([firstFlush, secondFlush]);

    expect(inserted.map((row) => row.data.text)).toEqual(['first chunk', 'second chunk']);
  });
});
