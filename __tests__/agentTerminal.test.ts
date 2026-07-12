import { describe, expect, it } from 'vitest';
import {
  classifyModelTermination,
  describeModelStreamError,
  resolvePersistedRunStatus,
  shouldContinueActiveStudioRun,
  shouldUseTextOnlyRecovery,
} from '@/lib/agent-terminal';

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

  it('keeps nested transport details for durable diagnosis', () => {
    const cause = Object.assign(new Error('socket disconnected before TLS'), { code: 'ECONNRESET' });
    const error = Object.assign(new Error('fetch failed'), { cause });
    const detail = describeModelStreamError(error);
    expect(detail).toContain('fetch failed');
    expect(detail).toContain('ECONNRESET');
    expect(classifyModelTermination({
      sawFinish: false,
      finalStepTextChars: 0,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
      streamError: error,
    }).detail).toBe(detail);
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

  it('keeps tools enabled when delivered images are only intermediate Studio Run assets', () => {
    expect(shouldUseTextOnlyRecovery({ deliveredArtifact: true, activeStudioRun: true })).toBe(false);
    expect(shouldUseTextOnlyRecovery({ deliveredArtifact: true, activeStudioRun: false })).toBe(true);
  });

  it('does not allow a touched running Studio Run to end with a promise to continue later', () => {
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: true,
      studioRunTouched: true,
      runCodeStarted: false,
      recoveryPrompt: false,
    })).toBe(true);
    expect(shouldContinueActiveStudioRun({
      activeStudioRun: false,
      studioRunTouched: true,
      runCodeStarted: true,
      recoveryPrompt: true,
    })).toBe(false);
  });

  it('never persists completed without explicit done evidence', () => {
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: false, sawError: false })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: true })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: false })).toBe('completed');
    expect(resolvePersistedRunStatus({ currentStatus: 'aborted', sawDone: false, sawError: false })).toBe('aborted');
  });
});
