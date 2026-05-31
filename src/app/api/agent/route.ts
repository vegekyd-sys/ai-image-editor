import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { runMakaronAgent, withLocale } from '@/lib/agent';
import { AgentDualWriter } from '@/lib/agentDualWriter';
import { requireCredits, deductByTokens } from '@/lib/billing/credits';
import { AgentPerf } from '@/lib/agent-perf';

export const maxDuration = 800;

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
    const { prompt, image, originalImage, animationImageUrls, animationImages, projectId, analysisOnly, analysisContext, isVideoAnalysis,
            tipReaction, committedTip, currentTips, tipsTeaser, tipsPayload, nameProject, description,
            previewsReady, readyTips, preferredModel, snapshotImages, currentSnapshotIndex, isNsfw,
            musicReady, musicAudioUrl, currentDesign, videoModel,
            headless, hasAnnotation, isDraft, referenceImageCount, uploadedVideoCount } = await req.json();
    endReadBody({
      projectId: projectId || null,
      promptChars: typeof prompt === 'string' ? prompt.length : 0,
      hasImage: !!image,
      headless: !!headless,
    });
    const locale = req.cookies.get('locale')?.value ?? 'zh';

    if (!projectId || (!tipsTeaser && !nameProject && !previewsReady && !uploadedVideoCount && !image && !prompt)) {
      return new Response(
        JSON.stringify({ error: 'projectId and (image or prompt) are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const MOCK_TEXTS = {
      tipsTeaser: '试试把它变成微缩模型？特别适合这种场景。',
      tipReaction: '效果很棒！新图很自然。',
      nameProject: '咖啡下午茶',
      previewsReady: '预览图都好了！那个模仿猴的创意太逗了，快去试试看~',
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
      // Mark any stale running runs as failed before creating a new one
      await supabase.from('agent_runs')
        .update({ status: 'failed', ended_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .eq('status', 'running');

      const { data: run } = await supabase.from('agent_runs').insert({
        project_id: projectId,
        user_id: userId,
        status: 'running',
        prompt: (prompt ?? '').slice(0, 500),
        metadata: { locale, preferredModel, isNsfw, analysisOnly },
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
          text: locale === 'en' ? 'Starting...' : '开始处理...',
        });
        perf.mark('first_sse_sent', { eventType: 'status' });
        // Track token usage for billing
        let usageEvent: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; model: string } | null = null;

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
          firstMessageId = writer.firstMessageId;
          // Store firstMessageId in run metadata for reconnect
          supabase.from('agent_runs').update({
            metadata: { locale, preferredModel, isNsfw, analysisOnly, firstMessageId },
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
            await iterateAgent(runMakaronAgent(teaserPrompt, '', projectId, { tipReactionOnly: true, locale }), controller);
            return;
          }

          // nameProject: generate a short project name from image description
          if (nameProject) {
            const desc = (description as string) || '';
            const namePrompt = withLocale(
              `Based on this photo description, give a concise project name (2-4 words): ${desc}. Output only the name, no punctuation or explanation.`,
              locale,
            );
            await iterateAgent(runMakaronAgent(namePrompt, '', projectId, { tipReactionOnly: true, locale }), controller);
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
            await iterateAgent(runMakaronAgent(readyPrompt, '', projectId, { tipReactionOnly: true, locale }), controller);
            return;
          }

          // musicReady: background music generation completed — agent injects <Audio> into design
          if (musicReady && musicAudioUrl) {
            const musicPrompt = withLocale(
              `Background music is ready: ${musicAudioUrl}\n\nFirst, briefly tell the user the music is ready and you're adding it to the video now (1 sentence). Then: load the latest design code from workspace (list_files to find it, read_file to load), add <Audio src="${musicAudioUrl}" volume={0.3} /> to it, and call run_code to render the updated version with music.`,
              locale,
            );
            await iterateAgent(runMakaronAgent(musicPrompt, image || '', projectId, {
              locale, snapshotImages, currentSnapshotIndex, supabase, userId: userId,
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
            await iterateAgent(runMakaronAgent(reactionPrompt, image, projectId, { tipReactionOnly: true, locale }), controller);
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
          let agentOriginalImage = originalImage || image || '';
          let agentSnapshotImages = snapshotImages?.length ? snapshotImages : (agentImage ? [agentImage] : []);
          let agentCurrentSnapshotIndex = currentSnapshotIndex ?? Math.max(agentSnapshotImages.length - 1, 0);
          let agentCurrentDesign = currentDesign;
          let agentHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

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
            });
            endContext({
              promptChars: ctx.fullPrompt.length,
              historyTurns: ctx.history.length,
              mediaCount: ctx.snapshotImages.length,
              hasCurrentDesign: !!ctx.currentDesign,
            });

            agentPrompt = ctx.fullPrompt;
            // Frontend may pass images directly (new uploads not yet in DB)
            agentImage = image || ctx.snapshotImages[ctx.currentSnapshotIndex] || '';
            agentOriginalImage = originalImage || ctx.originalImage;
            agentSnapshotImages = snapshotImages?.length ? snapshotImages : ctx.snapshotImages;
            agentCurrentSnapshotIndex = ctx.currentSnapshotIndex;
            agentCurrentDesign = currentDesign || ctx.currentDesign;
            agentHistory = ctx.history;
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
          const heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); } catch { /* disconnected */ }
          }, 10_000);
          // Periodically check if run was aborted (user clicked abort in CUI)
          let abortCheckCount = 0;
          const isAborted = async () => {
            if (!runId || ++abortCheckCount % 10 !== 0) return false; // check every ~10 events
            const { data } = await supabase.from('agent_runs').select('status').eq('id', runId).single();
            return data?.status === 'aborted';
          };

          try {
            const endAgentStream = perf.span('agent_stream', { projectId, runId: runId || null });
            try {
              for await (const event of runMakaronAgent(agentPrompt, agentImage, projectId, { analysisOnly, analysisContext, isVideoAnalysis, originalImage: agentOriginalImage, animationImageUrls: animationImageUrls?.length ? animationImageUrls : undefined, animationImages: animationImages?.length ? animationImages : undefined, locale, preferredModel, videoModel, snapshotImages: agentSnapshotImages, currentSnapshotIndex: agentCurrentSnapshotIndex, isNsfw, supabase, userId: userId, currentDesign: agentCurrentDesign, history: agentHistory, timelineVersion, perf })) {
                if (event.type === 'usage') { usageEvent = event; continue; }
                if (writer) {
                  await writer.processAndEnqueue(event);
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
                // Check abort after processing event
                if (await isAborted()) {
                  console.log('[agent] Run aborted by user');
                  break;
                }
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
          if (writer) {
            await writer.processAndEnqueue(errorEvent);
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
            );
          }
          // Mark run as failed
          if (runId) {
            try {
              await supabase.from('agent_runs').update({
                status: 'failed',
                ended_at: new Date().toISOString(),
              }).eq('id', runId);
            } catch { /* best effort */ }
          }
        } finally {
          // Deduct credits based on token usage (fire-and-forget)
          if (usageEvent) {
            const endBilling = perf.span('billing_deduct', { projectId, model: usageEvent.model });
            deductByTokens(
              userId, 'agent', usageEvent.model,
              usageEvent.inputTokens, usageEvent.outputTokens,
              undefined, undefined,
              { cacheRead: usageEvent.cacheReadTokens ?? 0, cacheWrite: usageEvent.cacheWriteTokens ?? 0 },
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
          // Mark run as completed
          if (runId) {
            try {
              const endRunComplete = perf.span('complete_agent_run', { projectId, runId });
              const { data: run } = await supabase.from('agent_runs')
                .select('status').eq('id', runId).single();
              if (run?.status === 'running') {
                await supabase.from('agent_runs').update({
                  status: 'completed',
                  ended_at: new Date().toISOString(),
                }).eq('id', runId);
              }
              endRunComplete({ status: run?.status || null });
            } catch { /* best effort */ }
          }
          // Headless: auto-name project if still "Untitled"
          if (headless) {
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
