import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { AgentPerf } from '@/lib/agent-perf';
import { requireCredits, deductByTokens } from '@/lib/billing/credits';
import { getRequestLocale } from '@/lib/server-locale';
import { translate } from '@/lib/locales';
import { resolvePersistedRunStatus } from '@/lib/agent-terminal';
import {
  normalizeRequestedAgentModelPreference,
  resolveAgentModelSpecForUser,
  shouldRequireAgentCredits,
} from '@/lib/agent-models';
import {
  DEFAULT_ATTEMPT_BUDGET_MS,
  DEFAULT_ATTEMPT_LEASE_SECONDS,
  DEFAULT_ATTEMPT_MAX_STEPS,
  getAgentContextPolicy,
} from '@/lib/agent-execution';
import { verifySkillLaunchContext } from '@/lib/skill-launch-context';
import { isDynamicCodexSubscriptionUserAllowed } from '@/lib/codex-subscription-allowlist';
import {
  appendAgentRunInput,
  decideAgentRunAdmission,
  findActiveAgentRun,
} from '@/lib/agent-run-admission';

export const maxDuration = 1800;

/**
 * POST /api/agent/run — Fire-and-forget agent execution.
 *
 * Accepts (projectId, prompt) and runs the agent in the background.
 * Returns immediately with { runId }. Client polls /api/agent/run/[id] for status.
 * All results are written to DB via DualWriter (no SSE needed).
 */
export async function POST(req: NextRequest) {
  const perf = new AgentPerf('agent-run-start', { route: '/api/agent/run' });
  let createdRunId: string | undefined;
  let cleanupSupabase: any;
  try {
    const endRequestRead = perf.span('request_read');
    const [authResult, requestBody] = await Promise.all([
      authenticateRequest(req),
      req.json(),
    ]);
    endRequestRead({ authenticated: !('error' in authResult) });
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;
    cleanupSupabase = supabase;

    const {
      projectId,
      prompt,
      currentSnapshotIndex,
      hasAnnotation,
      isDraft,
      referenceImageCount,
      uploadedVideoCount,
      turnMediaCount,
      preferredModel,
      agentModel,
      isNsfw,
      videoModel,
      videoResolution,
      videoAuto,
      skillLaunchContext: rawSkillLaunchContext,
      audioAttachments,
      clientPersistedUserMessage,
    } = requestBody;

    const endAdmissionPreflight = perf.span('admission_preflight', { projectId: projectId || null });
    const [codexSubscriptionAllowed, skillLaunchContext, activeRun] = await Promise.all([
      isDynamicCodexSubscriptionUserAllowed(userId),
      verifySkillLaunchContext(supabase, rawSkillLaunchContext, userId),
      projectId ? findActiveAgentRun(supabase, projectId, userId) : Promise.resolve(null),
    ]);
    endAdmissionPreflight({ codexSubscriptionAllowed, hasActiveRun: !!activeRun });
    if (rawSkillLaunchContext && !skillLaunchContext) {
      return NextResponse.json(
        { error: 'Skill template launch could not be verified' },
        { status: 400 },
      );
    }

    if (!projectId || !prompt) {
      return NextResponse.json(
        { error: 'projectId and prompt are required' },
        { status: 400 },
      );
    }

    const requestedAgentModel = normalizeRequestedAgentModelPreference(agentModel);
    if (requestedAgentModel === null) {
      return NextResponse.json({ error: 'Unsupported agentModel' }, { status: 400 });
    }
    const resolvedAgentModel = resolveAgentModelSpecForUser(
      requestedAgentModel,
      process.env.AGENT_MODEL,
      userId,
      undefined,
      codexSubscriptionAllowed,
    );

    // Pre-flight credit check
    if (shouldRequireAgentCredits(resolvedAgentModel.provider)) {
      const endCreditCheck = perf.span('credit_check', { provider: resolvedAgentModel.provider });
      const creditCheck = await requireCredits(userId, 5);
      endCreditCheck({ ok: creditCheck.ok });
      if (!creditCheck.ok) return creditCheck.response;
    }

    const locale = getRequestLocale(req);

    const persistHeadlessUserMessage = async () => {
      if (clientPersistedUserMessage) return;
      await supabase.from('messages').insert({
        id: crypto.randomUUID(),
        project_id: projectId,
        role: 'user',
        content: prompt,
        has_image: false,
      });
    };

    const admission = decideAgentRunAdmission(activeRun);
    if (admission.kind === 'append') {
      await persistHeadlessUserMessage();
      const inputId = await appendAgentRunInput({
        supabase,
        runId: admission.runId,
        projectId,
        userId,
        content: prompt,
        source: 'cli',
      });
      return NextResponse.json({
        runId: admission.runId,
        executionId: admission.runId,
        inputId,
        status: 'running',
        durable: true,
        appended: true,
      }, { status: 202 });
    }
    if (admission.kind === 'conflict') {
      return NextResponse.json({
        error: 'active_agent_run_conflict',
        message: 'The project has an active legacy Agent Run that cannot safely accept another instruction.',
        runId: admission.runId,
      }, { status: 409 });
    }

    const durableExecution = process.env.AGENT_DURABLE_EXECUTION !== 'false';
    const firstMessageId = crypto.randomUUID();
    const executionPolicy = durableExecution ? {
      durable: true,
      attemptBudgetMs: DEFAULT_ATTEMPT_BUDGET_MS,
      attemptMaxSteps: DEFAULT_ATTEMPT_MAX_STEPS,
      leaseSeconds: DEFAULT_ATTEMPT_LEASE_SECONDS,
      maxAttempts: 40,
      maxTotalInputTokens: 12_000_000,
    } : undefined;
    const metadata = {
      locale,
      preferredModel,
      requestedAgentModel: requestedAgentModel ?? 'auto',
      agentModel: resolvedAgentModel.id,
      agentProviderModel: resolvedAgentModel.providerModelId,
      isNsfw,
      headless: true,
      firstMessageId,
      ...(durableExecution ? {
        executionRequest: {
          locale,
          preferredModel,
          requestedAgentModel: requestedAgentModel ?? 'auto',
          videoModel,
          videoResolution,
          videoAuto,
          skillLaunchContext,
          currentSnapshotIndex,
          hasAnnotation,
          isDraft,
          referenceImageCount,
          uploadedVideoCount,
          turnMediaCount,
          isNsfw,
          audioAttachments,
          codexSubscriptionAllowed,
          origin: req.nextUrl.origin,
        },
      } : {}),
    };

    // Create the durable run fully initialized in one write. The previous path
    // inserted a partial row, wrote a heartbeat, then updated metadata twice
    // before the browser was allowed to begin observing the run.
    const endRunCreate = perf.span('create_run', { durable: durableExecution });
    const { data: run, error: runCreateError } = await supabase.from('agent_runs').insert({
      project_id: projectId,
      user_id: userId,
      status: 'running',
      prompt: prompt.slice(0, 500),
      metadata,
      ...(durableExecution ? {
        objective: prompt,
        execution_policy: executionPolicy,
        current_work_unit: 'agent',
        next_attempt_at: new Date().toISOString(),
      } : {}),
    }).select('id').single();
    endRunCreate({ ok: !runCreateError, runId: run?.id ?? null });

    const runId = run?.id;
    if (runCreateError || !runId) {
      return NextResponse.json({ error: runCreateError?.message || 'Failed to create run' }, { status: 500 });
    }
    createdRunId = runId;

    // Write user message to DB (frontend does this itself, headless mode must do it here)
    await persistHeadlessUserMessage();

    // Durable execution is the default path. Keep the legacy one-function
    // runner below as an explicit rollback switch while the new worker soaks.
    if (durableExecution) {
      after(async () => {
        try {
          // Keep the full Agent/tool runtime out of the start response's module
          // initialization path. The durable worker loads it after the browser
          // already has the run id and can begin its lightweight event watch.
          const { runAgentExecutionAttempt } = await import('@/lib/agent-execution-runner');
          await runAgentExecutionAttempt(runId, { admin: supabase as any, workerId: `initial-${crypto.randomUUID()}` });
        } catch (executionError) {
          console.error(`[agent/run] durable attempt failed for ${runId}:`, executionError);
          // Leave the execution running with its due timestamp. Cron recovery
          // will reclaim it after the lease instead of losing the user task.
        }
      });
      return NextResponse.json({
        runId,
        executionId: runId,
        firstMessageId,
        status: 'running',
        durable: true,
      });
    }

    // The legacy rollback path still runs in this request's background task.
    // Durable workers build context and skills themselves, so keeping this below
    // the durable return avoids doing both expensive loads twice on every run.
    const [{ runMakaronAgent }, { AgentDualWriter }, { buildPromptContext }] = await Promise.all([
      import('@/lib/agent'),
      import('@/lib/agentDualWriter'),
      import('@/lib/agent-context'),
    ]);
    const writer = new AgentDualWriter(runId, supabase, userId, projectId, undefined, undefined, firstMessageId);
    await writer.persistHeartbeat();
    const { data: projectRow } = await supabase.from('projects').select('timeline_version').eq('id', projectId).single();
    const timelineVersion: number = (projectRow as Record<string, unknown>)?.timeline_version as number ?? 1;
    const ctx = await buildPromptContext(projectId, supabase, userId, {
      userMessage: prompt,
      currentSnapshotIndex,
      hasAnnotation,
      isDraft,
      referenceImageCount,
      uploadedVideoCount,
      turnMediaCount,
      audioAttachments,
      currentRunId: runId,
      agentModelId: resolvedAgentModel.id,
      agentModelProvider: resolvedAgentModel.provider,
    });
    // Run agent after response is sent — next/server after() keeps the function alive
    after(async () => {
      const modelAbortController = new AbortController();
      const heartbeat = setInterval(() => {
        void writer.persistHeartbeat();
        void supabase.from('agent_runs').select('status').eq('id', runId).single()
          .then(({ data }) => {
            if (data?.status !== 'running' && !modelAbortController.signal.aborted) {
              modelAbortController.abort('Agent run reached a persisted terminal status');
            }
          });
      }, 10_000);
      try {
      let abortCheckCount = 0;
      const shouldStop = async (force = false) => {
        if (!force && ++abortCheckCount % 10 !== 0) return false;
        const { data } = await supabase.from('agent_runs').select('status').eq('id', runId).single();
        return data?.status !== 'running';
      };

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheReadTokens = 0;
      let totalCacheWriteTokens = 0;
      let cacheWriteTelemetryComplete = true;
      let providerCostUsd: number | undefined;
      let agentModel = '';
      let sawDone = false;
      let sawError = false;
      let wasStopped = false;
      let terminalError: Extract<import('@/lib/agent').AgentStreamEvent, { type: 'error' }> | null = null;
      try {
        for await (const event of runMakaronAgent(ctx.fullPrompt, ctx.snapshotImages[ctx.currentSnapshotIndex] || '', projectId, {
          locale,
          preferredModel,
          agentModel: requestedAgentModel,
          videoModel,
          videoResolution,
          videoAuto,
          skillLaunchContext,
          audioAttachments: ctx.audioAttachments,
          snapshotImages: ctx.snapshotImages,
          explicitMediaIndices: ctx.explicitMediaIndices,
          currentSnapshotIndex: ctx.currentSnapshotIndex,
          isNsfw,
          supabase,
          userId: userId,
          codexSubscriptionAllowed,
          currentDesign: ctx.currentDesign,
          currentDesignPath: ctx.currentDesignPath,
          history: ctx.history,
          timelineVersion,
          abortSignal: modelAbortController.signal,
          contextCompactAtTokens: ctx.contextStats.compactionRequired
            ? getAgentContextPolicy(resolvedAgentModel.id).providerCompactAtTokens
            : undefined,
          historyBoundary: ctx.historyBoundary,
          studioWorkflowStage: ctx.activeStudioWorkflowStage,
          agentRunId: runId,
        })) {
          if (event.type === 'done') sawDone = true;
          if (event.type === 'error') {
            sawError = true;
            terminalError = event;
          }
          if (event.type === 'usage') {
            totalInputTokens += event.inputTokens ?? 0;
            totalOutputTokens += event.outputTokens ?? 0;
            totalCacheReadTokens += event.cacheReadTokens ?? 0;
            totalCacheWriteTokens += event.cacheWriteTokens ?? 0;
            if (event.cacheWriteTelemetryComplete === false) {
              cacheWriteTelemetryComplete = false;
            }
            providerCostUsd = event.providerCostUsd;
            if (event.model) agentModel = event.model;
          }
          await writer.processAndEnqueue(event);
          if (await shouldStop()) {
            console.log(`[agent/run] Run ${runId} stopped by persisted terminal status`);
            wasStopped = true;
            break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[agent/run] Run ${runId} error:`, msg);
        const fallbackTerminal = terminalError ?? {
          type: 'error' as const,
          code: 'agent_stream_error',
          recoverable: false,
          message: msg,
        };
        try {
          await writer.processAndEnqueue(fallbackTerminal);
        } catch (persistError) {
          console.error(`[agent/run] Run ${runId} terminal error persistence failed:`, persistError);
        }
        if (shouldRequireAgentCredits(resolvedAgentModel.provider)
          && (totalInputTokens > 0 || totalOutputTokens > 0 || totalCacheReadTokens > 0 || totalCacheWriteTokens > 0)) {
          deductByTokens(
            userId, 'agent', agentModel || 'unknown',
            totalInputTokens, totalOutputTokens,
            undefined, undefined,
            {
              cacheRead: totalCacheReadTokens,
              cacheWrite: totalCacheWriteTokens,
              cacheWriteTelemetryComplete,
            },
            providerCostUsd,
          ).catch(e => console.error('[agent/run] billing error:', e));
        }
        const { data: failedRun } = await supabase.from('agent_runs')
          .select('metadata').eq('id', runId).single();
        await supabase.from('agent_runs').update({
          status: 'failed',
          ended_at: new Date().toISOString(),
          metadata: {
            ...((failedRun?.metadata as Record<string, unknown> | null) ?? {}),
            terminal: {
              code: fallbackTerminal.code,
              recoverable: fallbackTerminal.recoverable === true,
              checkpoint: fallbackTerminal.checkpoint,
              message: fallbackTerminal.message,
            },
          },
        }).eq('id', runId).eq('status', 'running');
        return;
      }

      if (!sawDone && !sawError && await shouldStop(true)) wasStopped = true;

      if (!sawDone && !sawError && !wasStopped) {
        terminalError = {
          type: 'error',
          code: 'missing_terminal_event',
          recoverable: true,
          message: translate(locale, 'agent.error.connectionEnded'),
        };
        sawError = true;
        await writer.processAndEnqueue(terminalError);
      }

      await writer.flush();
      // Deduct agent LLM tokens
      if (shouldRequireAgentCredits(resolvedAgentModel.provider)
        && (totalInputTokens > 0 || totalOutputTokens > 0 || totalCacheReadTokens > 0 || totalCacheWriteTokens > 0)) {
        deductByTokens(
          userId, 'agent', agentModel || 'unknown',
          totalInputTokens, totalOutputTokens,
          undefined, undefined,
          {
            cacheRead: totalCacheReadTokens,
            cacheWrite: totalCacheWriteTokens,
            cacheWriteTelemetryComplete,
          },
          providerCostUsd,
        ).catch(e => console.error('[agent/run] billing error:', e));
      }
      const { data: finalRun } = await supabase.from('agent_runs')
        .select('status, metadata').eq('id', runId).single();
      if (finalRun?.status === 'running') {
        const terminalStatus = resolvePersistedRunStatus({
          currentStatus: finalRun.status,
          sawDone,
          sawError,
        });
        await supabase.from('agent_runs').update({
          status: terminalStatus,
          ended_at: new Date().toISOString(),
          ...(terminalError ? {
            metadata: {
              ...((finalRun.metadata as Record<string, unknown> | null) ?? {}),
              terminal: {
                code: terminalError.code,
                recoverable: terminalError.recoverable === true,
                checkpoint: terminalError.checkpoint,
                message: terminalError.message,
              },
            },
          } : {}),
        }).eq('id', runId).eq('status', 'running');
      }

      // Auto-name only after an actually completed agent run.
      if (sawDone && !sawError && !wasStopped) try {
        const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).single();
        if (proj && (!proj.title || proj.title === 'Untitled' || proj.title === '未命名' || proj.title === '未命名项目')) {
          const nameSource = prompt.slice(0, 200);
          if (nameSource.trim()) {
            const namePrompt = `Based on this user request, give a concise project name (2-4 words, no quotes): "${nameSource}". Output only the name.`;
            let projectName = '';
            for await (const ev of runMakaronAgent(namePrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel, userId, codexSubscriptionAllowed,
            })) {
              if (ev.type === 'content' && ev.text) projectName += ev.text;
            }
            projectName = projectName.trim().replace(/^["']|["']$/g, '');
            if (projectName && projectName.length <= 50) {
              await supabase.from('projects').update({ title: projectName }).eq('id', projectId);
            }
          }
        }
      } catch (e) {
        console.error('[agent/run] auto-name error:', e);
      }

      console.log(`[agent/run] Run ${runId} terminal sawDone=${sawDone} sawError=${sawError}`);
      } finally {
        clearInterval(heartbeat);
      }
    });

    return NextResponse.json({ runId, status: 'running' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent/run] Request error:', msg);
    if (createdRunId && cleanupSupabase) {
      try {
        await cleanupSupabase.from('agent_runs').update({
          status: 'failed',
          ended_at: new Date().toISOString(),
        }).eq('id', createdRunId).eq('status', 'running');
      } catch { /* best effort */ }
    }
    const locale = getRequestLocale(req);
    return NextResponse.json({ error: locale === 'zh' ? msg : translate(locale, 'agent.error.fatal') }, { status: 500 });
  }
}

/**
 * GET /api/agent/run?projectId=xxx — List runs for a project.
 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;
  const { userId, supabase } = authResult.auth;

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id, status, prompt, started_at, ended_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(20);

  return NextResponse.json({ runs: runs ?? [] });
}
