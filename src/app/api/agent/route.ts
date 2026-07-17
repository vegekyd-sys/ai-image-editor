import { NextRequest } from 'next/server';
import type { ModelMessage } from 'ai';
import { authenticateRequest } from '@/lib/api-auth';
import { runMakaronAgent, withLocale } from '@/lib/agent';
import { AgentDualWriter } from '@/lib/agentDualWriter';
import { requireCredits, deductByTokens } from '@/lib/billing/credits';
import { AgentPerf } from '@/lib/agent-perf';
import { getRequestLocale } from '@/lib/server-locale';
import { resolvePersistedRunStatus } from '@/lib/agent-terminal';
import { translate } from '@/lib/locales';
import {
  normalizeRequestedAgentModelPreference,
  resolveAgentModelSpec,
} from '@/lib/agent-models';

export const maxDuration = 1800;

export async function POST(req: NextRequest) {
  const perf = new AgentPerf('agent-api', { route: '/api/agent' });
  try {
    const endAuth = perf.span('authenticate');
    const authResult = await authenticateRequest(req);
    endAuth({ ok: !('error' in authResult) });
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    // Pre-flight credit check
    const endCreditCheck = perf.span('credit_check', { userId });
    const creditCheck = await requireCredits(userId, 5);
    endCreditCheck({ ok: creditCheck.ok });
    if (!creditCheck.ok) return creditCheck.response;

    const endReadBody = perf.span('read_body');
    const { prompt, image, animationImageUrls, animationImages, projectId, analysisOnly, analysisContext, isVideoAnalysis,
            tipReaction, committedTip, tipsTeaser, tipsPayload, nameProject, description,
            previewsReady, readyTips, preferredModel, agentModel, snapshotImages, currentSnapshotIndex, isNsfw,
            musicReady, musicAudioUrl, currentDesign, currentDesignPath, videoModel, videoResolution, videoAuto,
            headless, hasAnnotation, isDraft, referenceImageCount, uploadedVideoCount, turnMediaCount, audioAttachments } = await req.json();
    endReadBody({
      projectId: projectId || null,
      promptChars: typeof prompt === 'string' ? prompt.length : 0,
      hasImage: !!image,
      headless: !!headless,
    });
    const locale = getRequestLocale(req);

    const requestedAgentModel = normalizeRequestedAgentModelPreference(agentModel);
    if (requestedAgentModel === null) {
      return new Response(
        JSON.stringify({ error: 'Unsupported agentModel' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const resolvedAgentModel = resolveAgentModelSpec(requestedAgentModel, process.env.AGENT_MODEL);

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

    // Query timeline version for video-in-timeline support
    const endProjectLoad = perf.span('load_project', { projectId });
    const { data: projectRow } = await supabase.from('projects').select('timeline_version').eq('id', projectId).single();
    endProjectLoad({ timelineVersion: (projectRow as Record<string, unknown>)?.timeline_version as number ?? 1 });
    const timelineVersion: number = (projectRow as Record<string, unknown>)?.timeline_version as number ?? 1;

    let runId: string | null = null;
    let firstMessageId: string | null = null;
    if (isNormalMode) {
      const endRunCreate = perf.span('create_agent_run', { projectId, userId });
      // Supersede any prior run. `aborted` is observable by the old worker;
      // `failed` was not, so the old model could keep producing side effects.
      await supabase.from('agent_runs')
        .update({ status: 'aborted', ended_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .eq('status', 'running');

      const { data: run } = await supabase.from('agent_runs').insert({
        project_id: projectId,
        user_id: userId,
        status: 'running',
        prompt: (prompt ?? '').slice(0, 500),
        metadata: {
          locale,
          preferredModel,
          requestedAgentModel: requestedAgentModel ?? 'auto',
          agentModel: resolvedAgentModel.id,
          agentProviderModel: resolvedAgentModel.providerModelId,
          isNsfw,
          analysisOnly,
        },
      }).select('id').single();
      runId = run?.id ?? null;
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
        // Track token usage for billing
        let usageEvent: Extract<import('@/lib/agent').AgentStreamEvent, { type: 'usage' }> | null = null;
        let sawDone = false;
        let sawError = false;
        let wasStopped = false;
        let terminalError: Extract<import('@/lib/agent').AgentStreamEvent, { type: 'error' }> | null = null;

        // Helper: iterate agent stream, capture usage event
        async function iterateAgent(gen: AsyncIterable<import('@/lib/agent').AgentStreamEvent>, ctrl: ReadableStreamDefaultController) {
          for await (const event of gen) {
            if (event.type === 'usage') { usageEvent = event; continue; } // capture, don't send to client
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        }

        // Create dual writer if normal mode with a valid run
        const writer = (runId && isNormalMode)
          ? new AgentDualWriter(runId, supabase, userId, projectId, controller, encoder)
          : null;
        if (writer) {
          await writer.persistHeartbeat();
          firstMessageId = writer.firstMessageId;
          // Store firstMessageId in run metadata for reconnect
          supabase.from('agent_runs').update({
            metadata: {
              locale,
              preferredModel,
              requestedAgentModel: requestedAgentModel ?? 'auto',
              agentModel: resolvedAgentModel.id,
              agentProviderModel: resolvedAgentModel.providerModelId,
              isNsfw,
              analysisOnly,
              firstMessageId,
            },
          }).eq('id', runId).then(() => {});
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
            const teaserPrompt = withLocale(
              `Here are edit suggestions for a photo:\n${tipsSummary}\n\nPick the most interesting one. Write a single teaser sentence (under 15 words) starting with "Try...". Output only that sentence.`,
              locale,
            );
            await iterateAgent(runMakaronAgent(teaserPrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel,
            }), controller);
            return;
          }

          // nameProject: generate a short project name from image description
          if (nameProject) {
            const desc = (description as string) || '';
            const namePrompt = withLocale(
              `Based on this photo description, give a concise project name (2-4 words): ${desc}. Output only the name, no punctuation or explanation.`,
              locale,
            );
            await iterateAgent(runMakaronAgent(namePrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel,
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
            const readyPrompt = withLocale(
              `All ${tips.length} edit suggestion previews are ready:\n${tipsSummary}\n\nIn 1-2 sentences, tell the user previews are ready and they can scroll TipsBar. Comment on one interesting one. Friendly tone, don't start with "I".`,
              locale,
            );
            await iterateAgent(runMakaronAgent(readyPrompt, '', projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel,
            }), controller);
            return;
          }

          // musicReady: background music generation completed — agent injects <Audio> into the composition
          if (musicReady && musicAudioUrl) {
            const musicPrompt = withLocale(
              `Background music is ready: ${musicAudioUrl}\n\nFirst, briefly tell the user the music is ready and you're adding it to the video now (1 sentence). Then: load the latest Remotion composition code from workspace (list_files to find it, read_file to load), add <Audio src="${musicAudioUrl}" volume={0.3} /> to it, and call run_code with runtime: "composition" to render the updated version with music.`,
              locale,
            );
            await iterateAgent(runMakaronAgent(musicPrompt, image || '', projectId, {
              locale, agentModel: requestedAgentModel,
              snapshotImages, currentSnapshotIndex, supabase, userId: userId,
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
            const reactionPrompt = withLocale(
              `User just committed an edit via TipsBar:\n${tip.emoji} ${tip.label} (${tip.category}): ${tip.desc}\n\nReact naturally in 1 sentence, like a friend. Then in 1 short sentence, inspire what direction they could explore next with this photo (e.g. mood, lighting, story element) — but do NOT recommend specific tips. Don't start with "I".`,
              locale,
            );
            await iterateAgent(runMakaronAgent(reactionPrompt, image, projectId, {
              tipReactionOnly: true, locale, agentModel: requestedAgentModel,
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
              for await (const event of runMakaronAgent(agentPrompt, agentImage, projectId, { analysisOnly, analysisContext, isVideoAnalysis, animationImageUrls: animationImageUrls?.length ? animationImageUrls : undefined, animationImages: animationImages?.length ? animationImages : undefined, locale, preferredModel, agentModel: requestedAgentModel, videoModel, videoResolution, videoAuto, audioAttachments: agentAudioAttachments, snapshotImages: agentSnapshotImages, currentSnapshotIndex: agentCurrentSnapshotIndex, isNsfw, supabase, userId: userId, currentDesign: agentCurrentDesign, currentDesignPath: agentCurrentDesignPath, history: agentHistory, timelineVersion, perf, abortSignal: modelAbortController.signal })) {
                if (event.type === 'done') sawDone = true;
                if (event.type === 'error') {
                  sawError = true;
                  terminalError = event;
                }
                if (event.type === 'usage') { usageEvent = event; continue; }
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
          const errorEvent = { type: 'error' as const, message: msg };
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
          if (usageEvent) {
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
