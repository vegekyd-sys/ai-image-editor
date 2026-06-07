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

  it('backfills video snapshot description from analyze_video tool results', async () => {
    const updates: Array<{ table: string; row: Record<string, unknown>; id?: string }> = [];
    const snapshots = [
      { id: 'snap-1', description: null },
      { id: 'snap-2', description: '' },
    ];
    const fakeSupabase = {
      from: (table: string) => {
        const builder = {
          insert: async () => ({ error: null }),
          upsert: async () => ({ error: null }),
          select: () => builder,
          eq: (column: string, value: string) => {
            if (table === 'snapshots' && column === 'id') {
              updates[updates.length - 1].id = value;
              return Promise.resolve({ error: null });
            }
            return builder;
          },
          order: async () => ({ data: snapshots, error: null }),
          update: (row: Record<string, unknown>) => {
            updates.push({ table, row });
            return builder;
          },
        };
        return builder;
      },
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    await writer.processAndEnqueue({
      type: 'tool_call',
      tool: 'analyze_video',
      toolCallId: 'tool-1',
      step: 0,
      input: { media_index: 2, question: 'summarize' },
    });
    await writer.processAndEnqueue({
      type: 'tool_result',
      tool: 'analyze_video',
      toolCallId: 'tool-1',
      step: 0,
      output: { analysis: 'This video shows a product update.\n\nIt mentions video editing.' },
    });

    expect(updates).toEqual([
      {
        table: 'snapshots',
        row: { description: 'This video shows a product update. It mentions video editing.' },
        id: 'snap-2',
      },
    ]);
  });
});
