import { describe, expect, it } from 'vitest';
import {
  classifyModelTermination,
  describeModelStreamError,
  resolvePersistedRunStatus,
  shouldStopAfterTerminalToolFailure,
} from '@/lib/agent-terminal';

describe('agent terminal semantics', () => {
  it('accepts an explicit provider stop even when the final step has no new text', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'stop',
      finalStepTextChars: 0,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    })).toEqual({ ok: true, retryable: false });
  });

  it.each(['length', 'error', 'other'] as const)('retries the technical %s termination', (finishReason) => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason,
      finalStepTextChars: 12,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    })).toMatchObject({ ok: false, retryable: true });
  });

  it('keeps nested transport details for the next attempt', () => {
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
    })).toMatchObject({ ok: false, retryable: true, code: 'stream_error', detail });
  });

  it('accepts a clean model final reply without consulting workflow state', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'stop',
      finalStepTextChars: 12,
      finalStepToolCalls: 0,
      finalStepDeliveredArtifact: false,
    })).toEqual({ ok: true, retryable: false });
  });

  it('accepts a completed final tool action and rejects an unfinished tool turn', () => {
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'tool-calls',
      finalStepTextChars: 0,
      finalStepToolCalls: 1,
      finalStepDeliveredArtifact: true,
    })).toEqual({ ok: true, retryable: false });
    expect(classifyModelTermination({
      sawFinish: true,
      finishReason: 'tool-calls',
      finalStepTextChars: 0,
      finalStepToolCalls: 1,
      finalStepDeliveredArtifact: false,
    })).toMatchObject({ ok: false, retryable: true, code: 'unfinished_tool_turn' });
  });

  it('stops only a terminal tool failure, not a repairable tool result', () => {
    expect(shouldStopAfterTerminalToolFailure({
      toolResults: [{
        toolName: 'generate_animation',
        output: { success: false, retryable: false, repairable: true, terminal: false },
      }],
    })).toBe(false);
    expect(shouldStopAfterTerminalToolFailure({
      toolResults: [{
        toolName: 'generate_animation',
        output: { success: false, retryable: false, terminal: true },
      }],
    })).toBe(true);
  });

  it('never persists completed without explicit done evidence', () => {
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: false, sawError: false })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: true })).toBe('failed');
    expect(resolvePersistedRunStatus({ currentStatus: 'running', sawDone: true, sawError: false })).toBe('completed');
    expect(resolvePersistedRunStatus({ currentStatus: 'aborted', sawDone: false, sawError: false })).toBe('aborted');
  });
});
