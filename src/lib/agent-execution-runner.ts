import type { SupabaseClient } from '@supabase/supabase-js';
import { runMakaronAgent, type AgentStreamEvent } from './agent';
import { AgentDualWriter } from './agentDualWriter';
import { buildPromptContext } from './agent-context';
import { getSupabaseAdmin } from './supabase/service';
import { deductByTokens } from './billing/credits';
import { resolveAgentModelSpec, type AgentModelPreference } from './agent-models';
import {
  AgentExecutionStore,
  buildRecoverablePreflightInstruction,
  countConsecutiveRetryableProviderFailures,
  DEFAULT_ATTEMPT_BUDGET_MS,
  DEFAULT_ATTEMPT_LEASE_SECONDS,
  DEFAULT_ATTEMPT_MAX_STEPS,
  DEFAULT_MAX_ATTEMPTS,
  getAgentContextPolicy,
  isConfirmedExecutionLeaseLoss,
  MAX_SAME_PROVIDER_ATTEMPTS,
  normalizeExecutionSnapshot,
  shouldScheduleNextAttempt,
  type DurableExecutionSnapshot,
  type ExecutionLeaseState,
} from './agent-execution';
import { dispatchAgentExecutionAttempt } from './agent-execution-dispatch';
import type { SkillLaunchContext } from './skill-launch-context';
import { normalizeLocale, translate } from './locales';
import {
  formatPendingAgentInputs,
  loadPendingAgentInputs,
  markAgentRunInputsApplied,
} from './agent-run-admission';

interface ExecutionRequest {
  locale?: string;
  preferredModel?: string;
  requestedAgentModel?: AgentModelPreference;
  videoModel?: string;
  videoResolution?: import('@/types').VideoResolution;
  videoAuto?: boolean;
  skillLaunchContext?: SkillLaunchContext;
  currentSnapshotIndex?: number;
  hasAnnotation?: boolean;
  isDraft?: boolean;
  referenceImageCount?: number;
  uploadedVideoCount?: number;
  turnMediaCount?: number;
  isNsfw?: boolean;
  audioAttachments?: Array<{ audioUrl: string; title?: string; duration?: number; trackIndex?: number }>;
  origin?: string;
}

interface ExecutionPolicy {
  durable: true;
  attemptBudgetMs: number;
  attemptMaxSteps: number;
  leaseSeconds: number;
  maxAttempts: number;
  maxTotalInputTokens: number;
}

interface AgentRunRecord {
  id: string;
  project_id: string;
  user_id: string;
  status: string;
  objective?: string | null;
  prompt?: string | null;
  acceptance_criteria?: unknown;
  execution_policy?: unknown;
  attempt_count?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  input_version?: number;
  metadata?: Record<string, unknown> | null;
}

interface ClaimedExecution {
  run_id: string;
  lease_token: string;
  attempt_no: number;
  user_id: string;
  project_id: string;
  objective: string;
  acceptance_criteria: unknown;
  execution_policy: unknown;
  metadata: Record<string, unknown> | null;
}

export interface AgentAttemptResult {
  claimed: boolean;
  runId: string;
  attemptId?: string;
  attemptNo?: number;
  status?: 'completed' | 'handed_off' | 'failed' | 'aborted';
  terminalCode?: string;
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function readExecutionLeaseState(
  admin: SupabaseClient,
  runId: string,
  attempts = 2,
): Promise<{ state: ExecutionLeaseState | null; error?: unknown }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { data, error } = await admin
        .from('agent_runs')
        .select('status, lease_token')
        .eq('id', runId)
        .maybeSingle();
      if (!error && data) return { state: data as ExecutionLeaseState };
      lastError = error || new Error(`Agent execution ${runId} was not returned`);
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) await wait(150 * (attempt + 1));
  }
  return { state: null, error: lastError };
}

async function renewExecutionLease(input: {
  admin: SupabaseClient;
  runId: string;
  leaseToken: string;
  leaseSeconds: number;
}): Promise<boolean> {
  let renewError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const leaseUntil = new Date(Date.now() + input.leaseSeconds * 1000).toISOString();
      const { data, error } = await input.admin
        .from('agent_runs')
        .update({ lease_expires_at: leaseUntil })
        .eq('id', input.runId)
        .eq('status', 'running')
        .eq('lease_token', input.leaseToken)
        .select('id')
        .maybeSingle();
      if (!error && data) return true;
      renewError = error;
    } catch (error) {
      renewError = error;
    }
    if (attempt === 0) await wait(150);
  }

  const verification = await readExecutionLeaseState(input.admin, input.runId);
  const lost = isConfirmedExecutionLeaseLoss({
    renewSucceeded: false,
    renewError: undefined,
    verifyError: verification.error,
    state: verification.state,
    expectedLeaseToken: input.leaseToken,
  });
  if (lost) {
    console.warn(`[agent-execution] confirmed lease loss for ${input.runId}`);
    return false;
  }

  console.warn('[agent-execution] lease renewal was inconclusive; keeping the active attempt alive', renewError || verification.error);
  return true;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}

export function normalizeExecutionPolicy(value: unknown): ExecutionPolicy {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    durable: true,
    attemptBudgetMs: numberInRange(record.attemptBudgetMs, DEFAULT_ATTEMPT_BUDGET_MS, 60_000, 1_500_000),
    attemptMaxSteps: numberInRange(record.attemptMaxSteps, DEFAULT_ATTEMPT_MAX_STEPS, 1, 60),
    leaseSeconds: numberInRange(record.leaseSeconds, DEFAULT_ATTEMPT_LEASE_SECONDS, 60, 1_800),
    maxAttempts: numberInRange(record.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 100),
    maxTotalInputTokens: numberInRange(record.maxTotalInputTokens, 12_000_000, 100_000, 50_000_000),
  };
}

async function resolveActiveStudioWorkflowStage(
  admin: SupabaseClient,
  run: AgentRunRecord,
): Promise<string | undefined> {
  try {
    const { WorkspaceStudioRunStore } = await import('./studio-run');
    const store = new WorkspaceStudioRunStore(admin, run.user_id);
    const studioRun = (await store.listRuns(run.project_id)).find(item => (
      item.agentRunId === run.id && item.status === 'running'
    ));
    return studioRun?.currentStage || undefined;
  } catch { /* generic executions do not need Studio state */ }
  return undefined;
}

function artifactPointers(checkpoint: Record<string, unknown> | undefined) {
  if (!checkpoint) return [];
  const values = [
    ['composition_draft', checkpoint.draftPath],
    ['streamed_code', checkpoint.streamedCodePath],
    ['studio_state', checkpoint.studioRunStatePath],
    ['preview', checkpoint.previewUrl],
  ] as const;
  const scalarPointers = values.flatMap(([kind, value]) => typeof value === 'string' && value
    ? [{ kind, ...(value.startsWith('http') ? { url: value } : { path: value }) }]
    : []);
  const compositionParts = Array.isArray(checkpoint.compositionPartPaths)
    ? checkpoint.compositionPartPaths.filter((value): value is string => typeof value === 'string')
    : [];
  return [
    ...scalarPointers,
    ...compositionParts.map(path => ({ kind: 'composition_part', path })),
  ];
}

async function buildHandoffSnapshot(input: {
  store: AgentExecutionStore;
  run: AgentRunRecord;
  claim: ClaimedExecution;
  terminal?: Extract<AgentStreamEvent, { type: 'error' }> | null;
  attemptText: string;
  providerCompaction?: DurableExecutionSnapshot['providerCompaction'];
}): Promise<DurableExecutionSnapshot> {
  const previous = await input.store.latestSnapshot(input.run.id);
  const checkpoint = input.terminal?.checkpoint as Record<string, unknown> | undefined;
  const acceptanceCriteria = Array.isArray(input.run.acceptance_criteria)
    ? input.run.acceptance_criteria.filter((item): item is string => typeof item === 'string')
    : previous?.acceptanceCriteria ?? [];
  const nextAction = checkpoint?.studioRunStage === 'composition' && checkpoint?.draftPath
    ? `Resume Studio Run at composition from ${checkpoint.draftPath}. Inspect the persisted draft before deciding the next action. If it carries __makaronScaffold: true or the numbered composition workspace is not ready, continue the existing parts until write_file reports compositionWorkspace.status="ready"; use its designPath directly and never submit the structural scaffold. If it is a complete non-scaffold draft with persisted Draft Gate evidence, reuse that exact evidence and call studio_run put_artifact without repeating valid generation, preview, or publish work.`
    : checkpoint?.studioRunStage
      ? `Resume Studio Run at ${checkpoint.studioRunStage}; load its persisted stage artifacts and complete that stage.`
    : checkpoint?.draftPath
      ? `Resume from ${checkpoint.draftPath} and complete the pending modification.`
      : previous?.nextAction || 'Continue the unfinished objective from durable artifacts and avoid repeated side effects.';
  const attemptSummary = input.attemptText.trim().slice(-12_000);
  return normalizeExecutionSnapshot({
    objective: input.run.objective || input.claim.objective || input.run.prompt || previous?.objective,
    acceptanceCriteria,
    decisions: previous?.decisions,
    completedWork: previous?.completedWork,
    artifacts: [
      ...(previous?.artifacts ?? []),
      ...artifactPointers(checkpoint),
    ],
    openQuestions: previous?.openQuestions,
    currentWorkUnit: 'agent',
    nextAction,
    attemptSummary: attemptSummary || previous?.attemptSummary,
    checkpoint,
    providerCompaction: input.providerCompaction || previous?.providerCompaction,
  }, {
    objective: input.run.objective || input.claim.objective || input.run.prompt || 'Complete the requested Agent task.',
    currentWorkUnit: 'agent',
    nextAction,
  });
}

async function finishAttempt(
  admin: SupabaseClient,
  attemptId: string,
  status: string,
  data: Record<string, unknown>,
) {
  const { metadata: metadataPatch, ...columns } = data;
  let metadata: Record<string, unknown> | undefined;
  if (metadataPatch && typeof metadataPatch === 'object') {
    const { data: current } = await admin.from('agent_attempts').select('metadata').eq('id', attemptId).maybeSingle();
    metadata = {
      ...((current?.metadata as Record<string, unknown> | null) || {}),
      ...(metadataPatch as Record<string, unknown>),
    };
  }
  await admin.from('agent_attempts').update({
    status,
    ended_at: new Date().toISOString(),
    ...columns,
    ...(metadata ? { metadata } : {}),
  }).eq('id', attemptId).eq('status', 'running');
}

export async function runAgentExecutionAttempt(
  runId: string,
  options: { admin?: SupabaseClient; workerId?: string; origin?: string } = {},
): Promise<AgentAttemptResult> {
  const admin = options.admin ?? getSupabaseAdmin();
  const { data: runData } = await admin.from('agent_runs').select('*').eq('id', runId).maybeSingle();
  const run = runData as AgentRunRecord | null;
  if (!run || run.status !== 'running') return { claimed: false, runId };
  const inputVersionAtAttemptStart = run.input_version || 0;

  const policy = normalizeExecutionPolicy(run.execution_policy);
  if ((run.total_input_tokens || 0) >= policy.maxTotalInputTokens) {
    await admin.from('agent_runs').update({
      status: 'failed',
      ended_at: new Date().toISOString(),
      lease_token: null,
      lease_expires_at: null,
      metadata: {
        ...(run.metadata || {}),
        terminal: { code: 'execution_token_budget_exhausted', recoverable: true },
      },
    }).eq('id', runId).eq('status', 'running');
    return { claimed: false, runId, status: 'failed', terminalCode: 'execution_token_budget_exhausted' };
  }

  const workerId = options.workerId || `worker-${crypto.randomUUID()}`;
  const { data: claimData, error: claimError } = await admin.rpc('claim_agent_execution', {
    p_run_id: runId,
    p_worker_id: workerId,
    p_lease_seconds: policy.leaseSeconds,
  });
  if (claimError) throw new Error(`Failed to claim Agent execution: ${claimError.message}`);
  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as ClaimedExecution | undefined;
  if (!claim) return { claimed: false, runId };

  // A platform kill cannot close its attempt row. Once this worker owns the
  // execution lease, all older running attempts are definitively superseded.
  // finishAttempt only updates running rows, so a late old worker cannot
  // overwrite this terminal state.
  await admin.from('agent_attempts').update({
    status: 'interrupted',
    ended_at: new Date().toISOString(),
    terminal_code: 'lease_expired',
  }).eq('run_id', runId).eq('status', 'running');

  const activeStudioWorkflowStage = await resolveActiveStudioWorkflowStage(admin, run);
  const workUnit = 'agent';
  await admin.from('agent_runs').update({ current_work_unit: workUnit }).eq('id', runId).eq('lease_token', claim.lease_token);
  const { data: attempt, error: attemptError } = await admin.from('agent_attempts').insert({
    run_id: runId,
    user_id: run.user_id,
    attempt_no: claim.attempt_no,
    work_unit_key: workUnit,
    status: 'running',
    lease_token: claim.lease_token,
  }).select('id').single();
  if (attemptError || !attempt?.id) throw new Error(`Failed to create Agent attempt: ${attemptError?.message || 'missing id'}`);
  const attemptId = attempt.id as string;
  const pendingInputs = await loadPendingAgentInputs(admin, runId);

  let scaffoldResult: Awaited<ReturnType<typeof import('./studio-composition-scaffold')['ensureStudioCompositionScaffold']>> | undefined;
  let scaffoldWarning: string | undefined;
  if (activeStudioWorkflowStage === 'composition') {
    try {
      const { ensureStudioCompositionScaffold } = await import('./studio-composition-scaffold');
      scaffoldResult = await ensureStudioCompositionScaffold({
        projectId: run.project_id,
        userId: run.user_id,
        supabase: admin,
        agentRunId: run.id,
      });
      if (scaffoldResult.created && scaffoldResult.elapsedMs > 90_000) {
        scaffoldWarning = `Composition scaffold exceeded the 90s durable-output SLA (${scaffoldResult.elapsedMs}ms)`;
      }
    } catch (error) {
      scaffoldWarning = error instanceof Error ? error.message : String(error);
      console.error('[agent-execution] composition scaffold unavailable; continuing without it:', error);
    }
  }

  const request = ((run.metadata || {}).executionRequest || {}) as ExecutionRequest;
  const requestedModel = resolveAgentModelSpec(request.requestedAgentModel, process.env.AGENT_MODEL);
  const { data: previousAttempts } = claim.attempt_no > 1
    ? await admin
        .from('agent_attempts')
        .select('attempt_no, terminal_code, metadata')
        .eq('run_id', runId)
        .lt('attempt_no', claim.attempt_no)
        .order('attempt_no', { ascending: false })
        .limit(40)
    : { data: [] };
  const typedPreviousAttempts = (previousAttempts || []) as Array<{
    attempt_no: number;
    terminal_code?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  const latestRequestedProviderAttempt = typedPreviousAttempts
    .find(item => item.metadata?.model === requestedModel.id);
  const requestedProviderFailureCount = countConsecutiveRetryableProviderFailures(
    typedPreviousAttempts,
    requestedModel.id,
  );
  const previousProviderFailover = typedPreviousAttempts.some(item => {
    const failover = item.metadata?.providerFailover;
    return Boolean(
      failover
      && typeof failover === 'object'
      && 'from' in failover
      && failover.from === requestedModel.id,
    );
  });
  const failoverAgentModel: AgentModelPreference | undefined = process.env.DEEPSEEK_API_KEY?.trim()
    ? 'deepseek-v4-pro'
    : process.env.OPENROUTER_API_KEY?.trim()
      ? 'grok-4.5'
      : undefined;
  const providerFailover = requestedModel.provider === 'azure-openai'
    && Boolean(failoverAgentModel)
    && (previousProviderFailover || requestedProviderFailureCount >= MAX_SAME_PROVIDER_ATTEMPTS);
  const providerRetry = requestedModel.provider === 'azure-openai'
    && !providerFailover
    && requestedProviderFailureCount > 0;
  const sameProviderAttempt = Math.min(
    MAX_SAME_PROVIDER_ATTEMPTS,
    requestedProviderFailureCount + 1,
  );
  const effectiveAgentModel: AgentModelPreference | undefined = providerFailover
    ? failoverAgentModel || request.requestedAgentModel
    : request.requestedAgentModel;
  const resolvedModel = resolveAgentModelSpec(effectiveAgentModel, process.env.AGENT_MODEL);
  const executionStore = new AgentExecutionStore(admin, run.user_id, run.project_id);
  const previousSnapshot = await executionStore.latestSnapshot(runId);
  const continuation = claim.attempt_no > 1;
  const baseAttemptPrompt = continuation
    ? `[System durable continuation] Resume execution ${runId}, attempt ${claim.attempt_no}. ${previousSnapshot?.nextAction || 'Continue the unfinished objective from durable artifacts.'}`
    : (run.objective || claim.objective || run.prompt || 'Continue the requested task.');
  const preflightInstruction = buildRecoverablePreflightInstruction(scaffoldWarning);
  const pendingInputInstruction = formatPendingAgentInputs(pendingInputs);
  const attemptPrompt = [baseAttemptPrompt, preflightInstruction, pendingInputInstruction]
    .filter(Boolean)
    .join('\n\n');

  const ctx = await buildPromptContext(run.project_id, admin, run.user_id, {
    userMessage: attemptPrompt,
    currentSnapshotIndex: request.currentSnapshotIndex,
    hasAnnotation: request.hasAnnotation,
    isDraft: request.isDraft,
    referenceImageCount: request.referenceImageCount,
    uploadedVideoCount: request.uploadedVideoCount,
    turnMediaCount: request.turnMediaCount,
    audioAttachments: request.audioAttachments,
    currentRunId: runId,
    executionRunId: runId,
    contextPolicy: getAgentContextPolicy(resolvedModel.id),
    agentModelId: resolvedModel.id,
    durableContinuation: continuation,
  });
  await admin.from('agent_attempts').update({
    input_token_estimate: ctx.contextStats.estimatedTokens,
    metadata: {
      context: ctx.contextStats,
      model: resolvedModel.id,
      requestedModel: requestedModel.id,
      ...(providerRetry ? {
        providerRetry: {
          model: requestedModel.id,
          attempt: sameProviderAttempt,
          maxAttempts: MAX_SAME_PROVIDER_ATTEMPTS,
          reason: String(latestRequestedProviderAttempt?.metadata?.terminalDetail || 'provider unavailable'),
        },
      } : {}),
      ...(providerFailover ? {
        providerFailover: {
          from: requestedModel.id,
          to: resolvedModel.id,
          reason: String(latestRequestedProviderAttempt?.metadata?.terminalDetail || 'provider unavailable'),
        },
      } : {}),
      ...(scaffoldResult ? { compositionScaffold: scaffoldResult } : {}),
      ...(scaffoldWarning ? { compositionScaffoldWarning: scaffoldWarning } : {}),
    },
  }).eq('id', attemptId);

  const firstMessageId = typeof run.metadata?.firstMessageId === 'string' ? run.metadata.firstMessageId : undefined;
  const writer = new AgentDualWriter(
    runId,
    admin,
    run.user_id,
    run.project_id,
    undefined,
    undefined,
    continuation ? undefined : firstMessageId,
  );
  await writer.initializeSequence();
  if (continuation) await writer.beginContinuationTurn();
  await writer.persistHeartbeat();
  if (scaffoldResult?.created) {
    await writer.processAndEnqueue({
      type: 'status',
      text: request.locale === 'en'
        ? `Composition scaffold saved in ${scaffoldResult.elapsedMs}ms; applying the original Director guidance...`
        : `Composition 结构骨架已在 ${scaffoldResult.elapsedMs}ms 内保存，正在按原始 Director 指导完成画面...`,
    });
  }
  if (scaffoldWarning) {
    await writer.processAndEnqueue({
      type: 'status',
      text: request.locale === 'en'
        ? `Composition preflight found a recoverable issue and passed it to the Agent: ${scaffoldWarning.slice(0, 500)}`
        : `Composition 预检发现可修复问题，已交给 Agent 继续处理：${scaffoldWarning.slice(0, 500)}`,
    });
  }
  if (providerRetry) {
    await writer.processAndEnqueue({
      type: 'status',
      text: request.locale === 'en'
        ? `The requested model connection was interrupted; retrying ${requestedModel.id} (${sameProviderAttempt}/${MAX_SAME_PROVIDER_ATTEMPTS}) before provider failover...`
        : `原模型连接中断，正在继续尝试 ${requestedModel.id}（第 ${sameProviderAttempt}/${MAX_SAME_PROVIDER_ATTEMPTS} 次），达到上限后才切换备用模型...`,
    });
  }
  if (providerFailover) {
    await writer.processAndEnqueue({
      type: 'status',
      text: request.locale === 'en'
        ? `The requested model provider is unavailable; continuing this durable run with ${resolvedModel.id}...`
        : `原模型服务暂不可用，当前 durable run 已切换到 ${resolvedModel.id} 继续...`,
    });
  }

  const { getAllSkills } = await import('./workspace');
  const allSkills = await getAllSkills(admin, run.user_id);
  const userSkills = allSkills.filter(skill => !skill.makaron?.builtIn);
  const { data: project } = await admin.from('projects').select('timeline_version').eq('id', run.project_id).single();
  const timelineVersion = Number(project?.timeline_version ?? 1);

  const modelAbortController = new AbortController();
  let leaseHeartbeatInFlight: Promise<void> | null = null;
  const runLeaseHeartbeat = () => {
    if (leaseHeartbeatInFlight || modelAbortController.signal.aborted) return;
    leaseHeartbeatInFlight = (async () => {
      await writer.persistHeartbeat();
      const stillOwned = await renewExecutionLease({
        admin,
        runId,
        leaseToken: claim.lease_token,
        leaseSeconds: policy.leaseSeconds,
      });
      if (!stillOwned && !modelAbortController.signal.aborted) {
        modelAbortController.abort('Execution lease lost');
      }
    })().catch(error => {
      // A transient heartbeat failure must not kill a healthy model stream.
      // The next interval retries while the existing multi-minute lease remains valid.
      console.warn('[agent-execution] heartbeat failed; will retry', error);
    }).finally(() => {
      leaseHeartbeatInFlight = null;
    });
  };
  const leaseHeartbeat = setInterval(runLeaseHeartbeat, 10_000);

  let sawDone = false;
  let terminal: Extract<AgentStreamEvent, { type: 'error' }> | null = null;
  let attemptText = '';
  let providerCompaction: DurableExecutionSnapshot['providerCompaction'];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let providerCostUsd: number | undefined;
  let billingModel = resolvedModel.billingModelId;

  try {
    for await (const event of runMakaronAgent(
      ctx.fullPrompt,
      ctx.snapshotImages[ctx.currentSnapshotIndex] || '',
      run.project_id,
      {
        locale: request.locale,
        preferredModel: request.preferredModel as any,
        agentModel: effectiveAgentModel,
        videoModel: request.videoModel,
        videoResolution: request.videoResolution,
        videoAuto: request.videoAuto,
        skillLaunchContext: request.skillLaunchContext,
        audioAttachments: ctx.audioAttachments,
        snapshotImages: ctx.snapshotImages,
        currentSnapshotIndex: ctx.currentSnapshotIndex,
        isNsfw: request.isNsfw,
        userSkills: userSkills.length ? userSkills : undefined,
        supabase: admin,
        userId: run.user_id,
        currentDesign: ctx.currentDesign,
        currentDesignPath: ctx.currentDesignPath,
        history: ctx.history,
        timelineVersion,
        abortSignal: modelAbortController.signal,
        attemptBudgetMs: policy.attemptBudgetMs,
        maxSteps: policy.attemptMaxSteps,
        contextCompactAtTokens: ctx.contextStats.compactionRequired
          ? getAgentContextPolicy(resolvedModel.id).providerCompactAtTokens
          : undefined,
        historyBoundary: ctx.historyBoundary,
        execution: {
          runId,
          attemptId,
          attemptNo: claim.attempt_no,
          inputEpoch: inputVersionAtAttemptStart,
        },
        studioWorkflowStage: activeStudioWorkflowStage,
        agentRunId: runId,
      },
    )) {
      if (event.type === 'content') attemptText += event.text;
      if (event.type === 'done') sawDone = true;
      if (event.type === 'error') {
        terminal = event;
        continue;
      }
      if (event.type === 'context_compaction') {
        providerCompaction = {
          provider: event.provider,
          modelId: event.modelId,
          compactedThrough: event.compactedThrough,
          summary: event.summary,
          appliedEdits: event.appliedEdits,
          item: event.item,
          inputTokens: event.inputTokens,
        };
      }
      if (event.type === 'usage') {
        inputTokens += event.inputTokens || 0;
        outputTokens += event.outputTokens || 0;
        cacheReadTokens += event.cacheReadTokens || 0;
        cacheWriteTokens += event.cacheWriteTokens || 0;
        providerCostUsd = event.providerCostUsd;
        billingModel = event.model || billingModel;
        continue;
      }
      await writer.processAndEnqueue(event);
    }
  } catch (error) {
    console.error('[agent-execution] attempt runtime error:', error);
    const locale = normalizeLocale(request.locale, 'en');
    terminal = {
      type: 'error',
      code: 'attempt_runtime_error',
      recoverable: true,
      message: locale === 'zh'
        ? (error instanceof Error ? error.message : String(error))
        : translate(locale, 'agent.error.connectionEnded'),
    };
  } finally {
    clearInterval(leaseHeartbeat);
    const finalHeartbeat = leaseHeartbeatInFlight;
    if (finalHeartbeat) await finalHeartbeat;
    await writer.flush();
  }

  if (inputTokens || outputTokens || cacheReadTokens || cacheWriteTokens) {
    void deductByTokens(
      run.user_id,
      'agent',
      billingModel,
      inputTokens,
      outputTokens,
      undefined,
      undefined,
      { cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens },
      providerCostUsd,
    ).catch(error => console.error('[agent-execution] billing failed:', error));
  }
  await admin.from('agent_runs').update({
    total_input_tokens: (run.total_input_tokens || 0) + inputTokens + cacheReadTokens + cacheWriteTokens,
    total_output_tokens: (run.total_output_tokens || 0) + outputTokens,
  }).eq('id', runId).eq('lease_token', claim.lease_token);

  const currentLease = await readExecutionLeaseState(admin, runId, 3);
  const confirmedOwnershipLoss = isConfirmedExecutionLeaseLoss({
    renewSucceeded: false,
    verifyError: currentLease.error,
    state: currentLease.state,
    expectedLeaseToken: claim.lease_token,
  });
  if (confirmedOwnershipLoss) {
    await finishAttempt(admin, attemptId, 'aborted', { input_tokens: inputTokens, output_tokens: outputTokens });
    return { claimed: true, runId, attemptId, attemptNo: claim.attempt_no, status: 'aborted' };
  }
  if (!currentLease.state) {
    console.warn(`[agent-execution] could not verify final lease state for ${runId}; preserving durable handoff instead of orphaning the run`, currentLease.error);
  }

  if (sawDone && !terminal) {
    await markAgentRunInputsApplied({
      supabase: admin,
      runId,
      inputIds: pendingInputs.map(input => input.id),
      attemptId,
    });
    const previous = await executionStore.latestSnapshot(runId);
    const completedSnapshot = normalizeExecutionSnapshot({
      objective: run.objective || claim.objective || run.prompt || previous?.objective,
      acceptanceCriteria: Array.isArray(run.acceptance_criteria) ? run.acceptance_criteria : previous?.acceptanceCriteria,
      decisions: previous?.decisions,
      completedWork: [...(previous?.completedWork ?? []), `Execution ${runId} completed`],
      artifacts: previous?.artifacts,
      openQuestions: [],
      currentWorkUnit: 'completed',
      nextAction: 'Wait for the next user request; reuse relevant decisions and durable artifacts.',
      attemptSummary: attemptText.trim().slice(-12_000) || previous?.attemptSummary,
      providerCompaction: providerCompaction || previous?.providerCompaction,
    }, {
      objective: run.objective || claim.objective || run.prompt || 'Completed Agent task',
      currentWorkUnit: 'completed',
      nextAction: 'Wait for the next user request.',
    });
    await executionStore.saveSnapshot({
      runId,
      attemptId,
      projectId: run.project_id,
      kind: 'execution_completed',
      snapshot: completedSnapshot,
      providerCompaction: providerCompaction as Record<string, unknown> | undefined,
    });
    const { data: completedRun, error: completionError } = await admin.from('agent_runs').update({
      status: 'completed',
      current_work_unit: 'completed',
      ended_at: new Date().toISOString(),
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: null,
    })
      .eq('id', runId)
      .eq('status', 'running')
      .eq('lease_token', claim.lease_token)
      .eq('input_version', inputVersionAtAttemptStart)
      .select('id')
      .maybeSingle();
    if (completionError) throw new Error(`Failed to finalize Agent execution: ${completionError.message}`);
    if (completedRun) {
      await finishAttempt(admin, attemptId, 'completed', { input_tokens: inputTokens, output_tokens: outputTokens });
      return { claimed: true, runId, attemptId, attemptNo: claim.attempt_no, status: 'completed' };
    }

    terminal = {
      type: 'error',
      code: 'agent_input_received',
      recoverable: true,
      message: 'A new instruction arrived during this Agent Run and will be handled by the next attempt.',
    };
    sawDone = false;
  }

  const canContinue = shouldScheduleNextAttempt({
    executionStatus: 'running',
    attemptNo: claim.attempt_no,
    maxAttempts: policy.maxAttempts,
    terminal: terminal?.recoverable !== false ? 'retryable' : 'failed',
  });
  if (canContinue) {
    const snapshot = await buildHandoffSnapshot({
      store: executionStore,
      run,
      claim,
      terminal,
      attemptText,
      providerCompaction,
    });
    await executionStore.saveSnapshot({
      runId,
      attemptId,
      projectId: run.project_id,
      kind: providerCompaction ? 'provider_compaction_handoff' : 'attempt_handoff',
      snapshot,
      providerCompaction: providerCompaction as Record<string, unknown> | undefined,
    });
    await writer.processAndEnqueue({
      type: 'status',
      text: request.locale === 'en'
        ? `Attempt ${claim.attempt_no} checkpointed; continuing on the server...`
        : `第 ${claim.attempt_no} 个执行片段已保存，服务器正在继续...`,
    });
    await writer.flush();
    await finishAttempt(admin, attemptId, 'handed_off', {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      terminal_code: terminal?.code || 'missing_terminal_event',
      ...(terminal?.checkpoint?.errorDetail
        ? { metadata: { terminalDetail: terminal.checkpoint.errorDetail } }
        : {}),
    });
    await admin.from('agent_runs').update({
      current_work_unit: 'agent',
      next_attempt_at: new Date().toISOString(),
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null,
      metadata: {
        ...(run.metadata || {}),
        lastHandoff: {
          attemptId,
          attemptNo: claim.attempt_no,
          terminalCode: terminal?.code || 'missing_terminal_event',
          nextAction: snapshot.nextAction,
        },
      },
    }).eq('id', runId).eq('status', 'running').eq('lease_token', claim.lease_token);
    void dispatchAgentExecutionAttempt(runId, options.origin || request.origin);
    return {
      claimed: true,
      runId,
      attemptId,
      attemptNo: claim.attempt_no,
      status: 'handed_off',
      terminalCode: terminal?.code,
    };
  }

  if (terminal) await writer.processAndEnqueue(terminal);
  await writer.flush();
  await finishAttempt(admin, attemptId, 'failed', {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    terminal_code: terminal?.code || 'attempt_incomplete',
  });
  await admin.from('agent_runs').update({
    status: 'failed',
    ended_at: new Date().toISOString(),
    lease_token: null,
    lease_owner: null,
    lease_expires_at: null,
    metadata: {
      ...(run.metadata || {}),
      terminal: terminal || { code: 'attempt_incomplete', recoverable: false },
    },
  }).eq('id', runId).eq('status', 'running').eq('lease_token', claim.lease_token);
  return {
    claimed: true,
    runId,
    attemptId,
    attemptNo: claim.attempt_no,
    status: 'failed',
    terminalCode: terminal?.code,
  };
}
