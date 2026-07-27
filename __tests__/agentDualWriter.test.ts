import { describe, expect, it } from 'vitest';
import { AgentDualWriter } from '../src/lib/agentDualWriter';

describe('AgentDualWriter', () => {
  it('retries transient event writes with one stable id and sequence', async () => {
    const rows: Array<Record<string, unknown>> = [];
    let attempts = 0;
    const fakeSupabase = {
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          attempts += 1;
          rows.push(row);
          if (attempts === 1) {
            const error = new Error('fetch failed') as Error & { cause?: unknown };
            error.cause = { code: 'ECONNRESET', message: 'socket disconnected' };
            throw error;
          }
          return { error: null };
        },
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    await writer.persistHeartbeat();

    expect(attempts).toBe(2);
    expect(rows[0].id).toBe(rows[1].id);
    expect(rows[0].seq).toBe(rows[1].seq);
  });

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

  it('batches durable code deltas without losing source order', async () => {
    const inserted: Array<{ type: string; data: { text?: string; done?: boolean } }> = [];
    const fakeSupabase = {
      from: () => ({
        insert: async (row: { type: string; data: { text?: string; done?: boolean } }) => {
          inserted.push(row);
          return { error: null };
        },
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    await writer.processAndEnqueue({ type: 'code_stream', text: 'function Composition() {' });
    await writer.processAndEnqueue({ type: 'code_stream', text: '\n  return null;\n}' });
    expect(inserted).toHaveLength(0);

    await writer.processAndEnqueue({ type: 'code_stream', text: '', done: true });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      type: 'code_stream',
      data: {
        text: 'function Composition() {\n  return null;\n}',
        done: true,
      },
    });
  });

  it('persists partial code when a stream ends before the done marker', async () => {
    const inserted: Array<{ type: string; data: { text?: string; done?: boolean } }> = [];
    const fakeSupabase = {
      from: () => ({
        insert: async (row: { type: string; data: { text?: string; done?: boolean } }) => {
          inserted.push(row);
          return { error: null };
        },
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    await writer.processAndEnqueue({ type: 'code_stream', text: 'const unfinished = true;' });
    await writer.flush();

    expect(inserted).toContainEqual(expect.objectContaining({
      type: 'code_stream',
      data: { text: 'const unfinished = true;', done: undefined },
    }));
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

  it('persists a recoverable terminal message and its draft checkpoint', async () => {
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

    await writer.processAndEnqueue({
      type: 'error',
      code: 'empty_final_step',
      recoverable: true,
      message: '草稿已经保存，发送“继续”即可恢复。',
      checkpoint: { draftPath: 'project/code/draft.json', lastTool: 'preview_frame' },
    });

    expect(upserts).toContainEqual({
      table: 'messages',
      row: expect.objectContaining({ content: '草稿已经保存，发送“继续”即可恢复。' }),
    });
    expect(inserts).toContainEqual({
      table: 'agent_events',
      row: expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({
          code: 'empty_final_step',
          recoverable: true,
          checkpoint: { draftPath: 'project/code/draft.json', lastTool: 'preview_frame' },
        }),
      }),
    });
  });

  it('refuses to persist done after a preview-only empty final turn', async () => {
    const fakeSupabase = {
      from: () => ({
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    await writer.processAndEnqueue({
      type: 'preview_frame_captured',
      workspaceUrl: 'https://storage.example.com/frame.jpg',
    });
    await writer.processAndEnqueue({ type: 'new_turn' });

    await expect(writer.processAndEnqueue({ type: 'done' }))
      .rejects.toThrow('Refusing empty agent completion');
  });

  it('does not mark a published design delivered when snapshot persistence fails', async () => {
    const fakeSupabase = {
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'https://storage.example.com/design.json' } }),
        }),
      },
      rpc: async () => ({ data: 1 }),
      from: (table: string) => ({
        insert: async () => ({ error: null }),
        upsert: async () => ({
          error: table === 'snapshots' ? { message: 'snapshot write failed' } : null,
        }),
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');

    await expect(writer.processAndEnqueue({
      type: 'render',
      code: 'export default function Demo() { return null }',
      width: 1080,
      height: 1920,
      published: true,
    })).rejects.toThrow('Failed to persist published design snapshot');

    await expect(writer.processAndEnqueue({ type: 'done' }))
      .rejects.toThrow('Refusing empty agent completion');
  });

  it('honors the stable Snapshot ID supplied by explicit draft promotion', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const fakeSupabase = {
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'https://storage.example.com/design.json' } }),
        }),
      },
      rpc: async () => ({ data: 7 }),
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
    const snapshotId = '2b592fcc-2bc6-5f2b-b3f1-eaff0f202bdb';

    await writer.processAndEnqueue({
      type: 'render',
      code: 'function Composition() { return null }',
      width: 1920,
      height: 1080,
      snapshotId,
      sourceDesignPath: 'project-id/drafts/latest-composition.json',
      published: true,
    });

    expect(upserts).toContainEqual({
      table: 'snapshots',
      row: expect.objectContaining({
        id: snapshotId,
        design_path: `code/${snapshotId}.json`,
      }),
    });
    expect(inserts).toContainEqual({
      table: 'agent_events',
      row: expect.objectContaining({
        type: 'render',
        data: expect.objectContaining({
          snapshotId,
          sourceDesignPath: 'project-id/drafts/latest-composition.json',
          published: true,
        }),
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

  it('emits every Studio Run update from a batched artifact write', async () => {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const fakeSupabase = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: null };
        },
      }),
    };
    const writer = new AgentDualWriter('run-id', fakeSupabase as never, 'user-id', 'project-id');
    await writer.processAndEnqueue({
      type: 'tool_call',
      tool: 'studio_run',
      toolCallId: 'studio-tool',
      step: 1,
      input: { operation: 'put_artifacts' },
    });
    await writer.processAndEnqueue({
      type: 'tool_result',
      tool: 'studio_run',
      toolCallId: 'studio-tool',
      step: 1,
      output: {
        studioRunUpdates: [
          { studioRun: { runId: 'studio', currentStage: 'proposal' }, artifactPath: 'brief.json' },
          { studioRun: { runId: 'studio', currentStage: 'script' }, artifactPath: 'proposal.json' },
        ],
      },
    });

    const studioEvents = inserts.filter(item => item.table === 'agent_events' && item.row.type === 'studio_run');
    expect(studioEvents.map(item => item.row.data)).toEqual([
      { runId: 'studio', currentStage: 'proposal', artifactPath: 'brief.json' },
      { runId: 'studio', currentStage: 'script', artifactPath: 'proposal.json' },
    ]);
  });
});
