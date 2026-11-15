import { describe, expect, it } from 'vitest';
import { AgentDualWriter } from '@/lib/agentDualWriter';

const text = 'The generated result and its editing link must survive a transient database timeout.';

function fixture(write: (row: Record<string, unknown>) => Promise<{ error: unknown }>) {
  const events: Array<Record<string, unknown>> = [];
  const writes: Array<Record<string, unknown>> = [];
  const client = { from: () => ({
    insert: async (row: Record<string, unknown>) => { events.push(row); return { error: null }; },
    upsert: async (row: Record<string, unknown>, options: unknown) => {
      expect(options).toEqual({ onConflict: 'id' });
      writes.push({ ...row });
      return write(row);
    },
  }) };
  const writer = new AgentDualWriter('run', client as never, 'owner', 'project', null, null, 'canonical-message');
  return { writer, events, writes };
}

describe('Agent message write recovery', () => {
  it.each(['57014', '40001', '40P01', '55P03'])('retries transient SQL %s using the original message identity', async code => {
    let attempts = 0;
    const { writer, writes, events } = fixture(async () => ({ error: attempts++ === 0 ? { code } : null }));
    await writer.processAndEnqueue({ type: 'content', text });
    await writer.processAndEnqueue({ type: 'done' });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[1]).toMatchObject({ id: 'canonical-message', project_id: 'project', content: text });
    expect(events.filter(e => e.type === 'done')).toHaveLength(1);
  });

  it('does not discard a turn after retries are exhausted; later recovery saves that same text', async () => {
    let unavailable = true;
    const { writer, writes, events } = fixture(async () => ({ error: unavailable ? { code: '57014' } : null }));
    await writer.processAndEnqueue({ type: 'content', text });
    await expect(writer.processAndEnqueue({ type: 'new_turn' })).rejects.toMatchObject({ code: '57014' });
    expect(writes).toHaveLength(4);
    expect(writer.firstMessageId).toBe('canonical-message');
    expect(events.filter(e => e.type === 'new_turn')).toHaveLength(0);
    unavailable = false;
    await writer.processAndEnqueue({ type: 'new_turn' });
    expect(writes[4]).toMatchObject({ id: 'canonical-message', content: text });
    expect(writer.firstMessageId).not.toBe('canonical-message');
    expect(events.filter(e => e.type === 'content')).toHaveLength(1);
    expect(events.filter(e => e.type === 'new_turn')).toHaveLength(1);
  });

  it('does not claim completion when message persistence still fails', async () => {
    const { writer, writes, events } = fixture(async () => ({ error: { code: '57014' } }));
    await writer.processAndEnqueue({ type: 'content', text });
    await expect(writer.processAndEnqueue({ type: 'done' })).rejects.toMatchObject({ code: '57014' });
    expect(writes).toHaveLength(4);
    expect(events.filter(e => e.type === 'done')).toHaveLength(0);
  });

  it('does not retry authorization failures or advance the message turn', async () => {
    const { writer, writes, events } = fixture(async () => ({ error: { code: '42501', message: 'permission denied' } }));
    await writer.processAndEnqueue({ type: 'content', text });
    await expect(writer.processAndEnqueue({ type: 'new_turn' })).rejects.toMatchObject({ code: '42501' });
    expect(writes).toHaveLength(1);
    expect(writer.firstMessageId).toBe('canonical-message');
    expect(events.filter(e => e.type === 'new_turn')).toHaveLength(0);
  });

  it('safely repeats an upsert after an ambiguous network response', async () => {
    let attempts = 0;
    const { writer, writes } = fixture(async () => {
      if (attempts++ === 0) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
      return { error: null };
    });
    await writer.processAndEnqueue({ type: 'content', text });
    await writer.processAndEnqueue({ type: 'done' });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
  });
});
