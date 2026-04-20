import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/agent/run/[id] — Query run status and results.
 *
 * Returns: { status, eventCount, result? }
 * When status=completed, result includes final outputs (image URLs, video URLs, text).
 *
 * Query params:
 *   ?events=true — include all events (for full replay)
 *   ?after=N — only events with seq > N (for incremental polling)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: runId } = await params;

    // Get run status
    const { data: run } = await supabase.from('agent_runs')
      .select('id, status, prompt, started_at, ended_at, metadata, project_id')
      .eq('id', runId)
      .single();

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Security: only the run owner can query
    if (run.metadata?.userId && run.metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const wantEvents = url.searchParams.get('events') === 'true';
    const afterSeq = url.searchParams.has('after') ? parseInt(url.searchParams.get('after')!) : undefined;

    // Get event count
    const { count: eventCount } = await supabase
      .from('agent_events')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);

    // Build result summary when completed
    let result: Record<string, unknown> | undefined;
    if (run.status === 'completed' || run.status === 'failed') {
      // Get final outputs: images, designs, videos, text
      const { data: events } = await supabase
        .from('agent_events')
        .select('type, data')
        .eq('run_id', runId)
        .in('type', ['image', 'render', 'animation_task', 'content', 'error'])
        .order('seq');

      const images: { snapshotId: string; imageUrl: string }[] = [];
      const designs: { snapshotId: string; code: string; width: number; height: number }[] = [];
      const videos: { taskId: string; prompt: string }[] = [];
      let text = '';
      let error: string | undefined;

      for (const e of events ?? []) {
        if (e.type === 'image' && e.data?.imageUrl) {
          images.push({ snapshotId: e.data.snapshotId, imageUrl: e.data.imageUrl });
        } else if (e.type === 'render' && e.data?.published && e.data?.code) {
          designs.push({
            snapshotId: e.data.snapshotId,
            code: e.data.code,
            width: e.data.width,
            height: e.data.height,
          });
        } else if (e.type === 'animation_task') {
          videos.push({ taskId: e.data.taskId, prompt: e.data.prompt });
        } else if (e.type === 'content') {
          text += e.data?.text || '';
        } else if (e.type === 'error') {
          error = e.data?.message;
        }
      }

      result = {
        images,
        designs,
        videos,
        text: text.trim(),
        ...(error ? { error } : {}),
      };
    }

    // Optionally include events
    let events: unknown[] | undefined;
    if (wantEvents) {
      let query = supabase
        .from('agent_events')
        .select('type, data, seq, created_at')
        .eq('run_id', runId)
        .order('seq');

      if (afterSeq !== undefined) {
        query = query.gt('seq', afterSeq);
      }

      const { data } = await query.limit(1000);
      events = data ?? [];
    }

    return NextResponse.json({
      runId: run.id,
      projectId: run.project_id,
      status: run.status,
      prompt: run.prompt,
      eventCount: eventCount ?? 0,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      ...(result ? { result } : {}),
      ...(events ? { events } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
