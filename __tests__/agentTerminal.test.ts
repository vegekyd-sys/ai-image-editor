import { describe, expect, it } from 'vitest';
import { classifyModelTermination, resolvePersistedRunStatus } from '@/lib/agent-terminal';

describe('agent terminal semantics', () => {
  it('rejects the exact empty final step that previously became a silent success', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'stop',
      finalStepTextChars: 0,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    })).toMatchObject({ ok: false, retryable: true, code: 'empty_final_step' });
  });

  it.each(['length', 'error', 'other'] as const)('rejects %s even when the provider closes normally', (finishReason) => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason,
      finalStepTextChars: 12,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    }).ok).toBe(false);
  });

  it('accepts a clean final reply or a completed final tool action', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'stop',
      finalStepTextChars: 12,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    }).ok).toBe(true);
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'tool-calls',
      finalStepTextChars: 0,
      finalStepToolCalls: 1,
      finalStepDeliveredArtifact: true,
    }).ok).toBe(true);
  });

  it('does not treat preview/read tools as delivery', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'tool-calls',
      finalStepTextChars: 0,
      finalStepToolCalls: 1,
      finalStepDeliveredArtifact: false,
    })).toMatchObject({ ok: false, code: 'unfinished_tool_turn' });
  });

  it('never persists completed without explicit done evidence', () => {
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: false, sawError: false })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: true })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: false })).toBe('completed');
    expect(resolvePersistedRunStatus({ currentStatus: 'aborted', sawDone: false, sawError: false })).toBe('aborted');
  });
});
