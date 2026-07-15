import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentSource = readFileSync(join(process.cwd(), 'src/lib/agent.ts'), 'utf8');
const sseRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/route.ts'), 'utf8');
const headlessRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/run/route.ts'), 'utf8');
const runStatusRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/run/[id]/route.ts'), 'utf8');

describe('agent terminal contract wiring', () => {
  it('gates done on model termination and retries one stalled step from the saved draft', () => {
    expect(agentSource).toContain('classifyModelTermination({');
    expect(agentSource).toContain('timeout: { stepMs: stepTimeoutMs, totalMs: remainingInvocationBudgetMs }');
    expect(agentSource).toContain('720_000 - (Date.now() - agentStartTime)');
    expect(agentSource).toContain('recoveryAttempt < 1');
    expect(agentSource).toContain("toolChoice: 'none' as const");
    expect(agentSource).toContain('recoveryBlockedTools.add(toolName)');
    expect(agentSource).toContain("if (event.type === 'finish')");
    expect(agentSource).toContain('recordStepUsage(event)');
    const finishStepBlock = agentSource.slice(
      agentSource.indexOf("if (event.type === 'finish-step')"),
      agentSource.indexOf("if (event.type === 'finish')"),
    );
    expect(finishStepBlock).not.toContain('sawFinish = true');
    expect(agentSource).toContain('The exact saved draft path is:');
    expect(agentSource.indexOf('if (assessment.ok) break;')).toBeLessThan(agentSource.indexOf("yield { type: 'done' }"));
  });

  it('requires explicit done evidence in both persisted run routes', () => {
    for (const source of [sseRouteSource, headlessRouteSource]) {
      expect(source).toContain('resolvePersistedRunStatus({');
      expect(source).toContain("if (event.type === 'done') sawDone = true;");
      expect(source).toContain("if (event.type === 'error')");
      expect(source).toContain('missing_terminal_event');
      expect(source).toContain(".eq('status', 'running')");
    }
  });

  it('uses durable heartbeats and an abort signal for superseded runs', () => {
    expect(agentSource).toContain('abortSignal: options.abortSignal');
    for (const source of [sseRouteSource, headlessRouteSource]) {
      expect(source).toContain('persistHeartbeat()');
      expect(source).toContain('modelAbortController.signal');
      expect(source).toContain("data?.status !== 'running'");
    }
    expect(runStatusRouteSource).toContain('stale_run_lease_expired');
    expect(runStatusRouteSource).toContain(".eq('tool_name', 'write_file')");
    expect(runStatusRouteSource).toContain(".eq('status', 'running')");
  });
});
