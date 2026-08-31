import { NextRequest } from 'next/server';
import type { ModelMessage } from 'ai';
import { authenticateRequest } from '@/lib/api-auth';
import type { AgentDualWriter as AgentDualWriterType } from '@/lib/agentDualWriter';
import { requireCredits, deductByTokens } from '@/lib/billing/credits';
import { AgentPerf } from '@/lib/agent-perf';
import { getRequestLocale } from '@/lib/server-locale';
import { resolvePersistedRunStatus } from '@/lib/agent-terminal';
import { translate } from '@/lib/locales';
import {
  normalizeRequestedAgentModelPreference,
  resolveAgentModelSpecForUser,
  shouldRequireAgentCredits,
} from '@/lib/agent-models';
import {
  DEFAULT_ATTEMPT_BUDGET_MS,
  DEFAULT_ATTEMPT_MAX_STEPS,
  getAgentContextPolicy,
} from '@/lib/agent-execution';
import { isDynamicCodexSubscriptionUserAllowed } from '@/lib/codex-subscription-allowlist';
import { verifySkillLaunchContext } from '@/lib/skill-launch-context';
import {
  appendAgentRunInput,
  decideAgentRunAdmission,
  findActiveAgentRun,
} from '@/lib/agent-run-admission';

export const maxDuration = 1800;

export async function POST(req: NextRequest) {
  const perf = new AgentPerf('agent-api', { route: '/api/agent' });
  try {
    const endAuth = perf.span('authenticate');
    const endReadBody = perf.span('read_body');
    const [authResult, requestBody] = await Promise.all([
      authenticateRequest(req),
      req.json(),
    ]);
    endAuth({ ok: !('error' in authResult) });
    endReadBody();
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    const { prompt, image, animationImageUrls, animationImages, projectId, analysisOnly, analysisContext, isVideoAnalysis,
            tipReaction, committedTip, tipsTeaser, tipsPayload, nameProject, description,
            previewsReady, readyTips, preferredModel, agentModel, snapshotImages, currentSnapshotIndex, isNsfw,
            musicReady, musicAudioUrl, currentDesign, currentDesignPath, videoModel, videoResolution, videoAuto,
            headless, hasAnnotation, isDraft, referenceImageCount, uploadedVideoCount, turnMediaCount, audioAttachments,
            skillLaunchContext: rawSkillLaunchContext } = requestBody;
    perf.mark('request_ready', {
      projectId: projectId || null,
      promptChars: typeof prompt === 'string' ? prompt.length : 0,
      hasImage: !!image,
      headless: !!headless,
    });
    const locale = getRequestLocale(req);
    const [codexSubscriptionAllowed, skillLaunchContext] = await Promise.all([
      isDynamicCodexSubscriptionUserAllowed(userId),
      verifySkillLaunchContext(supabase, rawSkillLaunchContext, userId),
    ]);
    if (rawSkillLaunchContext && !skillLaunchContext) {
      return new Response(
        JSON.stringify({ error: 'Skill template launch could not be verified' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const requestedAgentModel = normalizeRequestedAgentModelPreference(agentModel);
    if (requestedAgentModel === null) {
      return new Response(
        JSON.stringify({ error: 'Unsupported agentModel' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const resolvedAgentModel = resolveAgentModelSpecForUser(
      requestedAgentModel,
      process.env.AGENT_MODEL,
      userId,
      undefined,
      codexSubscriptionAllowed,
    );

    if (shouldRequireAgentCredits(resolvedAgentModel.provider)) {
      const endCreditCheck = perf.span('credit_check', { userId });
      const creditCheck = await requireCredits(userId, 5);
      endCreditCheck({ ok: creditCheck.ok });
      if (!creditCheck.ok) return creditCheck.response;
    }

    if (!projectId || (!tipsTeaser && !nameProject && !previewsReady && !uploadedVideoCount && !image && !prompt)) {
      return new Response(
        JSON.stringify({ error: 'projectId and (image or prompt) are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const MOCK_TEXTS = {
      tipsTeaser: translate(locale, 'agent.mock.tipsTeaser'),
      tipReaction: translate(locale, 'agent.mock.tipReaction'),
      nameProject: translate(locale, 'agent.mock.nameProject'),
      previewsReady: translate(locale, 'agent.mock.previewsReady'),
    };

    // Only dual-write for normal agent flow (not lightweight teaser/name/reaction/analysis branches)
    const isNormalMode = !tipsTeaser && !nameProject && !previewsReady && !tipReaction && !analysisOnly;

    // Agent tools pull in media codecs and the full tool registry. Load that
    // runtime in parallel with admission instead of blocking route startup.
    const agentRuntimePromise = import('@/lib/agent');
    const durableRunnerPromise = isNormalMode
      ? import('@/lib/agent-execution-runner')
      : Promise.resolve(null);
    const writerRuntimePromise = isNormalMode
      ? import('@/lib/agentDualWriter')
      : Promise.resolve(null);

    // Timeline and admission are independent. Keep both off the serial path.
    const endProjectLoad = perf.span('load_project', { projectId });
    const projectPromise = supabase.from('projects').select('timeline_version').eq('id', projectId).single();
    const activeRunPromise = isNormalMode
      ? findActiveAgentRun(supabase, projectId, userId)
      : Promise.resolve(null);
    const timelineVersionPromise = projectPromise.then(({ data: projectRow }) => {
      const timelineVersion = (projectRow as Record<string, unknown>)?.timeline_version as number ?? 1;
      endProjectLoad({ timelineVersion });
      return timelineVersion;
    });
    const activeRun = await activeRunPromise;

    let runId: string | null = null;
    let firstMessageId: string | null = null;
    let inlineRunPreload: {
      id: string;
      project_id: string;
      user_id: string;
      status: string;
      objective: string;
      prompt: string;
      execution_policy: Record<string, unknown>;
      attempt_count: number;
      total_input_tokens: number;
      total_output_tokens: number;
      input_version: number;
      metadata: Record<string, unknown>;
    } | null = null;
    if (isNormalMode) {
      const endRunCreate = perf.span('create_agent_run', { projectId, userId });
      const admission = decideAgentRunAdmission(activeRun);
      if (admission.kind === 'append') {
        if (headless) {
          await supabase.from('messages').insert({
            id: crypto.randomUUID(),
            project_id: projectId,
            role: 'user',
            content: prompt || '',
            has_image: false,
          });
        }
        await appendAgentRunInput({
          supabase,
          runId: admission.runId,
          projectId,
          userId,
          content: prompt || 'Continue the current request.',
          source: headless ? 'cli' : 'cui',
        });
        const body = [
          `data: ${JSON.stringify({ type: 'status', text: locale === 'zh' ? '新指令已加入当前 Agent Run' : 'Instruction added to the active Agent Run' })}`,
          `data: ${JSON.stringify({ type: 'done' })}`,
          '',
        ].join('\n');
        return new Response(body, {
          status: 202,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Agent-Run-Id': admission.runId,
            'X-Agent-Input-Appended': 'true',
          },
        });
      }
      if (admission.kind === 'conflict') {
        return new Response(JSON.stringify({
          error: 'active_agent_run_conflict',
          message: 'The project has an active legacy Agent Run that cannot safely accept another instruction.',
          runId: admission.runId,
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }

      runId = crypto.randomUUID();
      firstMessageId = crypto.randomUUID();
      const inlineLeaseSeconds = Math.max(
        60,
        Math.min(900, Number(process.env.AGENT_INLINE_LEASE_SECONDS) || 120),
      );
      const objective = prompt || 'Continue the current project conversation.';
      const executionPolicy = {
        durable: true as const,
        transport: 'sse',
        reconnect: 'event-log',
        mode: 'inline-first-attempt',
        attemptBudgetMs: DEFAULT_ATTEMPT_BUDGET_MS,
        attemptMaxSteps: DEFAULT_ATTEMPT_MAX_STEPS,
        leaseSeconds: inlineLeaseSeconds,
        maxAttempts: 40,
        maxTotalInputTokens: 12_000_000,
      };
      const runMetadata = {
        locale,
        preferredModel,
        requestedAgentModel: requestedAgentModel ?? 'auto',
        agentModel: resolvedAgentModel.id,
        agentProvider: resolvedAgentModel.provider,
        agentProviderModel: resolvedAgentModel.providerModelId,
        isNsfw,
        analysisOnly,
        firstMessageId,
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
      };
      inlineRunPreload = {
        id: runId,
        project_id: projectId,
        user_id: userId,
        status: 'running',
        objective,
        prompt: (prompt ?? '').slice(0, 500),
        execution_policy: executionPolicy,
        attempt_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        input_version: 0,
        metadata: runMetadata,
      };
      const { error: runInsertError } = await supabase.from('agent_runs').insert({
        id: runId,
        project_id: projectId,
        user_id: userId,
        status: 'running',
        prompt: (prompt ?? '').slice(0, 500),
        objective,
        execution_policy: executionPolicy,
        current_work_unit: 'agent',
        next_attempt_at: new Date().toISOString(),
        metadata: runMetadata,
      });
      if (runInsertError) throw new Error(`Failed to create inline durable Agent Run: ${runInsertError.message}`);
      endRunCreate({ runId: runId || null });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        perf.mark('stream_start', { projectId, runId: runId || null });
        const enqueue = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        enqueue({
          type: 'status',
          text: translate(locale, 'agent.status.starting'),
        });
        perf.mark('first_sse_sent', { eventType: 'status' });

        // Normal interactive turns are durable from creation, but attempt 1
        // runs inside this SSE request so the browser receives model output
        // without polling or a second worker dispatch. If this process dies,
        // its short lease expires and the durable cron resumes the same run.
        if (runId && isNormalMode) {
          try {
            const runnerRuntime = await durableRunnerPromise;
            if (!runnerRuntime) throw new Error('Durable runner is unavailable');
            const timelineVersion = await timelineVersionPromise;
            const result = await runnerRuntime.runAgentExecutionAttempt(runId, {
              admin: supabase,
              workerId: `inline-${crypto.randomUUID()}`,
              origin: req.nextUrl.origin,
              controller,
              encoder,
              timelineVersion,
              preloadedRun: inlineRunPreload || undefined,
              requestOverrides: {
                image: typeof image === 'string' ? image : undefined,
                snapshotImages: Array.isArray(snapshotImages) ? snapshotImages : undefined,
                currentDesign: currentDesign && typeof currentDesign === 'object'
                  ? currentDesign as Record<string, unknown>
                  : undefined,
                currentDesignPath: typeof currentDesignPath === 'string' ? currentDesignPath : undefined,
              },
            });
            perf.mark('inline_durable_attempt_finished', {
              claimed: result.claimed,
              status: result.status || null,
              attemptNo: result.attemptNo || null,
            });
          } catch (error) {
            // Never convert a worker/process interruption into a terminal run.
            // The due run or expired lease remains recoverable by cron.
            console.error(`[agent] inline durable attempt interrupted for ${runId}:`, error);
          } finally {
            perf.mark('stream_close', { projectId, runId });
            try { controller.close(); } catch { /* browser already disconnected */ }
          }
          return;
        }

        const [{ runMakaronAgent }, writerRuntime] = await Promise.all([
          agentRuntimePromise,
          writerRuntimePromise,
        ]);
        // Track token usage for billing
        let usageEvent: Extract<import('@/lib/agent').AgentStreamEvent, { type: 'usage' }> | null = null;
        let sawDone = false;
        let sawError = false;
        let wasStopped = false;
        let terminalError: Extract<import('@/lib/agent').AgentStreamEvent, { type: 'error' }> | null = null;
        let latestProviderCompaction: import('@/lib/agent-execution').DurableExecutionSnapshot['providerCompaction'];

        // Helper: iterate agent stream, capture usage event
        async function iterateAgent(gen: AsyncIterable<import('@/lib/agent').AgentStreamEvent>, ctrl: ReadableStreamDefaultController) {
          for await (const event of gen) {
            if (event.type === 'usage') { usageEvent = event; continue; } // capture, don't send to client
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        }

        // Create dual writer if normal mode with a valid run
        const writer: AgentDualWriterType | null = (runId && isNormalMode && writerRuntime)
          ? new writerRuntime.AgentDualWriter(runId, supabase, userId, projectId, controller, encoder, firstMessageId)
          : null;
        if (writer) {
          // Reconnect logging must not delay context construction or model start.
          // insertEvent reserves seq synchronously, so later events remain ordered.
          void writer.persistHeartbeat().catch(error => {
            console.warn('[agent] initial fast-lane heartbeat failed', error);
          });
        }

        try {
          // tipsTeaser: generate a one-sentence teaser about the tips (no image needed)
          if (tipsTeaser && tipsPayload) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.tipsTeaser })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const tipsSummary = (tipsPayload as { category: string; emoji: string; label: string; desc: string }[])
              .map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`)
              .join('\n');
            const teaserPrompt = `Here are edit suggestions for a photo:\n${tipsSummary}\n\nPick the most interesting one. Write a single teaser sentence (under 15 words) starting with "Try...". Output only that sentence.`;
            await iterateAgent(runMakaronAgent(teaserPrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel, userId, codexSubscriptionAllowed,
            }), controller);
            return;
          }

          // nameProject: generate a short project name from image description
          if (nameProject) {
            const desc = (description as string) || '';
            const namePrompt = `Based on this photo description, give a concise project name (2-4 words): ${desc}. Output only the name, no punctuation or explanation.`;
            await iterateAgent(runMakaronAgent(namePrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel, userId, codexSubscriptionAllowed,
            }), controller);
            return;
          }

          // previewsReady: AI notification that all preview images are done
          if (previewsReady && readyTips) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.previewsReady })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const tips = readyTips as { emoji: string; label: string; desc: string; category: string }[];
            const tipsSummary = tips
              .map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`)
              .join('\n');
            const readyPrompt = `All ${tips.length} edit suggestion previews are ready:\n${tipsSummary}\n\nIn 1-2 sentences, tell the user previews are ready and they can scroll TipsBar. Comment on one interesting one. Friendly tone, don't start with "I".`;
            await iterateAgent(runMakaronAgent(readyPrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel, userId, codexSubscriptionAllowed,
            }), controller);
            return;
          }

          // musicReady: background music generation completed — agent injects <Audio> into the composition
          if (musicReady && musicAudioUrl) {
            const musicPrompt = `Background music is ready: ${musicAudioUrl}\n\nFirst, briefly tell the user the music is ready and you're adding it to the video now (1 sentence). Then: load the latest Remotion composition code from workspace (list_files to find it, read_file to load), add <Audio src="${musicAudioUrl}" volume={0.3} /> to it, and call run_code with runtime: "composition" to render the updated version with music.`;
            await iterateAgent(runMakaronAgent(musicPrompt, image || '', projectId, {
              locale, agentModel: requestedAgentModel,
              snapshotImages, currentSnapshotIndex, supabase, userId: userId, codexSubscriptionAllowed,
            }), controller);
            return;
          }

          // tipReaction: react to a committed tip in CUI (1-2 sentences)
          if (tipReaction && committedTip) {
            if (process.env.MOCK_AI === 'true') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: MOCK_TEXTS.tipReaction })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              return;
            }
            const tip = committedTip as { emoji: string; label: string; desc: string; category: string };
            const reactionPrompt = `User just committed an edit via TipsBar:\n${tip.emoji} ${tip.label} (${tip.category}): ${tip.desc}\n\nReact naturally in 1 sentence, like a friend. Then in 1 short sentence, inspire what direction they could explore next with this photo (e.g. mood, lighting, story element) — but do NOT recommend specific tips. Don't start with "I".`;
            await iterateAgent(runMakaronAgent(reactionPrompt, image, projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel, userId, codexSubscriptionAllowed,
            }), controller);
            return;
          }

          // Do not load user skills in the route. The full agent prompt builds
          // its manifest once inside buildSystemPrompt; analysis-only skips it
          // entirely. Loading here caused duplicate 10s+ SKILL.md fetches before
          // the first visible token.
          perf.mark('load_user_skills_skipped', {
            reason: analysisOnly ? 'analysisOnly' : 'deferred_to_system_prompt_manifest',
          });

          const needsPromptContext = !analysisOnly || (!image && !(snapshotImages?.length));
          let agentPrompt = prompt ?? '';
          let agentImage = image || (snapshotImages?.[currentSnapshotIndex ?? 0]) || '';
          let agentSnapshotImages = snapshotImages?.length ? snapshotImages : (agentImage ? [agentImage] : []);
          let agentCurrentSnapshotIndex = currentSnapshotIndex ?? Math.max(agentSnapshotImages.length - 1, 0);
          let agentCurrentDesign = currentDesign;
          let agentCurrentDesignPath = typeof currentDesignPath === 'string' ? currentDesignPath : undefined;
          let agentHistory: ModelMessage[] = [];
          let agentAudioAttachments = audioAttachments;
          let agentExplicitMediaIndices: number[] = [];
          let agentCompactionRequired = false;
          let agentHistoryBoundary: string | undefined;
          let agentStudioWorkflowStage: string | undefined;

          if (needsPromptContext) {
            // Unified context: both frontend and headless use buildPromptContext.
            // Analysis-only usually has the uploaded/current image in the request,
            // so it can skip this DB/history pass too.
            const endContext = perf.span('build_prompt_context', { projectId });
            const { buildPromptContext } = await import('@/lib/agent-context');
            const ctx = await buildPromptContext(projectId, supabase, userId, {
              userMessage: prompt ?? '',
              currentSnapshotIndex,
              hasAnnotation,
              isDraft,
              referenceImageCount: referenceImageCount || undefined,
              uploadedVideoCount: uploadedVideoCount || undefined,
              turnMediaCount: turnMediaCount || undefined,
              audioAttachments,
              currentRunId: runId,
              agentModelId: resolvedAgentModel.id,
              agentModelProvider: resolvedAgentModel.provider,
            });
            endContext({
              promptChars: ctx.fullPrompt.length,
              historyTurns: ctx.history.length,
              mediaCount: ctx.snapshotImages.length,
              hasCurrentDesign: !!ctx.currentDesign,
              currentDesignPath: ctx.currentDesignPath || null,
            });

            agentPrompt = ctx.fullPrompt;
            // Frontend may pass images directly (new uploads not yet in DB)
            agentImage = image || ctx.snapshotImages[ctx.currentSnapshotIndex] || '';
            agentSnapshotImages = snapshotImages?.length ? snapshotImages : ctx.snapshotImages;
            agentCurrentSnapshotIndex = ctx.currentSnapshotIndex;
            agentCurrentDesign = currentDesign || ctx.currentDesign;
            agentCurrentDesignPath = agentCurrentDesignPath || ctx.currentDesignPath;
            agentHistory = ctx.history;
            agentAudioAttachments = ctx.audioAttachments;
            agentExplicitMediaIndices = ctx.explicitMediaIndices;
            agentCompactionRequired = ctx.contextStats.compactionRequired;
            agentHistoryBoundary = ctx.historyBoundary;
            agentStudioWorkflowStage = ctx.activeStudioWorkflowStage;
          } else {
            perf.mark('build_prompt_context_skipped', {
              reason: 'analysisOnly_request_has_media',
              mediaCount: agentSnapshotImages.length,
            });
          }

          if (headless) {
            // Write user message to DB (frontend does this itself)
            const endHeadlessMessage = perf.span('headless_user_message_insert', { projectId });
            await supabase.from('messages').insert({
              id: crypto.randomUUID(),
              project_id: projectId,
              role: 'user',
              content: prompt ?? '',
              has_image: false,
            });
            endHeadlessMessage();
          }

          // Normal agent request — SSE heartbeat every 10s to prevent proxy idle timeout
          const modelAbortController = new AbortController();
          const heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); } catch { /* disconnected */ }
            if (writer) void writer.persistHeartbeat();
            if (runId) {
              void supabase.from('agent_runs').select('status').eq('id', runId).single()
                .then(({ data }) => {
                  if (data?.status !== 'running' && !modelAbortController.signal.aborted) {
                    modelAbortController.abort('Agent run reached a persisted terminal status');
                  }
                });
            }
          }, 10_000);
          // Periodically check if run was aborted (user clicked abort in CUI)
          let abortCheckCount = 0;
          const shouldStop = async (force = false) => {
            if (!runId || (!force && ++abortCheckCount % 10 !== 0)) return false; // check every ~10 events
            const { data } = await supabase.from('agent_runs').select('status').eq('id', runId).single();
            return data?.status !== 'running';
          };

          try {
            const endAgentStream = perf.span('agent_stream', { projectId, runId: runId || null });
            try {
              // The timeline lookup started during admission and normally
              // resolves while prompt context is being built.
              const timelineVersion = await timelineVersionPromise;
              for await (const event of runMakaronAgent(agentPrompt, agentImage, projectId, { analysisOnly, analysisContext, isVideoAnalysis, animationImageUrls: animationImageUrls?.length ? animationImageUrls : undefined, animationImages: animationImages?.length ? animationImages : undefined, locale, preferredModel, agentModel: requestedAgentModel, videoModel, videoResolution, videoAuto, skillLaunchContext, audioAttachments: agentAudioAttachments, snapshotImages: agentSnapshotImages, explicitMediaIndices: agentExplicitMediaIndices, currentSnapshotIndex: agentCurrentSnapshotIndex, isNsfw, supabase, userId: userId, codexSubscriptionAllowed, currentDesign: agentCurrentDesign, currentDesignPath: agentCurrentDesignPath, history: agentHistory, timelineVersion, perf, abortSignal: modelAbortController.signal, contextCompactAtTokens: agentCompactionRequired ? getAgentContextPolicy(resolvedAgentModel.id).providerCompactAtTokens : undefined, historyBoundary: agentHistoryBoundary, studioWorkflowStage: agentStudioWorkflowStage, agentRunId: runId || undefined })) {
                if (event.type === 'done') sawDone = true;
                if (event.type === 'error') {
                  sawError = true;
                  terminalError = event;
                }
                if (event.type === 'usage') { usageEvent = event; continue; }
                if (event.type === 'context_compaction') {
                  latestProviderCompaction = {
                    provider: event.provider,
                    modelId: event.modelId,
                    compactedThrough: event.compactedThrough,
                    summary: event.summary,
                    appliedEdits: event.appliedEdits,
                    item: event.item,
                    inputTokens: event.inputTokens,
                  };
                }
                if (writer) {
                  await writer.processAndEnqueue(event);
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
                // Check abort after processing event
                if (await shouldStop()) {
                  console.log('[agent] Run stopped by persisted terminal status');
                  wasStopped = true;
                  break;
                }
              }
              if (!sawDone && !sawError && await shouldStop(true)) wasStopped = true;
              if (writer && !sawDone && !sawError && !wasStopped) {
                terminalError = {
                  type: 'error',
                  code: 'missing_terminal_event',
                  recoverable: true,
                  message: translate(locale, 'agent.error.connectionEnded'),
                };
                sawError = true;
                await writer.processAndEnqueue(terminalError);
              }
            } finally {
              endAgentStream();
            }
          } finally {
            clearInterval(heartbeat);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('Agent stream error:', msg);
          const errorEvent = {
            type: 'error' as const,
            message: locale === 'zh' ? msg : translate(locale, 'agent.error.fatal'),
          };
          sawError = true;
          terminalError = errorEvent;
          if (writer) {
            try {
              await writer.processAndEnqueue(errorEvent);
            } catch (persistError) {
              console.error('Failed to persist terminal agent error:', persistError);
              writer.tryEnqueue(errorEvent);
            }
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
            );
          }
          // Finalization below atomically persists failed + terminal metadata.
        } finally {
          // Deduct credits based on token usage (fire-and-forget)
          if (usageEvent && shouldRequireAgentCredits(resolvedAgentModel.provider)) {
            const endBilling = perf.span('billing_deduct', { projectId, model: usageEvent.model });
            deductByTokens(
              userId, 'agent', usageEvent.model,
              usageEvent.inputTokens, usageEvent.outputTokens,
              undefined, undefined,
              {
                cacheRead: usageEvent.cacheReadTokens ?? 0,
                cacheWrite: usageEvent.cacheWriteTokens ?? 0,
                cacheWriteTelemetryComplete: usageEvent.cacheWriteTelemetryComplete,
              },
              usageEvent.providerCostUsd,
            )
              .then(() => endBilling({ ok: true }))
              .catch(e => {
                endBilling({ ok: false });
                console.error('[billing] agent deduct error:', e);
              });
          }

          if (writer) {
            const endWriterFlush = perf.span('writer_flush', { projectId, runId: runId || null });
            await writer.flush();
            endWriterFlush();
          }
          if (runId && latestProviderCompaction) {
            try {
              const { AgentExecutionStore, normalizeExecutionSnapshot } = await import('@/lib/agent-execution');
              const store = new AgentExecutionStore(supabase, userId, projectId);
              const snapshot = normalizeExecutionSnapshot({
                objective: prompt || 'Continue the current project conversation.',
                acceptanceCriteria: [],
                decisions: [],
                completedWork: [],
                artifacts: [],
                openQuestions: [],
                currentWorkUnit: 'agent',
                nextAction: 'Continue with the next user request using the compacted project history.',
                providerCompaction: latestProviderCompaction,
              }, {
                objective: prompt || 'Continue the current project conversation.',
                currentWorkUnit: 'agent',
                nextAction: 'Continue with the next user request.',
              });
              await store.saveSnapshot({
                runId,
                projectId,
                kind: 'project_provider_compaction',
                snapshot,
                providerCompaction: latestProviderCompaction as Record<string, unknown>,
              });
            } catch (compactionError) {
              console.error('[agent] Failed to persist provider compaction:', compactionError);
            }
          }
          // A closed transport is not completion evidence. Only an explicit
          // validated done event may transition a running run to completed.
          if (runId) {
            try {
              const endRunComplete = perf.span('complete_agent_run', { projectId, runId });
              const { data: run } = await supabase.from('agent_runs')
                .select('status, metadata').eq('id', runId).single();
              if (run?.status === 'running') {
                const terminalStatus = resolvePersistedRunStatus({
                  currentStatus: run.status,
                  sawDone,
                  sawError,
                });
                await supabase.from('agent_runs').update({
                  status: terminalStatus,
                  ended_at: new Date().toISOString(),
                  ...(terminalError ? {
                    metadata: {
                      ...((run.metadata as Record<string, unknown> | null) ?? {}),
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
              endRunComplete({ status: run?.status || null, sawDone, sawError });
            } catch { /* best effort */ }
          }
          // Headless: auto-name project only after a validated completion.
          if (headless && sawDone && !sawError && !wasStopped) {
            try {
              const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).single();
              if (proj?.title === 'Untitled' || !proj?.title) {
                // Use first snapshot description or prompt as name
                const { data: snap } = await supabase.from('snapshots')
                  .select('description').eq('project_id', projectId).order('sort_order').limit(1).single();
                const nameSource = snap?.description || (prompt ?? '').slice(0, 100);
                if (nameSource) {
                  const shortName = nameSource.replace(/[\n\r]/g, ' ').slice(0, 50).trim();
                  await supabase.from('projects').update({ title: shortName }).eq('id', projectId);
                }
              }
            } catch { /* best effort */ }
          }
          perf.mark('stream_close', { projectId, runId: runId || null });
          controller.close();
        }
      },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (runId) headers['X-Agent-Run-Id'] = runId;
    if (firstMessageId) headers['X-Agent-Message-Id'] = firstMessageId;

    return new Response(stream, { headers,
    });
  } catch (error) {
    console.error('Agent API error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process agent request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
