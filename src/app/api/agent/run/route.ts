import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runMakaronAgent } from '@/lib/agent';
import { AgentDualWriter } from '@/lib/agentDualWriter';
import { buildPromptContext } from '@/lib/agent-context';

export const maxDuration = 300;

/**
 * POST /api/agent/run — Fire-and-forget agent execution.
 *
 * Accepts (projectId, prompt) and runs the agent in the background.
 * Returns immediately with { runId }. Client polls /api/agent/run/[id] for status.
 * All results are written to DB via DualWriter (no SSE needed).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      projectId,
      prompt,
      currentSnapshotIndex,
      hasAnnotation,
      isDraft,
      referenceImageCount,
      preferredModel,
      isNsfw,
    } = await req.json();

    if (!projectId || !prompt) {
      return NextResponse.json(
        { error: 'projectId and prompt are required' },
        { status: 400 },
      );
    }

    const locale = req.cookies.get('locale')?.value ?? 'en';

    // Mark stale running runs as failed
    await supabase.from('agent_runs')
      .update({ status: 'failed', ended_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .eq('status', 'running');

    // Create run
    const { data: run } = await supabase.from('agent_runs').insert({
      project_id: projectId,
      user_id: user.id,
      status: 'running',
      prompt: prompt.slice(0, 500),
      metadata: { locale, preferredModel, isNsfw, headless: true },
    }).select('id').single();

    const runId = run?.id;
    if (!runId) {
      return NextResponse.json({ error: 'Failed to create run' }, { status: 500 });
    }

    // Build context from DB (no frontend needed)
    const ctx = await buildPromptContext(projectId, supabase, user.id, {
      userMessage: prompt,
      currentSnapshotIndex,
      hasAnnotation,
      isDraft,
      referenceImageCount,
    });

    // DualWriter in headless mode (no SSE controller)
    const writer = new AgentDualWriter(runId, supabase, user.id, projectId);

    // Store firstMessageId in run metadata
    await supabase.from('agent_runs').update({
      metadata: { locale, preferredModel, isNsfw, headless: true, firstMessageId: writer.firstMessageId },
    }).eq('id', runId);

    // Load user skills
    const { getAllSkills } = await import('@/lib/workspace');
    const allSkills = await getAllSkills(supabase, user.id);
    const userSkills = allSkills.filter(s => !s.makaron?.builtIn);

    // Run agent after response is sent — next/server after() keeps the function alive
    after(async () => {
      let abortCheckCount = 0;
      const isAborted = async () => {
        if (++abortCheckCount % 10 !== 0) return false;
        const { data } = await supabase.from('agent_runs').select('status').eq('id', runId).single();
        return data?.status === 'aborted';
      };

      try {
        for await (const event of runMakaronAgent(ctx.fullPrompt, ctx.snapshotImages[ctx.currentSnapshotIndex] || '', projectId, {
          originalImage: ctx.originalImage,
          locale,
          preferredModel,
          snapshotImages: ctx.snapshotImages,
          currentSnapshotIndex: ctx.currentSnapshotIndex,
          isNsfw,
          userSkills: userSkills.length ? userSkills : undefined,
          supabase,
          userId: user.id,
          currentDesign: ctx.currentDesign,
        })) {
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
      const { data: finalRun } = await supabase.from('agent_runs')
        .select('status').eq('id', runId).single();
      if (finalRun?.status === 'running') {
        await supabase.from('agent_runs').update({
          status: 'completed', ended_at: new Date().toISOString(),
        }).eq('id', runId);
      }
      console.log(`[agent/run] Run ${runId} completed`);
    });

    return NextResponse.json({ runId, status: 'running' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent/run] Request error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
