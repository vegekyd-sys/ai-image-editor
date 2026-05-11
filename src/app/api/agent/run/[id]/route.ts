import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';

/**
 * GET /api/agent/run/[id] — Query run status and results.
 *
 * Returns the Makaron Agent Contract v1 response:
 * - output[]: unified typed array of all artifacts (always populated, even during in_progress)
 * - status: "completed" only when ALL artifacts (including video/music renders) are ready
 * - result: legacy format (backward compat)
 *
 * Query params:
 *   ?events=true — include raw event log
 *   ?after=N — only events with seq > N (for incremental polling)
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

    const { data: run } = await supabase.from('agent_runs')
      .select('id, status, prompt, started_at, ended_at, metadata, project_id, user_id')
      .eq('id', runId)
      .single();

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const wantEvents = url.searchParams.get('events') === 'true';
    const afterSeq = url.searchParams.has('after') ? parseInt(url.searchParams.get('after')!) : undefined;

    const { count: eventCount } = await supabase
      .from('agent_events')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);

    // Always build output[] from events (not gated by isTerminal)
    const { data: rawEvents } = await supabase
      .from('agent_events')
      .select('type, data, seq, created_at')
      .eq('run_id', runId)
      .in('type', ['image', 'render', 'animation_task', 'music_task', 'content', 'error'])
      .order('seq');

    // Build output[] — unified typed artifact array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output: Record<string, any>[] = [];
    let textContent = '';
    let textSeq = 0;
    let errorMsg: string | undefined;
    let outputSeq = 0;

    // Legacy result (backward compat)
    const legacyImages: { snapshotId: string; imageUrl: string }[] = [];
    const legacyDesigns: Record<string, unknown>[] = [];
    const legacyVideos: { taskId: string; prompt?: string; status?: string; videoUrl?: string }[] = [];
    const legacyMusic: { taskId: string; status?: string; audioUrl?: string }[] = [];

    for (const e of rawEvents ?? []) {
      if (e.type === 'content') {
        textContent += e.data?.text || '';
        if (!textSeq) textSeq = e.seq;
      } else if (e.type === 'image' && e.data?.imageUrl) {
        output.push({
          id: `out_${++outputSeq}`,
          type: 'image',
          status: 'completed',
          url: e.data.imageUrl,
          snapshot_id: e.data.snapshotId,
          created_at: e.created_at,
        });
        legacyImages.push({ snapshotId: e.data.snapshotId, imageUrl: e.data.imageUrl });
      } else if (e.type === 'render' && e.data?.published && e.data?.code) {
        const isAnimated = !!e.data.animation;
        output.push({
          id: `out_${++outputSeq}`,
          type: 'design',
          status: 'completed',
          url: '', // will be enriched below
          snapshot_id: e.data.snapshotId,
          width: e.data.width,
          height: e.data.height,
          animated: isAnimated,
          ...(isAnimated ? { duration: e.data.animation.durationInSeconds, fps: e.data.animation.fps } : {}),
          created_at: e.created_at,
        });
        legacyDesigns.push({
          snapshotId: e.data.snapshotId,
          code: e.data.code,
          width: e.data.width,
          height: e.data.height,
          ...(e.data.animation ? { animation: e.data.animation } : {}),
          ...(e.data.props ? { props: e.data.props } : {}),
        });
      } else if (e.type === 'animation_task') {
        output.push({
          id: `out_${++outputSeq}`,
          type: 'video',
          status: 'queued',
          task_id: e.data.taskId,
          created_at: e.created_at,
        });
        legacyVideos.push({ taskId: e.data.taskId, prompt: e.data.prompt });
      } else if (e.type === 'music_task') {
        output.push({
          id: `out_${++outputSeq}`,
          type: 'music',
          status: 'queued',
          task_id: e.data.taskId,
          created_at: e.created_at,
        });
        legacyMusic.push({ taskId: e.data.taskId });
      } else if (e.type === 'error') {
        errorMsg = e.data?.message;
      }
    }

    // Add text as first output item if present
    if (textContent.trim()) {
      output.unshift({
        id: `out_text`,
        type: 'text',
        status: 'completed',
        content: textContent.trim(),
      });
    }

    // Enrich design URLs from snapshots table
    const designItems = output.filter(o => o.type === 'design' && o.snapshot_id);
    if (designItems.length > 0) {
      const ids = designItems.map(d => d.snapshot_id as string);
      const { data: snaps } = await supabase.from('snapshots').select('id, image_url').in('id', ids);
      if (snaps) {
        const urlMap = Object.fromEntries(snaps.map(s => [s.id, s.image_url]));
        for (const d of designItems) {
          if (urlMap[d.snapshot_id as string]) d.url = urlMap[d.snapshot_id as string];
        }
        for (const d of legacyDesigns) {
          if (d.snapshotId && urlMap[d.snapshotId as string]) d.imageUrl = urlMap[d.snapshotId as string];
        }
      }
    }

    // Enrich video/music with current render status (always, not just when terminal)
    const videoItems = output.filter(o => o.type === 'video');
    const musicItems = output.filter(o => o.type === 'music');
    const enrichPromises: Promise<void>[] = [];

    for (const v of videoItems) {
      enrichPromises.push((async () => {
        try {
          const { data: anim } = await supabase
            .from('project_animations')
            .select('status, video_url, created_at')
            .eq('piapi_task_id', v.task_id)
            .single();
          if (anim) {
            v.status = anim.status === 'processing' ? 'rendering' : anim.status;
            if (anim.video_url) v.url = anim.video_url;
            if (anim.status === 'processing' && anim.created_at) {
              v.elapsed_seconds = Math.round((Date.now() - new Date(anim.created_at).getTime()) / 1000);
            }
          }
        } catch { /* best effort */ }
      })());
      // Also update legacy
      const lv = legacyVideos.find(x => x.taskId === v.task_id);
      if (lv) enrichPromises.push((async () => {
        if (v.status) lv.status = v.status as string;
        if (v.url) lv.videoUrl = v.url as string;
      })());
    }

    for (const m of musicItems) {
      enrichPromises.push((async () => {
        try {
          const { data: track } = await supabase
            .from('project_music')
            .select('status, audio_url, created_at')
            .eq('suno_task_id', m.task_id)
            .limit(1)
            .maybeSingle();
          if (track) {
            m.status = track.status === 'processing' ? 'rendering' : track.status;
            if (track.audio_url) m.url = track.audio_url;
            if (track.status === 'processing' && track.created_at) {
              m.elapsed_seconds = Math.round((Date.now() - new Date(track.created_at).getTime()) / 1000);
            }
          }
        } catch { /* best effort */ }
      })());
      const lm = legacyMusic.find(x => x.taskId === m.task_id);
      if (lm) enrichPromises.push((async () => {
        if (m.status) lm.status = m.status as string;
        if (m.url) lm.audioUrl = m.url as string;
      })());
    }

    await Promise.all(enrichPromises);

    // Determine effective status:
    // - "completed" only when agent is done AND all video/music are terminal
    const agentDone = run.status === 'completed' || run.status === 'failed' || run.status === 'aborted';
    const hasPendingArtifacts = [...videoItems, ...musicItems].some(
      o => o.status === 'queued' || o.status === 'rendering'
    );
    const effectiveStatus = (agentDone && hasPendingArtifacts) ? 'in_progress' : run.status;
    const incomplete = effectiveStatus === 'in_progress' || effectiveStatus === 'queued';

    // Suggest poll interval based on state
    let nextPollAfterMs: number | undefined;
    if (incomplete) {
      if (hasPendingArtifacts) nextPollAfterMs = 10000; // video/music rendering: 10s
      else nextPollAfterMs = 3000; // agent still working: 3s
    }

    // Legacy result
    const result = {
      images: legacyImages,
      designs: legacyDesigns,
      videos: legacyVideos,
      music: legacyMusic,
      text: textContent.trim(),
      ...(errorMsg ? { error: errorMsg } : {}),
    };

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
      id: run.id,
      status: effectiveStatus,
      incomplete,
      project_id: run.project_id,
      project_url: `https://www.makaron.app/projects/${run.project_id}`,
      prompt: run.prompt,
      created_at: run.started_at,
      completed_at: run.ended_at,
      ...(nextPollAfterMs ? { next_poll_after_ms: nextPollAfterMs } : {}),
      ...(agentDone && hasPendingArtifacts ? { agent_status: 'completed' } : {}),
      output,
      eventCount: eventCount ?? 0,
      result, // legacy
      ...(errorMsg ? { error: { code: 'agent_error', message: errorMsg } } : {}),
      ...(events ? { events } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
