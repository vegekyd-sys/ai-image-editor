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

  it('persists preview frame captures with the current message id', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const fakeSupabase = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: null };
        },
        upsert: async (row: Record<string, unknown>) => {
          upserts.push({ table, row });
          return { error: null };
        },
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');
    const messageId = writer.firstMessageId;

    await writer.processAndEnqueue({ type: 'content', text: '先看一帧' });
    await writer.processAndEnqueue({
      type: 'preview_frame_captured',
      workspaceUrl: 'https://storage.example.com/frame.jpg',
    });

    expect(upserts).toContainEqual({
      table: 'messages',
      row: expect.objectContaining({
        id: messageId,
        has_image: true,
      }),
    });
    expect(inserts).toContainEqual({
      table: 'agent_events',
      row: expect.objectContaining({
        type: 'preview_frame_captured',
        data: {
          workspaceUrl: 'https://storage.example.com/frame.jpg',
          messageId,
        },
      }),
    });
  });
});
