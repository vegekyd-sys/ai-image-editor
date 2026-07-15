import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentSource = readFileSync(join(process.cwd(), 'src/lib/agent.ts'), 'utf8');
const agentStreamSource = readFileSync(join(process.cwd(), 'src/lib/agentStream.ts'), 'utf8');
const agentContextSource = readFileSync(join(process.cwd(), 'src/lib/agent-context.ts'), 'utf8');
const sseRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/route.ts'), 'utf8');
const headlessRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/run/route.ts'), 'utf8');
const runStatusRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/run/[id]/route.ts'), 'utf8');
const executionRunnerSource = readFileSync(join(process.cwd(), 'src/lib/agent-execution-runner.ts'), 'utf8');
const executionDispatchSource = readFileSync(join(process.cwd(), 'src/lib/agent-execution-dispatch.ts'), 'utf8');

describe('agent terminal contract wiring', () => {
  it('gates done on model termination and retries one stalled step from the saved draft', () => {
    expect(agentSource).toContain('classifyModelTermination({');
    expect(agentSource).toContain('timeout: { stepMs: stepTimeoutMs, totalMs: remainingInvocationBudgetMs }');
    expect(agentSource).toContain("options?.execution ? { maxRetries: 0 } : {}");
    expect(agentSource).toContain('invocationBudgetMs - (Date.now() - agentStartTime)');
    expect(agentSource).toContain('options?.attemptBudgetMs');
    expect(agentSource).toContain('recoveryAttempt < 1');
    expect(agentSource).toContain("toolChoice: 'none' as const");
    expect(agentSource).toContain('shouldUseTextOnlyRecovery({');
    expect(agentSource).toContain('shouldContinueActiveStudioRun({');
    expect(agentSource).toContain('shouldCompleteDurableStudioRun({');
    expect(agentSource).toContain('shouldHandoffToStudioComposition({');
    expect(agentSource).toContain("code: 'studio_stage_handoff'");
    expect(agentSource).toContain('&& !durableStageHandoff');
    expect(agentSource).toContain('&& !options?.execution');
    expect(agentSource).toContain("code: 'studio_run_incomplete'");
    expect(agentSource).toContain("run.status !== 'running'");
    expect(agentSource).toContain('recoveryBlockedTools.add(toolName)');
    expect(agentSource).toContain("if (event.type === 'finish')");
    expect(agentSource).toContain('recordStepUsage(event)');
    const finishStepBlock = agentSource.slice(
      agentSource.indexOf("if (event.type === 'finish-step')"),
      agentSource.indexOf("if (event.type === 'finish')"),
    );
    expect(finishStepBlock).not.toContain('sawFinish = true');
    expect(finishStepBlock).toContain('if (durableStageHandoff || durableStudioCompletion) break;');
    expect(agentSource).toContain('The exact saved draft path is:');
    expect(agentSource).toContain('__lastSavedDraftPath = autosave.path');
    expect(agentSource).toContain('getStudioRunCheckpoint(ctx)');
    expect(agentSource).toContain('checkpoint.draftPath || checkpoint.studioRunId');
    expect(agentStreamSource).toContain('MAX_STUDIO_RUN_AUTO_RESUMES = 2');
    expect(agentStreamSource).toContain('buildStudioRunAutoResumePrompt(recoveryEvent)');
    expect(agentSource).toContain('streamed-run-code.partial.js');
    expect(agentSource).toContain('persistStreamedCodeCheckpoint(true)');
    expect(agentSource).not.toContain('under 9000 source characters');
    expect(agentSource).toContain('never begin a monolithic run_code payload');
    expect(agentSource).toContain('hard transport limit of 12000 source characters');
    expect(agentSource).toContain('no aggregate source-size or part-count limit');
    expect(agentSource).toContain('Never shorten approved narration, subtitles, scenes, animation, or visual detail');
    expect(agentSource).toContain('composition_parts.directory');
    expect(agentSource).toContain('Split the content across new numbered files');
    expect(agentSource).toContain("? effort : 'medium'");
    expect(agentSource).toContain("keep: { type: 'tool_uses', value: 24 }");
    expect(agentSource).toContain('if (toolName) lastTool = toolName');
    expect(agentContextSource).toContain('activeStudioContinuation');
    expect(agentContextSource).toContain('[Active Studio Run]');
    expect(agentContextSource).toContain('selectModelHistoryWithinBudget');
    expect(agentContextSource).toContain('buildTypedCompactionMessage');
    expect(agentSource.indexOf('if (assessment.ok) break;')).toBeLessThan(agentSource.indexOf("yield { type: 'done' }"));
    expect(executionRunnerSource).toContain('runAgentExecutionAttempt');
    expect(executionRunnerSource).toContain("status: 'handed_off'");
    expect(executionRunnerSource).toContain('next_attempt_at: new Date().toISOString()');
    expect(executionRunnerSource).toContain("? 'deepseek-v4-pro'");
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
    expect(runStatusRouteSource).toContain("runner's claim RPC is the single");
    expect(runStatusRouteSource).toContain('dispatchAgentExecutionAttempt(runId, req.nextUrl.origin)');
    expect(runStatusRouteSource).not.toContain("import('@/lib/agent-execution-runner')");
    expect(executionDispatchSource).toContain("/api/agent/execution/${runId}");
    expect(executionRunnerSource).toContain("terminal_code: 'lease_expired'");
    expect(executionRunnerSource).toContain(".eq('id', attemptId).eq('status', 'running')");
  });
});
