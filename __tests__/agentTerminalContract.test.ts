import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAgentContractSource } from './helpers/agentRuntimeSource';

const agentSource = readAgentContractSource(process.cwd(), 'src/lib/agent.ts');
const agentModelRuntimeSource = readFileSync(join(process.cwd(), 'src/lib/agent-model-runtime.ts'), 'utf8');
const agentStreamSource = readFileSync(join(process.cwd(), 'src/lib/agentStream.ts'), 'utf8');
const agentContextSource = readFileSync(join(process.cwd(), 'src/lib/agent-context.ts'), 'utf8');
const sseRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/route.ts'), 'utf8');
const headlessRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/run/route.ts'), 'utf8');
const runStatusRouteSource = readFileSync(join(process.cwd(), 'src/app/api/agent/run/[id]/route.ts'), 'utf8');
const executionRunnerSource = readFileSync(join(process.cwd(), 'src/lib/agent-execution-runner.ts'), 'utf8');
const executionDispatchSource = readFileSync(join(process.cwd(), 'src/lib/agent-execution-dispatch.ts'), 'utf8');

describe('agent terminal contract wiring', () => {
  it('gates done only on model termination and technical handoff boundaries', () => {
    expect(agentSource).toContain('classifyModelTermination({');
    expect(agentSource).toContain('chunkMs: streamIdleTimeoutMs');
    expect(agentSource).not.toContain('toolMs: Math.min(900_000, remainingInvocationBudgetMs)');
    expect(agentSource).not.toContain('totalMs: remainingInvocationBudgetMs');
    expect(agentSource).not.toContain('stepMs: stepTimeoutMs');
    expect(agentSource).toContain("options?.execution ? { maxRetries: 0 } : {}");
    expect(agentSource).toContain('const invocationDeadline = agentStartTime + invocationBudgetMs');
    expect(agentSource).toContain('attemptBudgetReached = true');
    expect(agentSource).toContain("code: 'attempt_budget_handoff'");
    expect(agentSource).toContain('options?.attemptBudgetMs');
    expect(agentSource).toContain('recoveryAttempt < 1');
    expect(agentSource).toContain("toolChoice: 'none' as const");
    expect(agentSource).toContain('wrapDurableInputAwareTools(');
    expect(agentSource).toContain('function createPublishDraftTool(');
    expect(agentSource).toContain('workspace.readFile(design_path');
    expect(agentSource).toContain('Studio draft promotion requires a completed Composition artifact');
    expect(agentSource).toContain('compositionArtifact.designPath !== design_path');
    expect(agentSource).toContain("'publish_draft',");
    expect(agentSource).toContain('sourceDesignPath');
    expect(agentSource).toContain("currentInputVersion > ctx.execution!.inputEpoch");
    expect(agentSource).toContain("errorCode: 'agent_input_received'");
    expect(agentSource).toContain('A Studio Run is only a persisted workflow');
    expect(agentSource).not.toContain('requestsMaterializedVideo');
    expect(agentSource).not.toContain('requestsStudioRunCompletion');
    expect(agentSource).not.toContain('shouldContinueActiveStudioRun');
    expect(agentSource).not.toContain('shouldCompleteDurableStudioRun');
    expect(agentSource).not.toContain('shouldHandoffToStudioComposition');
    expect(agentSource).not.toContain("code: 'studio_stage_handoff'");
    expect(agentSource).toContain('const durableContinuation = Boolean(options?.execution && options.execution.attemptNo > 1)');
    expect(agentSource).toContain('if (!durableContinuation) delete (allTools as Record<string, unknown>).execution_checkpoint');
    expect(agentSource).not.toContain("code: 'studio_run_incomplete'");
    expect(agentSource).not.toContain("code: 'skill_video_submission_pending'");
    expect(agentSource).toContain("run.status !== 'running'");
    expect(agentSource).toContain('recoveryBlockedTools.add(toolName)');
    expect(agentSource).toContain("if (event.type === 'finish')");
    expect(agentSource).toContain('recordStepUsage(event)');
    const finishStepBlock = agentSource.slice(
      agentSource.indexOf("if (event.type === 'finish-step')"),
      agentSource.indexOf("if (event.type === 'finish')"),
    );
    expect(finishStepBlock).not.toContain('sawFinish = true');
    expect(finishStepBlock).not.toContain('durableStageHandoff');
    expect(agentSource).not.toContain('shouldStopAfterDurablePublishToolStep({');
    expect(agentSource).not.toContain('shouldStopAfterStudioToolStep({');
    expect(agentSource).not.toContain('shouldStopAfterAsyncVideoSubmission({');
    expect(agentSource).toContain('submit them one at a time');
    expect(agentSource).toContain("do not wait for that video's rendering to finish");
    expect(agentSource).not.toContain('same assistant tool turn');
    expect(agentSource).toContain('serializeVideoSubmission(async () => {');
    expect(agentSource).toContain('await previousSubmission');
    expect(agentSource).toContain('The exact saved draft path is:');
    expect(agentSource).toContain('__lastSavedDraftPath = autosave.path');
    expect(agentSource).toContain('getStudioRunCheckpoint(ctx)');
    expect(agentSource).toContain('checkpoint.streamedCodePath');
    expect(agentSource).toContain('checkpoint.compositionPartPaths?.length');
    expect(agentStreamSource).not.toContain('MAX_STUDIO_RUN_AUTO_RESUMES');
    expect(agentStreamSource).not.toContain('buildStudioRunAutoResumePrompt');
    expect(agentSource).toContain('streamed-${codeExtractor.toolName}-${targetSlug}.partial.js');
    expect(agentSource).toContain('persistStreamedCodeCheckpoint(true)');
    expect(agentSource).toContain('function createWriteCodeFileTool(');
    expect(agentSource).toContain('Composition files may be natural Remotion modules');
    expect(agentSource).toContain('natural JS/TS/JSX/TSX Remotion module');
    expect(agentSource).toContain("code_path: z.string().optional()");
    expect(agentSource).toContain('workspace.readFile(code_path');
    expect(agentSource).toContain("toolName === 'run_code' || toolName === 'write_code_file' || toolName === 'write_file'");
    expect(agentSource).not.toContain('under 9000 source characters');
    expect(agentSource).toContain('never begin a monolithic run_code payload');
    expect(agentSource).toContain('hard transport limit of 12000 source characters');
    expect(agentSource).toContain('no aggregate source-size or part-count limit');
    expect(agentSource).toContain('Never shorten approved narration, subtitles, scenes, animation, or visual detail');
    expect(agentSource).toContain('compositionWorkspace.status="ready"');
    expect(agentSource).toContain('Non-blocking editable advisories do not invalidate a ready draft');
    expect(agentSource).toContain('Do not call run_code merely to assemble files');
    expect(agentSource).toContain('Split the content across new numbered files');
    expect(agentSource).toContain('providerOptions: getAgentProviderOptions(runtime, {');
    expect(agentSource).toContain('Boolean(options?.execution)');
    expect(agentSource).toContain('durableVisionBridge');
    expect(agentSource).toContain('Visual QA for contact sheet frames');
    expect(agentModelRuntimeSource).toContain('promptCacheKey: runtime.promptCacheKey');
    expect(agentModelRuntimeSource).toContain("ttl: '30m'");
    expect(agentSource).toContain("return { designPath: input.design_path };");
    expect(agentSource).toContain('if (toolName) lastTool = toolName');
    expect(agentContextSource).not.toContain('activeStudioContinuation');
    expect(agentContextSource).toContain('run.agentRunId === activeAgentRunId');
    expect(agentContextSource).toContain('[Active Studio workflow in this Agent Run]');
    expect(agentContextSource).toContain('selectModelHistoryWithinBudget');
    expect(agentContextSource).toContain('buildTypedCompactionMessage');
    expect(agentContextSource).toContain('projectCompactionPromise');
    expect(agentContextSource).not.toContain('tailModelHistoryAtomically(rebuiltHistory, 16)');
    expect(agentSource.indexOf('if (assessment.ok) break;')).toBeLessThan(agentSource.indexOf("yield { type: 'done' }"));
    expect(executionRunnerSource).toContain('runAgentExecutionAttempt');
    expect(executionRunnerSource).toContain("const workUnit = 'agent'");
    expect(executionRunnerSource).toContain('studioWorkflowStage: activeStudioWorkflowStage');
    expect(executionRunnerSource).not.toContain('return `studio:${studioRun.currentStage}`');
    expect(executionRunnerSource).toContain('inputEpoch: inputVersionAtAttemptStart');
    expect(executionRunnerSource).toContain("status: 'handed_off'");
    expect(executionRunnerSource).toContain('next_attempt_at: new Date().toISOString()');
    expect(executionRunnerSource).toContain('shouldFailoverAzureGPT56ToOpenRouter');
    expect(executionRunnerSource).toContain('shouldFailoverCodexSubscriptionToApi');
    expect(executionRunnerSource).toContain('isSafeToEnterSubscriptionApiFallback');
    expect(executionRunnerSource).toContain('shouldFailoverGrokSubscriptionToApi');
    expect(executionRunnerSource).toContain("fallbackSafety: 'pending'");
    expect(executionRunnerSource).toContain('attemptSafetyMetadata()');
    expect(executionRunnerSource).toContain('attemptMetadataError');
    expect(executionRunnerSource).toContain('.limit(policy.maxAttempts)');
    expect(executionRunnerSource).toContain('resolveAgentModelSpec(requestedModel.id, undefined, failoverProvider)');
    expect(executionRunnerSource).toContain('agentProvider: resolvedModel.provider');
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

  it('uses durable heartbeats and an abort signal for terminal runs', () => {
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

  it('appends mid-run instructions instead of superseding the Agent Run', () => {
    for (const source of [sseRouteSource, headlessRouteSource]) {
      expect(source).toContain('decideAgentRunAdmission');
      expect(source).toContain('appendAgentRunInput');
      expect(source).not.toContain('Supersede any prior run');
    }
    expect(executionRunnerSource).toContain('loadPendingAgentInputs');
    expect(executionRunnerSource).toContain("code: 'agent_input_received'");
    expect(executionRunnerSource).toContain(".eq('input_version', inputVersionAtAttemptStart)");
  });

  it('gives each durable attempt enough steps to finish a composed video QA pass', () => {
    expect(headlessRouteSource).toContain('attemptMaxSteps: DEFAULT_ATTEMPT_MAX_STEPS');
    expect(headlessRouteSource).toContain('attemptBudgetMs: DEFAULT_ATTEMPT_BUDGET_MS');
    expect(headlessRouteSource).toContain('leaseSeconds: DEFAULT_ATTEMPT_LEASE_SECONDS');
    expect(headlessRouteSource.indexOf('return NextResponse.json({\n        runId,\n        executionId: runId'))
      .toBeLessThan(headlessRouteSource.indexOf('const ctx = await buildPromptContext'));
  });
});
