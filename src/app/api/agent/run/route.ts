import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { runMakaronAgent, withLocale } from '@/lib/agent';
import { AgentDualWriter } from '@/lib/agentDualWriter';
import { buildPromptContext } from '@/lib/agent-context';
import { requireCredits, deductByTokens } from '@/lib/billing/credits';
import { getRequestLocale } from '@/lib/server-locale';

export const maxDuration = 800;

/**
 * POST /api/agent/run — Fire-and-forget agent execution.
 *
 * Accepts (projectId, prompt) and runs the agent in the background.
 * Returns immediately with { runId }. Client polls /api/agent/run/[id] for status.
 * All results are written to DB via DualWriter (no SSE needed).
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req);
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    const {
      projectId,
      prompt,
      currentSnapshotIndex,
      hasAnnotation,
      isDraft,
      referenceImageCount,
      preferredModel,
      isNsfw,
      videoModel,
      videoResolution,
      videoAuto,
      audioAttachments,
    } = await req.json();

    if (!projectId || !prompt) {
      return NextResponse.json(
        { error: 'projectId and prompt are required' },
        { status: 400 },
      );
    }

    // Pre-flight credit check
    const creditCheck = await requireCredits(userId, 5);
    if (!creditCheck.ok) return creditCheck.response;

    const locale = getRequestLocale(req);

    // Query timeline version
    const { data: projectRow } = await supabase.from('projects').select('timeline_version').eq('id', projectId).single();
    const timelineVersion: number = (projectRow as Record<string, unknown>)?.timeline_version as number ?? 1;

    // Mark stale running runs as failed
    await supabase.from('agent_runs')
      .update({ status: 'failed', ended_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('status', 'running');

    // Create run
    const { data: run } = await supabase.from('agent_runs').insert({
      project_id: projectId,
      user_id: userId,
      status: 'running',
      prompt: prompt.slice(0, 500),
      metadata: { locale, preferredModel, isNsfw, headless: true },
    }).select('id').single();

    const runId = run?.id;
    if (!runId) {
      return NextResponse.json({ error: 'Failed to create run' }, { status: 500 });
    }

    // Build context from DB (no frontend needed)
    const ctx = await buildPromptContext(projectId, supabase, userId, {
      userMessage: prompt,
      currentSnapshotIndex,
      hasAnnotation,
      isDraft,
      referenceImageCount,
      audioAttachments,
    });

    // Write user message to DB (frontend does this itself, headless mode must do it here)
    const userMessageId = crypto.randomUUID();
    await supabase.from('messages').insert({
      id: userMessageId,
      project_id: projectId,
      role: 'user',
      content: prompt,
      has_image: false,
    });

    // DualWriter in headless mode (no SSE controller)
    const writer = new AgentDualWriter(runId, supabase, userId, projectId);

    // Store firstMessageId in run metadata
    await supabase.from('agent_runs').update({
      metadata: { locale, preferredModel, isNsfw, headless: true, firstMessageId: writer.firstMessageId },
    }).eq('id', runId);

    // Load user skills
    const { getAllSkills } = await import('@/lib/workspace');
    const allSkills = await getAllSkills(supabase, userId);
    const userSkills = allSkills.filter(s => !s.makaron?.builtIn);

    // Run agent after response is sent — next/server after() keeps the function alive
    after(async () => {
      let abortCheckCount = 0;
      let streamFailed = false;
      const isAborted = async () => {
        if (++abortCheckCount % 10 !== 0) return false;
        const { data } = await supabase.from('agent_runs').select('status').eq('id', runId).single();
        return data?.status === 'aborted';
      };

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheReadTokens = 0;
      let totalCacheWriteTokens = 0;
      let agentModel = '';
      try {
        for await (const event of runMakaronAgent(ctx.fullPrompt, ctx.snapshotImages[ctx.currentSnapshotIndex] || '', projectId, {
          locale,
          preferredModel,
          videoModel,
          videoResolution,
          videoAuto,
          audioAttachments: ctx.audioAttachments,
          snapshotImages: ctx.snapshotImages,
          currentSnapshotIndex: ctx.currentSnapshotIndex,
          isNsfw,
          userSkills: userSkills.length ? userSkills : undefined,
          supabase,
          userId: userId,
          currentDesign: ctx.currentDesign,
          currentDesignPath: ctx.currentDesignPath,
          history: ctx.history,
          timelineVersion,
        })) {
          if (event.type === 'error') streamFailed = true;
          if (event.type === 'usage') {
            totalInputTokens += event.inputTokens ?? 0;
            totalOutputTokens += event.outputTokens ?? 0;
            totalCacheReadTokens += event.cacheReadTokens ?? 0;
            totalCacheWriteTokens += event.cacheWriteTokens ?? 0;
            if (event.model) agentModel = event.model;
          }
          await writer.processAndEnqueue(event);
          if (await isAborted()) {
            console.log(`[agent/run] Run ${runId} aborted`);
            break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[agent/run] Run ${runId} error:`, msg);
        await writer.processAndEnqueue({ type: 'error', message: msg });
        await supabase.from('agent_runs').update({
          status: 'failed', ended_at: new Date().toISOString(),
        }).eq('id', runId);
        return;
      }

      await writer.flush();
      // Deduct agent LLM tokens
      if (totalInputTokens > 0 || totalOutputTokens > 0 || totalCacheReadTokens > 0 || totalCacheWriteTokens > 0) {
        deductByTokens(
          userId, 'agent', agentModel || 'unknown',
          totalInputTokens, totalOutputTokens,
          undefined, undefined,
          { cacheRead: totalCacheReadTokens, cacheWrite: totalCacheWriteTokens },
        ).catch(e => console.error('[agent/run] billing error:', e));
      }
      const { data: finalRun } = await supabase.from('agent_runs')
        .select('status').eq('id', runId).single();
      if (finalRun?.status === 'running') {
        await supabase.from('agent_runs').update({
          status: streamFailed ? 'failed' : 'completed', ended_at: new Date().toISOString(),
        }).eq('id', runId);
      }

      // Auto-name project if still Untitled
      try {
        const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).single();
        if (proj && (!proj.title || proj.title === 'Untitled' || proj.title === '未命名' || proj.title === '未命名项目')) {
          const nameSource = prompt.slice(0, 200);
          if (nameSource.trim()) {
            const namePrompt = withLocale(
              `Based on this user request, give a concise project name (2-4 words, no quotes): "${nameSource}". Output only the name.`,
              locale,
            );
            let projectName = '';
            for await (const ev of runMakaronAgent(namePrompt, '', projectId, { tipReactionOnly: true, locale })) {
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

      console.log(`[agent/run] Run ${runId} ${streamFailed ? 'failed' : 'completed'}`);
    });

    return NextResponse.json({ runId, status: 'running' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent/run] Request error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
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
