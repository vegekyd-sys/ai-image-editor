import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  buildTypedCompactionMessage,
  formatDurableExecutionSnapshot,
  getAgentContextPolicy,
  isConfirmedExecutionLeaseLoss,
  isRetryableProviderOutage,
  resolveExecutionHandoffWorkUnit,
  selectModelHistoryWithinBudget,
  shouldScheduleNextAttempt,
  stableOperationKey,
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

  it('reports compaction pressure without silently trimming history', () => {
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

    expect(selected.messages).toEqual(messages);
    expect(selected.stats.droppedMessages).toBe(0);
    expect(selected.stats.selectedMessages).toBe(messages.length);
    expect(selected.stats.estimatedTokens).toBeGreaterThan(selected.stats.availableTokens);
    expect(selected.stats.compactionRequired).toBe(true);
  });

  it('uses the provider compaction threshold instead of the former trim limit', () => {
    const messages = [message('user', 'x'.repeat(60_000)), message('assistant', 'done')];
    const selected = selectModelHistoryWithinBudget({
      messages,
      policy: {
        contextWindowTokens: 100_000,
        historySoftLimitTokens: 5_000,
        providerClearToolUsesAtTokens: 40_000,
        providerCompactAtTokens: 80_000,
      },
    });

    expect(selected.messages).toEqual(messages);
    expect(selected.stats.estimatedTokens).toBeGreaterThan(5_000);
    expect(selected.stats.compactionRequired).toBe(false);
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

  it('records the persisted Studio stage as the next durable work unit', () => {
    expect(resolveExecutionHandoffWorkUnit('studio:assets', {
      studioRunStage: 'composition',
    })).toBe('studio:composition');
    expect(resolveExecutionHandoffWorkUnit('agent', {})).toBe('agent');
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

  it('does not replay a legacy compaction block into a different model', () => {
    const snapshot: DurableExecutionSnapshot = {
      version: 1,
      objective: 'long task',
      acceptanceCriteria: [],
      decisions: [],
      completedWork: [],
      artifacts: [],
      openQuestions: [],
      currentWorkUnit: 'agent',
      nextAction: 'continue',
      providerCompaction: {
        provider: 'anthropic',
        modelId: 'retired-sonnet',
        summary: 'provider-specific compacted state',
      },
    };

    expect(buildTypedCompactionMessage(snapshot, 'gpt-5.6-sol')).toBeNull();
  });

  it('replays an OpenAI compaction item only on its originating model', () => {
    const snapshot: DurableExecutionSnapshot = {
      version: 1,
      objective: 'long task',
      acceptanceCriteria: [],
      decisions: [],
      completedWork: [],
      artifacts: [],
      openQuestions: [],
      currentWorkUnit: 'agent',
      nextAction: 'continue',
      providerCompaction: {
        provider: 'openai',
        modelId: 'gpt-5.6-sol',
        compactedThrough: '2026-07-18T00:00:00.000Z',
        item: {
          kind: 'openai.compaction',
          providerKey: 'azure',
          itemId: 'cmp-1',
          encryptedContent: 'encrypted-context',
        },
      },
    };

    const matching = buildTypedCompactionMessage(snapshot, 'gpt-5.6-sol');
    expect(JSON.stringify(matching)).toContain('openai.compaction');
    expect(JSON.stringify(matching)).toContain('encrypted-context');
    expect(buildTypedCompactionMessage(snapshot, 'gpt-5.6-terra')).toBeNull();
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
    expect(isRetryableProviderOutage('TimeoutError: Step timeout of 150000ms exceeded')).toBe(true);
    expect(isRetryableProviderOutage('The composition failed to compile')).toBe(false);
  });

});
