import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';

/**
 * GET /api/agent/run/[id] — Query run status and results.
 *
 * Returns: { status, eventCount, result? }
 * When status=completed, result includes final outputs (image URLs, video URLs, text).
 *
 * Query params:
 *   ?events=true — include all events (for full replay)
 *   ?after=N — only events with seq > N (for incremental polling)
 *   ?wait_for_artifacts=true — keep status as in_progress until video/music tasks also complete
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await authenticateRequest(req);
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    const { id: runId } = await params;

    // Get run status
    const { data: run } = await supabase.from('agent_runs')
      .select('id, status, prompt, started_at, ended_at, metadata, project_id, user_id')
      .eq('id', runId)
      .single();

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Security: only the run owner can query
    if (run.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const wantEvents = url.searchParams.get('events') === 'true';
    const afterSeq = url.searchParams.has('after') ? parseInt(url.searchParams.get('after')!) : undefined;
    const waitForArtifacts = url.searchParams.get('wait_for_artifacts') === 'true';

    // Get event count
    const { count: eventCount } = await supabase
      .from('agent_events')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);

    // Build result summary when completed (or in_progress for incremental results)
    let result: Record<string, unknown> | undefined;
    const isTerminal = run.status === 'completed' || run.status === 'failed';

    if (isTerminal || wantEvents) {
      const { data: events } = await supabase
        .from('agent_events')
        .select('type, data')
        .eq('run_id', runId)
        .in('type', ['image', 'render', 'animation_task', 'music_task', 'content', 'error'])
        .order('seq');

      const images: { snapshotId: string; imageUrl: string }[] = [];
      const designs: { snapshotId: string; code: string; width: number; height: number }[] = [];
      const videos: { taskId: string; prompt: string; status?: string; videoUrl?: string }[] = [];
      const music: { taskId: string; status?: string; audioUrl?: string }[] = [];
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
            ...(e.data.animation ? { animation: e.data.animation } : {}),
            ...(e.data.props ? { props: e.data.props } : {}),
          });
        } else if (e.type === 'animation_task') {
          videos.push({ taskId: e.data.taskId, prompt: e.data.prompt });
        } else if (e.type === 'music_task') {
          music.push({ taskId: e.data.taskId });
        } else if (e.type === 'content') {
          text += e.data?.text || '';
        } else if (e.type === 'error') {
          error = e.data?.message;
        }
      }

      // Enrich designs with poster image URL from snapshots table
      if (designs.length > 0) {
        const designSnapshotIds = designs.map(d => d.snapshotId).filter(Boolean);
        if (designSnapshotIds.length > 0) {
          const { data: snaps } = await supabase
            .from('snapshots')
            .select('id, image_url')
            .in('id', designSnapshotIds);
          if (snaps) {
            const urlMap = Object.fromEntries(snaps.map(s => [s.id, s.image_url]));
            for (const d of designs) {
              if (d.snapshotId && urlMap[d.snapshotId]) {
                (d as Record<string, unknown>).imageUrl = urlMap[d.snapshotId];
              }
            }
          }
        }
      }

      // Enrich video/music tasks with current status if completed
      if (isTerminal && (videos.length > 0 || music.length > 0)) {
        const enrichPromises: Promise<void>[] = [];

        for (const v of videos) {
          enrichPromises.push((async () => {
            try {
              const { data: anim } = await supabase
                .from('project_animations')
                .select('status, video_url')
                .eq('piapi_task_id', v.taskId)
                .single();
              if (anim) {
                v.status = anim.status;
                if (anim.video_url) v.videoUrl = anim.video_url;
              }
            } catch { /* best effort */ }
          })());
        }

        for (const m of music) {
          enrichPromises.push((async () => {
            try {
              const { data: track } = await supabase
                .from('project_music')
                .select('status, audio_url')
                .eq('suno_task_id', m.taskId)
                .limit(1)
                .maybeSingle();
              if (track) {
                m.status = track.status;
                if (track.audio_url) m.audioUrl = track.audio_url;
              }
            } catch { /* best effort */ }
          })());
        }

        await Promise.all(enrichPromises);
      }

      result = {
        images,
        designs,
        videos,
        music,
        text: text.trim(),
        ...(error ? { error } : {}),
      };

      // wait_for_artifacts: override status if video/music still processing
      if (waitForArtifacts && run.status === 'completed') {
        const hasPendingArtifacts = videos.some(v => v.status && v.status !== 'completed' && v.status !== 'failed')
          || music.some(m => m.status && m.status !== 'completed' && m.status !== 'failed');
        if (hasPendingArtifacts) {
          return NextResponse.json({
            runId: run.id,
            projectId: run.project_id,
            status: 'in_progress',
            prompt: run.prompt,
            eventCount: eventCount ?? 0,
            startedAt: run.started_at,
            endedAt: run.ended_at,
            result,
          });
        }
      }
    }

    // Optionally include raw events
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
