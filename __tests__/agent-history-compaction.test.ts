import { describe, expect, it, vi } from 'vitest';
import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import {
  createHistoryCompactor, fixedRequestBudget, nativeContinuation, restoreApplicationHistory,
  summarizeHistory, type ApplicationCompaction,
} from '../src/lib/agent-history-compaction';
import { getAgentContextPolicy } from '../src/lib/agent-execution';
import { buildModelHistoryFromRows } from '../src/lib/agentToolHistory';

const ai = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', async actual => ({ ...await actual<typeof import('ai')>(), generateText: ai.generateText }));
const current: ModelMessage = { role: 'user', content: 'Correction: keep the cobalt title and the approved take.' };
const approved: ModelMessage = { role: 'assistant', content: 'Approved copy: let the clock sing twice.' };
const handoff = { objective: 'Finish the card', approvedContent: ['let the clock sing twice'], completedActions: ['publish receipt 17'], artifacts: ['card/v3'], constraints: ['cobalt title'], pendingWork: ['review'] };
function batch(id: string, size: number, name = 'publish_draft'): ModelMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolName: name, toolCallId: id, input: { version: 3 } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolName: name, toolCallId: id, output: {
      type: 'json', value: { success: true, designPath: 'card/v3', receiptId: 'receipt17', code: 'x'.repeat(size) },
    } }] },
  ];
}
function setup(history: ModelMessage[] = [], previous?: ApplicationCompaction) {
  const persist = vi.fn(async (_state: ApplicationCompaction) => {});
  const summarize = vi.fn(async (_source: string) => handoff);
  const config = { history, current, policy: { ...getAgentContextPolicy('test'), providerCompactAtTokens: 2000 },
    runId: 'run1', previous, fixedTokens: 200, native: false, summarize, persist,
    toolCallRuns: new Map([['effect', 'run1']]) };
  return { config, persist, summarize, session: createHistoryCompactor(config) };
}

describe('automatic conversation compaction', () => {
  it('budgets the actual tool schema, system prompt, and output reserve', async () => {
    const base = await fixedRequestBudget('');
    expect(base).toBeGreaterThanOrEqual(16000);
    const tools = { lookup: tool({ description: 'find file', inputSchema: z.object({ path: z.string().describe('x'.repeat(12000)) }) }) };
    expect(await fixedRequestBudget('z'.repeat(8000), tools)).toBeGreaterThan(base + 6000);
  });

  it('keeps short history intact, then commits and uses a summary after a tool step', async () => {
    const heavy = batch('effect', 18000);
    const next = batch('next', 0, 'read_file');
    const { session, persist, summarize } = setup([approved]);
    expect(await session.prepare([])).toEqual([approved, current]);
    expect(persist).not.toHaveBeenCalled();
    const prepared = await session.prepare(heavy);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0][0]).toContain('x'.repeat(18000));
    expect(prepared).toContain(current);
    expect(prepared).toContain(approved);
    expect(JSON.stringify(prepared)).toContain('receiptId=receipt17');
    expect(JSON.stringify(prepared)).not.toContain('x'.repeat(500));
    expect(await session.prepare([...heavy, ...next])).toEqual([...prepared, ...next]);
    expect(summarize).toHaveBeenCalledTimes(1);

    const stored = JSON.parse(JSON.stringify(persist.mock.calls[0][0]));
    const reload = setup([approved, ...batch('effect', 100), ...next], stored);
    const nextRequest = await reload.session.prepare([]);
    expect(nextRequest).toEqual([prepared[0], approved, ...next, current]);
    expect(reload.summarize).not.toHaveBeenCalled();
    const otherRun = restoreApplicationHistory([approved, ...heavy], stored, new Map([['effect', 'different-run']]));
    expect(otherRun.remaining.map(r => r.message)).toEqual(heavy);
  });

  it('compacts again in the same run and reuses each completed operation after reload', async () => {
    const first = batch('effect', 18000), second = batch('effect2', 20000);
    const v = setup([approved]);
    await v.session.prepare(first);
    const prepared = await v.session.prepare([...first, ...second]);
    expect(v.summarize).toHaveBeenCalledTimes(2);
    expect(v.summarize.mock.calls[1][0]).not.toContain('"toolCallId":"effect"');
    const stored = v.persist.mock.calls[1][0];
    expect(stored.liveToolResults).toHaveLength(2);
    const replay = setup([approved, ...first, ...second], stored);
    replay.config.toolCallRuns.set('effect2', 'run1');
    const reloaded = createHistoryCompactor(replay.config);
    expect(await reloaded.prepare([])).toEqual(prepared);
  });

  it('never submits opaque Responses state to a chat provider', async () => {
    const opaque: ModelMessage = { role: 'assistant', content: [{ type: 'custom', kind: 'openai.compaction',
      providerOptions: { openai: { itemId: 'c', encryptedContent: 'opaque' } } }] };
    const v = setup([opaque]);
    await expect(v.session.prepare([])).rejects.toThrow();
    expect(v.summarize).not.toHaveBeenCalled();
  });

  it('recovers an already oversized history before sending it; a changed prefix replays', async () => {
    const heavy = batch('early', 3400000, 'read_file');
    const history = [...heavy, approved, ...batch('late', 100, 'read_file')];
    const before = JSON.stringify(history);
    const { session, persist } = setup(history);
    const prepared = await session.prepare([]);
    expect(prepared.slice(-3)).toEqual([...history.slice(-2), current]);
    expect(JSON.stringify(history)).toBe(before);
    const stored = persist.mock.calls[0][0];
    const changed = [{ role: 'user', content: 'Earlier correction' } as ModelMessage, ...history];
    expect(restoreApplicationHistory(changed, stored).state).toBeUndefined();
    expect(restoreApplicationHistory(changed, stored).remaining.map(r => r.message)).toEqual(changed);
    expect(restoreApplicationHistory(history, { ...stored, handoff: {} } as never).state).toBeUndefined();
  });

  it('preserves native inline compaction and the following tool pair', () => {
    const opaque = { type: 'custom', kind: 'openai.compaction', providerOptions: { azure: { itemId: 'c1', encryptedContent: 'secret-opaque' } } };
    const pair = batch('next', 0);
    const messages = [approved, current, { role: 'assistant', content: [{ type: 'text', text: 'old' }, opaque] }, ...pair] as ModelMessage[];
    expect(nativeContinuation(messages, 100, 100000, 'azure')?.messages).toEqual([{ role: 'assistant', content: [opaque] }, ...pair]);
    expect(nativeContinuation(messages, 100, 100000, 'openai')).toBeUndefined();
    const malformed = { ...opaque, providerOptions: { azure: { itemId: 'c1' } } };
    expect(nativeContinuation([{ role: 'assistant', content: [malformed] }] as ModelMessage[], 100, 100000, 'azure')).toBeUndefined();
    const v = setup(batch('old', 12000));
    return expect(createHistoryCompactor({ ...v.config, native: true }).prepare([])).resolves.toEqual([...v.config.history, current]);
  });

  it('keeps a trailing user correction when the new prompt has not been written yet', () => {
    const row = { role: 'user' as const, content: 'keep the approved ending', created_at: '2026-11-16' };
    expect(buildModelHistoryFromRows([row], [], 'next request')).toEqual([{ role: 'user', content: row.content }]);
    expect(buildModelHistoryFromRows([row], [], row.content)).toEqual([]);
  });

  it.each(['summary failure', 'invalid handoff', 'save failure'])('never advances coverage on %s', async kind => {
    const v = setup(batch('old', 18000));
    if (kind === 'summary failure') v.summarize.mockRejectedValueOnce(Error('unavailable'));
    if (kind === 'invalid handoff') v.summarize.mockResolvedValueOnce({ objective: 'partial' } as never);
    if (kind === 'save failure') v.persist.mockRejectedValueOnce(Error('offline'));
    await expect(v.session.prepare([])).rejects.toThrow();
    expect(v.session.hasHandoff).toBe(false);
    if (kind !== 'save failure') expect(v.persist).not.toHaveBeenCalled();
    expect(JSON.stringify(await v.session.prepare([]))).toContain('[Conversation handoff]');
    expect(v.summarize).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['length', { ...handoff, evidence: 'cobalt' }],
    ['stop', { objective: 'partial', evidence: 'cobalt' }],
    ['stop', { ...handoff, constraints: ['invented'], evidence: 'unseen proof' }],
    ['stop', { ...handoff, constraints: [], approvedContent: [], completedActions: [], artifacts: [], pendingWork: [], evidence: 'cobalt' }],
  ])('rejects incomplete or ungrounded summary responses', async (finishReason, value) => {
    ai.generateText.mockReset().mockResolvedValue({ finishReason, text: JSON.stringify(value) });
    await expect(summarizeHistory({ model: 'dummy', records: 'cobalt', recordUsage: () => {} })).rejects.toThrow();
    expect(ai.generateText).toHaveBeenCalledTimes(finishReason === 'stop' ? 2 : 1);
  });

  it('accepts a list of literal source quotes and only repairs the invalid text summary', async () => {
    ai.generateText.mockReset()
      .mockResolvedValueOnce({ finishReason: 'stop', text: JSON.stringify({ ...handoff, constraints: ['invented'], evidence: ['cobalt', 'invented'] }) })
      .mockResolvedValueOnce({ finishReason: 'stop', text: JSON.stringify({ ...handoff, evidence: ['cobalt', 'receipt17'] }) });
    const recordUsage = vi.fn();
    expect(await summarizeHistory({ model: 'dummy', records: 'cobalt receipt17', recordUsage })).toEqual(handoff);
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(ai.generateText.mock.calls.every(([options]) => !options.tools && options.maxRetries === 0)).toBe(true);
  });

  it('recognizes verified content in a cumulative handoff without depending on quote formatting', async () => {
    ai.generateText.mockReset().mockResolvedValue({ finishReason: 'stop', text: JSON.stringify({
      ...handoff, evidence: 'a paraphrase of the previous chunk',
    }) });
    expect(await summarizeHistory({ model: 'dummy', previous: handoff, records: 'later housekeeping',
      recordUsage: () => {} })).toEqual(handoff);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
  });

  it('consumes every chunk including the ending before publishing a handoff', async () => {
    ai.generateText.mockReset().mockImplementation(async ({ prompt }: { prompt: string }) => ({
      finishReason: 'stop', text: JSON.stringify({ ...handoff, evidence: prompt.includes('final correction') ? 'final correction' : 'aaaa' }),
    }));
    const recordUsage = vi.fn();
    await summarizeHistory({ model: 'dummy', records: 'a'.repeat(260000) + 'final correction', recordUsage });
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(ai.generateText.mock.calls[1][0].prompt).toContain('let the clock sing twice');
  });
});
