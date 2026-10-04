import { describe, expect, it } from 'vitest';
import {
  decideAgentRunAdmission,
  formatPendingAgentInputs,
} from '@/lib/agent-run-admission';

describe('Agent Run admission', () => {
  it('appends a new instruction to the active durable Agent Run', () => {
    expect(decideAgentRunAdmission({
      id: 'agent-run-1',
      status: 'running',
      execution_policy: { durable: true },
    })).toEqual({ kind: 'append', runId: 'agent-run-1' });
  });

  it('creates a new Agent Run only when there is no active execution', () => {
    expect(decideAgentRunAdmission(null)).toEqual({ kind: 'create' });
    expect(decideAgentRunAdmission({
      id: 'agent-run-1',
      status: 'completed',
      execution_policy: { durable: true },
    })).toEqual({ kind: 'create' });
  });

  it('does not silently attach to a legacy non-durable worker', () => {
    expect(decideAgentRunAdmission({
      id: 'legacy-run',
      status: 'running',
      execution_policy: {},
    })).toEqual({ kind: 'conflict', runId: 'legacy-run' });
  });

  it('formats queued instructions as inputs to the same execution', () => {
    const prompt = formatPendingAgentInputs([
      { id: 'input-1', content: '把字幕缩短一点' },
      { id: 'input-2', content: '不要重新生成已经完成的素材' },
    ]);
    expect(prompt).toContain('[New instructions received during this Agent Run]');
    expect(prompt).toContain('把字幕缩短一点');
    expect(prompt).toContain('不要重新生成已经完成的素材');
    expect(prompt).toContain('same objective and workflow invocation');
  });
});
