import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  buildTypedCompactionMessage,
  formatDurableExecutionSnapshot,
  getAgentContextPolicy,
  isConfirmedExecutionLeaseLoss,
  isRetryableProviderOutage,
  selectModelHistoryWithinBudget,
  shouldScheduleNextAttempt,
  stableOperationKey,
  tailModelHistoryAtomically,
  type DurableExecutionSnapshot,
} from '../src/lib/agent-execution';

function message(role: 'user' | 'assistant', content: string): ModelMessage {
  return { role, content } as ModelMessage;
}

describe('durable Agent execution', () => {
  it('uses the shared 1M context policy for every Agent provider', () => {
    for (const modelId of ['sonnet-4.6', 'sonnet-5', 'opus-4.8', 'grok-4.5', 'deepseek-v4-pro']) {
      const policy = getAgentContextPolicy(modelId);
      expect(policy.contextWindowTokens).toBe(1_000_000);
      expect(policy.historySoftLimitTokens).toBeGreaterThanOrEqual(400_000);
      expect(policy.providerCompactAtTokens).toBeLessThan(800_000);
      expect(policy.historySoftLimitTokens).toBeLessThan(policy.providerCompactAtTokens);
    }
  });

  it('keeps all useful history while it fits and trims atomically when it does not', () => {
    const toolCall = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'a.md' } }],
    } as ModelMessage;
    const toolResult = {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read_file', output: { type: 'text', value: 'x'.repeat(20_000) } }],
    } as ModelMessage;
    const messages = [message('user', 'original'), toolCall, toolResult, ...Array.from({ length: 30 }, (_, i) => message(i % 2 ? 'assistant' : 'user', `turn-${i}-${'y'.repeat(3_000)}`))];
    const selected = selectModelHistoryWithinBudget({
      messages,
      policy: {
        contextWindowTokens: 50_000,
        historySoftLimitTokens: 12_000,
        providerClearToolUsesAtTokens: 20_000,
        providerCompactAtTokens: 30_000,
      },
    });

    expect(selected.stats.droppedMessages).toBeGreaterThan(0);
    expect(selected.stats.estimatedTokens).toBeLessThanOrEqual(selected.stats.availableTokens);
    const roles = selected.messages.map(item => item.role);
    expect(roles[0]).not.toBe('tool');
    expect(roles.includes('tool')).toBe(false);
  });

  it('preserves objective, decisions, artifacts and next action in a typed handoff', () => {
    const snapshot: DurableExecutionSnapshot = {
      version: 1,
      objective: '制作一条 Makaron 视频',
      acceptanceCriteria: ['有声音', '明确讲到 Makaron'],
      decisions: ['保留原始 Composition 指导'],
      completedWork: ['故事板已批准'],
      artifacts: [{ kind: 'storyboard', path: 'studio/storyboard.json' }],
      openQuestions: [],
      currentWorkUnit: 'composition',
      nextAction: '先写可编译 scaffold',
    };
    const handoff = formatDurableExecutionSnapshot(snapshot);
    expect(handoff).toContain(snapshot.objective);
    expect(handoff).toContain('保留原始 Composition 指导');
    expect(handoff).toContain('studio/storyboard.json');
    expect(handoff).toContain('先写可编译 scaffold');
  });

  it('round-trips provider compaction as an Anthropic typed block', () => {
    const snapshot: DurableExecutionSnapshot = {
      version: 1,
      objective: 'long task',
      acceptanceCriteria: [],
      decisions: [],
      completedWork: [],
      artifacts: [],
      openQuestions: [],
      currentWorkUnit: 'compose',
      nextAction: 'continue',
      providerCompaction: {
        summary: 'The compacted execution state.',
        appliedEdits: [{ type: 'compact_20260112' }],
      },
    };
    const message = buildTypedCompactionMessage(snapshot);
    expect(message?.role).toBe('assistant');
    expect(JSON.stringify(message)).toContain('\"type\":\"compaction\"');
    expect(JSON.stringify(message)).toContain('The compacted execution state.');
  });

  it('makes expensive operation keys stable across attempts', () => {
    const first = stableOperationKey('assets', 'generate_image', { prompt: 'hero', width: 1280 });
    const reordered = stableOperationKey('assets', 'generate_image', { width: 1280, prompt: 'hero' });
    const differentUnit = stableOperationKey('review', 'generate_image', { prompt: 'hero', width: 1280 });
    expect(first).toBe(reordered);
    expect(first).not.toBe(differentUnit);
  });

  it('continues retryable and killed attempts but respects terminal and attempt budget', () => {
    expect(shouldScheduleNextAttempt({ executionStatus: 'running', attemptNo: 3, terminal: 'retryable' })).toBe(true);
    expect(shouldScheduleNextAttempt({ executionStatus: 'running', attemptNo: 3, terminal: 'killed' })).toBe(true);
    expect(shouldScheduleNextAttempt({ executionStatus: 'running', attemptNo: 3, terminal: 'completed' })).toBe(false);
    expect(shouldScheduleNextAttempt({ executionStatus: 'running', attemptNo: 40, terminal: 'retryable' })).toBe(false);
  });

  it('only aborts an attempt after lease loss is positively confirmed', () => {
    const expectedLeaseToken = 'lease-a';
    expect(isConfirmedExecutionLeaseLoss({
      renewSucceeded: false,
      renewError: new Error('transient network failure'),
      expectedLeaseToken,
    })).toBe(false);
    expect(isConfirmedExecutionLeaseLoss({
      renewSucceeded: false,
      state: { status: 'running', lease_token: expectedLeaseToken },
      expectedLeaseToken,
    })).toBe(false);
    expect(isConfirmedExecutionLeaseLoss({
      renewSucceeded: false,
      state: { status: 'running', lease_token: 'lease-b' },
      expectedLeaseToken,
    })).toBe(true);
    expect(isConfirmedExecutionLeaseLoss({
      renewSucceeded: false,
      state: { status: 'aborted', lease_token: null },
      expectedLeaseToken,
    })).toBe(true);
  });

  it('recognizes provider infrastructure outages without treating ordinary model errors as outages', () => {
    expect(isRetryableProviderOutage('Bedrock is unable to process your request. status=503')).toBe(true);
    expect(isRetryableProviderOutage('ServiceUnavailableException')).toBe(true);
    expect(isRetryableProviderOutage('ECONNRESET before secure TLS connection was established')).toBe(true);
    expect(isRetryableProviderOutage('The composition failed to compile')).toBe(false);
  });

  it('keeps a compact continuation tail without splitting tool call/result pairs', () => {
    const toolCall = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-tail', toolName: 'run_code', input: {} }],
    } as ModelMessage;
    const toolResult = {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call-tail', toolName: 'run_code', output: { type: 'text', value: 'saved' } }],
    } as ModelMessage;
    const history = [
      ...Array.from({ length: 12 }, (_, index) => message(index % 2 ? 'assistant' : 'user', `old-${index}`)),
      toolCall,
      toolResult,
      message('assistant', 'latest'),
    ];

    const tail = tailModelHistoryAtomically(history, 4);

    expect(tail.length).toBeLessThanOrEqual(4);
    const toolCallIndex = tail.indexOf(toolCall);
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(tail[toolCallIndex + 1]).toBe(toolResult);
    expect(tail.at(-1)).toMatchObject({ role: 'assistant', content: 'latest' });
  });
});
