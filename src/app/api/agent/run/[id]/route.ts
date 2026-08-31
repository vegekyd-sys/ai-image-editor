import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { isPermanentUrl } from '@/lib/supabase/storage';
import { buildVideoFailureActions } from '@/lib/artifact-actions';
import { dispatchAgentExecutionAttempt } from '@/lib/agent-execution-dispatch';
import { extractStudioDeliveryVideo } from '@/lib/agent-run-artifacts';
import { resolveWorkspaceFile } from '@/lib/workspace';
import { normalizeLocale, translate } from '@/lib/locales';

type RunProject = { is_public?: boolean } | Array<{ is_public?: boolean }>;

const DEFAULT_AGENT_RUN_STALE_MS = 90_000;

function getAgentRunStaleMs(): number {
  const configured = Number(process.env.AGENT_RUN_STALE_MS || DEFAULT_AGENT_RUN_STALE_MS);
  return Number.isFinite(configured)
    ? Math.max(45_000, Math.min(configured, 10 * 60_000))
    : DEFAULT_AGENT_RUN_STALE_MS;
}

function extractSavedDraftPath(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as Record<string, unknown>;
  const value = record.value && typeof record.value === 'object'
    ? record.value as Record<string, unknown>
    : record;
  return typeof value.path === 'string' && value.path.trim() ? value.path : undefined;
}

function normalizeMediaIdentity(value?: string | null): string | null {
  if (!value) return null;
  return value.split('#')[0].split('?')[0];
}

function dedupeVideoOutputs<T extends Record<string, unknown>>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (item.type !== 'video') {
      result.push(item);
      continue;
    }
    const url = normalizeMediaIdentity(typeof item.url === 'string' ? item.url : undefined);
    const taskId = typeof item.task_id === 'string' ? item.task_id : undefined;
    const key = url ? `url:${url}` : (taskId ? `task:${taskId}` : '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupeLegacyVideos<T extends { videoUrl?: string; taskId?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const url = normalizeMediaIdentity(item.videoUrl);
    const key = url ? `url:${url}` : (item.taskId ? `task:${item.taskId}` : '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(item);
  }
  return result;
}

async function pollVideoProvider(taskId: string): Promise<{ taskId: string; status: string; videoUrl?: string; error?: string }> {
  const isEvolink = taskId.startsWith('task-unified-');
  const isMuleRouter = taskId.startsWith('mr-wan30-');
  const isSeedance = taskId.startsWith('cgt-');
  const isMotionControl = taskId.startsWith('mc-');
  const isXai = taskId.startsWith('xai-');
  const isGoogleOmni = taskId.startsWith('google-omni-');
  const isMinimax = taskId.startsWith('minimax-h3-');
  const isSyncLipsync = taskId.startsWith('sync3-');
  const realTaskId = isMotionControl ? taskId.slice(3) : taskId;

  if (isMuleRouter) {
    const { getMuleRouterVideoTask } = await import('@/lib/mulerouter-video');
    return getMuleRouterVideoTask(taskId);
  } else if (isEvolink) {
    const { getEvolinkTask } = await import('@/lib/evolink');
    return getEvolinkTask(taskId);
  } else if (isSeedance) {
    const { getSeedanceTask } = await import('@/lib/seedance');
    return getSeedanceTask(taskId);
  } else if (isMotionControl) {
    const { getKlingMotionControlTask } = await import('@/lib/kling');
    const result = await getKlingMotionControlTask(realTaskId);
    return { ...result, taskId };
  } else if (isXai) {
    const { getXaiVideoTask } = await import('@/lib/xai-video');
    return getXaiVideoTask(taskId);
  } else if (isGoogleOmni) {
    const { getGoogleOmniVideoTask } = await import('@/lib/google-omni-video');
    return getGoogleOmniVideoTask(taskId);
  } else if (isMinimax) {
    const { getMinimaxVideoTask } = await import('@/lib/minimax-video');
    return getMinimaxVideoTask(taskId);
  } else if (isSyncLipsync) {
    const { getSyncLipsyncTask } = await import('@/lib/sync-lipsync');
    return getSyncLipsyncTask(taskId);
  } else {
    const { getKlingTask } = await import('@/lib/kling');
    return getKlingTask(taskId);
  }
}

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
    const { id: runId } = await params;
    const admin = getSupabaseAdmin();
    const authResult = await authenticateRequest(req);
    const authUserId = 'auth' in authResult ? authResult.auth.userId : null;
    const hasBearerAuth = req.headers.get('authorization')?.startsWith('Bearer ') ?? false;

    const { data: run } = await admin.from('agent_runs')
      .select('id, status, prompt, started_at, ended_at, metadata, project_id, user_id, execution_policy, lease_expires_at, next_attempt_at, projects(is_public)')
      .eq('id', runId)
      .single();

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const projects = (run as { projects?: RunProject }).projects;
    const project = Array.isArray(projects) ? projects[0] : projects;
    const isPublic = project?.is_public === true;
    if (!isPublic && (!authUserId || run.user_id !== authUserId)) {
      return 'error' in authResult ? authResult.error : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (hasBearerAuth && 'error' in authResult) return authResult.error;
    const ownerUserId = run.user_id as string;
    const locale = normalizeLocale(
      (run.metadata as Record<string, unknown> | null)?.locale as string | undefined,
      'en',
    );

    // A platform hard-kill cannot run route finally blocks. Heartbeats make
    // that failure observable: after the lease expires, atomically close the
    // run and preserve the latest saved write_file draft as a resume point.
    if (run.status === 'running') {
      const { data: lastEvent } = await admin
        .from('agent_events')
        .select('created_at')
        .eq('run_id', runId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastActivityAt = Date.parse(lastEvent?.created_at || run.started_at || '') || 0;
      if (lastActivityAt > 0 && Date.now() - lastActivityAt > getAgentRunStaleMs()) {
        const executionPolicy = run.execution_policy as Record<string, unknown> | null;
        const durable = executionPolicy?.durable === true;
        const leaseExpired = !run.lease_expires_at || Date.parse(run.lease_expires_at) <= Date.now();
        if (durable && leaseExpired) {
          // Do not clear an expired lease here. Several CLI/CUI pollers may
          // observe the same stale row; the runner's claim RPC is the single
          // atomic gate and prevents a late poller from erasing a fresh lease.
          after(async () => {
            try {
              await dispatchAgentExecutionAttempt(runId, req.nextUrl.origin);
            } catch (error) {
              console.error(`[agent/run] durable reconciliation failed for ${runId}:`, error);
            }
          });
        } else if (!durable) {
        const { data: draftRows } = await admin
          .from('agent_tool_history')
          .select('output')
          .eq('run_id', runId)
          .eq('tool_name', 'write_file')
          .order('created_at', { ascending: false })
          .limit(5);
        const draftPath = (draftRows || [])
          .map((row: { output?: unknown }) => extractSavedDraftPath(row.output))
          .find(Boolean);
        const message = draftPath
          ? translate(locale, 'agent.error.runtimeDraftSaved')
          : translate(locale, 'agent.error.runtimeNoDraft');
        const metadata = {
          ...((run.metadata as Record<string, unknown> | null) ?? {}),
          terminal: {
            code: 'stale_run_lease_expired',
            recoverable: Boolean(draftPath),
            checkpoint: draftPath ? { draftPath, lastTool: 'write_file' } : undefined,
            message,
          },
        };
        const { data: reconciled } = await admin
          .from('agent_runs')
          .update({ status: 'failed', ended_at: new Date().toISOString(), metadata })
          .eq('id', runId)
          .eq('status', 'running')
          .select('status, ended_at, metadata')
          .maybeSingle();
        if (reconciled) Object.assign(run, reconciled);
        }
      }
    }

    const url = new URL(req.url);
    const wantEvents = url.searchParams.get('events') === 'true';
    const afterSeq = url.searchParams.has('after') ? parseInt(url.searchParams.get('after')!) : undefined;

    const { count: eventCount } = await admin
      .from('agent_events')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);

    // Always build output[] from events (not gated by isTerminal)
    const { data: rawEvents } = await admin
      .from('agent_events')
      .select('type, data, seq, created_at')
      .eq('run_id', runId)
      .in('type', ['image', 'render', 'animation_task', 'video_snapshot', 'music_task', 'studio_run', 'content', 'error'])
      .order('seq');

    // Build output[] — unified typed artifact array

    const output: Record<string, any>[] = [];
    let textContent = '';
    let textSeq = 0;
    let errorMsg: string | undefined;
    let outputSeq = 0;

    // Legacy result (backward compat)
    const legacyImages: { snapshotId: string; imageUrl: string }[] = [];
    const legacyDesigns: Record<string, unknown>[] = [];
    const legacyVideos: { taskId: string; prompt?: string; status?: string; videoUrl?: string; completionActions?: unknown }[] = [];
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
      } else if (e.type === 'video_snapshot') {
        output.push({
          id: `out_${++outputSeq}`,
          type: 'video',
          status: 'queued',
          task_id: e.data.taskId,
          snapshot_id: e.data.snapshotId,
          poster_url: e.data.posterUrl,
          created_at: e.created_at,
        });
        legacyVideos.push({ taskId: e.data.taskId, prompt: e.data.videoMeta?.prompt });
      } else if (e.type === 'music_task') {
        output.push({
          id: `out_${++outputSeq}`,
          type: 'music',
          status: 'queued',
          task_id: e.data.taskId,
          created_at: e.created_at,
        });
        legacyMusic.push({ taskId: e.data.taskId });
      } else if (e.type === 'studio_run' && e.data?.runId) {
        output.push({
          id: `out_${++outputSeq}`,
          type: 'studio_run',
          status: e.data.status || 'running',
          run_id: e.data.runId,
          title: e.data.title,
          recipe: e.data.recipe,
          current_stage: e.data.currentStage,
          approval_policy: e.data.approvalPolicy,
          stages: e.data.stages,
          state_path: e.data.statePath,
          artifact_path: e.data.artifactPath,
          invalidated: e.data.invalidated,
          created_at: e.created_at,
        });
      } else if (e.type === 'error') {
        errorMsg = e.data?.message;
      }
    }

    // A terminal error is also stored on the run row. Use it when an event
    // insert was interrupted so reconnect never turns a failed run silent.
    if (!errorMsg && run.status === 'failed') {
      const terminal = (run.metadata as Record<string, unknown> | null)?.terminal as Record<string, unknown> | undefined;
      if (typeof terminal?.message === 'string' && terminal.message.trim()) {
        errorMsg = terminal.message;
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
      const { data: snaps } = await admin.from('snapshots').select('id, image_url').in('id', ids);
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

    // A long materialize_media call can finish its durable side effect just as
    // an execution attempt hands off. In that narrow case the video Snapshot
    // and Studio delivery artifact are durable, but the transient
    // video_snapshot event is absent. Recover only from this run's completed
    // delivery record so concurrent project runs cannot leak into each other.
    if (run.status === 'completed') {
      const { data: studioToolRows } = await admin
        .from('agent_tool_history')
        .select('input, created_at')
        .eq('run_id', runId)
        .eq('tool_name', 'studio_run')
        .order('created_at', { ascending: false })
        .limit(20);
      const deliveryVideo = extractStudioDeliveryVideo(studioToolRows);
      if (deliveryVideo) {
        const { data: candidateSnapshots } = await admin
          .from('snapshots')
          .select('id, image_url, video_meta, created_at')
          .eq('project_id', run.project_id)
          .eq('type', 'video')
          .gte('created_at', run.started_at)
          .order('created_at', { ascending: false })
          .limit(20);
        let deliveryUrl = /^https?:\/\//i.test(deliveryVideo.outputPath)
          ? deliveryVideo.outputPath
          : undefined;
        const deliveryIdentity = normalizeMediaIdentity(deliveryUrl);
        const snapshot = (candidateSnapshots ?? []).find(candidate => {
          const meta = candidate.video_meta as Record<string, unknown> | null;
          const videoPath = typeof meta?.videoPath === 'string' ? meta.videoPath : undefined;
          const videoUrl = typeof meta?.videoUrl === 'string' ? meta.videoUrl : undefined;
          return videoPath === deliveryVideo.outputPath
            || (deliveryIdentity !== null && normalizeMediaIdentity(videoUrl) === deliveryIdentity);
        });
        const meta = snapshot?.video_meta as Record<string, unknown> | null;
        if (!deliveryUrl && typeof meta?.videoUrl === 'string') deliveryUrl = meta.videoUrl;
        if (!deliveryUrl && !/^https?:\/\//i.test(deliveryVideo.outputPath)) {
          const handle = await resolveWorkspaceFile(deliveryVideo.outputPath, admin, ownerUserId);
          if (typeof handle?.storageUrl === 'string') deliveryUrl = handle.storageUrl;
        }
        if (!deliveryUrl || !isPermanentUrl(deliveryUrl)) {
          deliveryUrl = undefined;
        }
        const resolvedDeliveryIdentity = normalizeMediaIdentity(deliveryUrl);
        const taskId = typeof meta?.taskId === 'string' ? meta.taskId : `studio-delivery-${runId}`;
        const alreadyIndexed = output.some(item =>
          item.type === 'video'
          && ((snapshot?.id && item.snapshot_id === snapshot.id)
            || (resolvedDeliveryIdentity !== null
              && normalizeMediaIdentity(typeof item.url === 'string' ? item.url : undefined) === resolvedDeliveryIdentity))
        );
        if (deliveryUrl && !alreadyIndexed) {
          output.push({
            id: `out_${++outputSeq}`,
            type: 'video',
            status: 'completed',
            url: deliveryUrl,
            task_id: taskId,
            snapshot_id: snapshot?.id,
            poster_url: snapshot?.image_url,
            width: typeof meta?.width === 'number' ? meta.width : undefined,
            height: typeof meta?.height === 'number' ? meta.height : undefined,
            duration: typeof meta?.duration === 'number' ? meta.duration : undefined,
            created_at: snapshot?.created_at || deliveryVideo.createdAt,
          });
          legacyVideos.push({
            taskId,
            prompt: typeof meta?.prompt === 'string' ? meta.prompt : undefined,
            status: 'completed',
            videoUrl: deliveryUrl,
            completionActions: meta?.completionActions,
          });
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
          // v2 path: video_snapshot events have snapshot_id — query snapshots table
          if (v.snapshot_id) {
            const { data: snap } = await admin
              .from('snapshots')
              .select('id, project_id, video_meta, image_url')
              .eq('id', v.snapshot_id)
              .single();
            if (!snap?.video_meta) return;

            const videoMeta = snap.video_meta as any;
            if (videoMeta.status === 'completed' && videoMeta.videoUrl) {
              // Only return completed if URL is our Storage (not provider URL)
              const isPermanent = isPermanentUrl(videoMeta.videoUrl);
              if (isPermanent) {
                v.status = 'completed';
                v.url = videoMeta.videoUrl;
                if (videoMeta.width) v.width = videoMeta.width;
                if (videoMeta.height) v.height = videoMeta.height;
                if (Array.isArray(videoMeta.completionActions) && videoMeta.completionActions.length) {
                  v.completion_actions = videoMeta.completionActions;
                }
                after(async () => {
                  const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair');
                  await ensureVideoPosterForSnapshot({
                    admin: getSupabaseAdmin(),
                    ownerUserId,
                    projectId: snap.project_id,
                    snapshotId: v.snapshot_id as string,
                    videoUrl: videoMeta.videoUrl,
                    currentImageUrl: snap.image_url,
                  });
                });
              } else {
                // Still persisting to Storage — tell CLI to keep polling
                v.status = 'rendering';
                if (videoMeta.createdAt) {
                  v.elapsed_seconds = Math.round((Date.now() - new Date(videoMeta.createdAt).getTime()) / 1000);
                }
                const snapshotId = v.snapshot_id as string;
                const projectId = snap.project_id;
                const providerVideoUrl = videoMeta.videoUrl as string;
                after(async () => {
                  try {
                    const { uploadVideo } = await import('@/lib/supabase/storage');
                    const { probeMP4Dimensions } = await import('@/lib/mp4-probe');
                    const buffer = providerVideoUrl.startsWith('https://generativelanguage.googleapis.com/') || providerVideoUrl.startsWith('data:')
                      ? await (await import('@/lib/google-omni-video')).fetchGoogleOmniVideoBytes(providerVideoUrl)
                      : new Uint8Array(await (await fetch(providerVideoUrl)).arrayBuffer());
                    const dims = probeMP4Dimensions(buffer) || { width: 1080, height: 1920 };
                    const adminClient = getSupabaseAdmin();
                    const permanentUrl = await uploadVideo(adminClient, ownerUserId, projectId, snapshotId, buffer);
                    if (permanentUrl) {
                      const finalMeta = { ...videoMeta, videoUrl: permanentUrl, providerUrl: providerVideoUrl, videoPath: `${ownerUserId}/projects/${projectId}/animation/${snapshotId}.mp4`, width: dims.width, height: dims.height };
                      await adminClient.from('snapshots')
                        .update({ video_meta: finalMeta })
                        .eq('id', snapshotId);
                      const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair');
                      await ensureVideoPosterForSnapshot({
                        admin: adminClient,
                        ownerUserId,
                        projectId,
                        snapshotId,
                        videoUrl: permanentUrl,
                        currentImageUrl: snap.image_url,
                        videoBuffer: buffer,
                      });
                    }
                  } catch (err) {
                    console.error('Video persist error:', err);
                  }
                });
              }
            } else if (videoMeta.status === 'failed') {
              v.status = 'failed';
              v.error = videoMeta.error;
              v.completion_actions = buildVideoFailureActions(videoMeta, locale);
            } else if (videoMeta.status === 'processing' && videoMeta.taskId) {
              if (typeof videoMeta.taskId === 'string' && videoMeta.taskId.startsWith('google-omni-job-') && !videoMeta.videoUrl && !videoMeta.providerUrl) {
                v.status = 'rendering';
                if (videoMeta.createdAt) {
                  v.elapsed_seconds = Math.round((Date.now() - new Date(videoMeta.createdAt).getTime()) / 1000);
                }
                return;
              }
              // Actively poll provider API
              try {
                const taskId = videoMeta.taskId as string;
                const pollResult = await pollVideoProvider(taskId);
                if (pollResult.status === 'completed' && pollResult.videoUrl) {
                  const updatedMeta = { ...videoMeta, status: 'completed', videoUrl: pollResult.videoUrl };
                  await admin.from('snapshots')
                    .update({ video_meta: updatedMeta })
                    .eq('id', v.snapshot_id);
                  // Don't return provider URL — wait for Storage persist (next poll will have permanent URL)
                  v.status = 'rendering';
                  if (videoMeta.createdAt) {
                    v.elapsed_seconds = Math.round((Date.now() - new Date(videoMeta.createdAt).getTime()) / 1000);
                  }
                  // Persist to Storage in background
                  const snapshotId = v.snapshot_id as string;
                  const projectId = snap.project_id;
                  after(async () => {
                    try {
                      const { uploadVideo } = await import('@/lib/supabase/storage');
                      const { probeMP4Dimensions } = await import('@/lib/mp4-probe');
                      const buffer = pollResult.videoUrl!.startsWith('https://generativelanguage.googleapis.com/') || pollResult.videoUrl!.startsWith('data:')
                        ? await (await import('@/lib/google-omni-video')).fetchGoogleOmniVideoBytes(pollResult.videoUrl!)
                        : new Uint8Array(await (await fetch(pollResult.videoUrl!)).arrayBuffer());
                      const dims = probeMP4Dimensions(buffer) || { width: 1080, height: 1920 };
                      const adminClient = getSupabaseAdmin();
                      const permanentUrl = await uploadVideo(adminClient, ownerUserId, projectId, snapshotId, buffer);
                      if (permanentUrl) {
                        const finalMeta = { ...updatedMeta, videoUrl: permanentUrl, videoPath: `${ownerUserId}/projects/${projectId}/animation/${snapshotId}.mp4`, width: dims.width, height: dims.height };
                        await adminClient.from('snapshots')
                          .update({ video_meta: finalMeta })
                          .eq('id', snapshotId);
                        const { ensureVideoPosterForSnapshot } = await import('@/lib/video-poster-repair');
                        await ensureVideoPosterForSnapshot({
                          admin: adminClient,
                          ownerUserId,
                          projectId,
                          snapshotId,
                          videoUrl: permanentUrl,
                          currentImageUrl: snap.image_url,
                          videoBuffer: buffer,
                        });
                      }
                    } catch (err) {
                      console.error('Video snapshot persist error:', err);
                    }
                  });
                } else if (pollResult.status === 'failed') {
                  const { handleVideoFailure } = await import('@/lib/video-lifecycle');
                  await handleVideoFailure(v.snapshot_id, pollResult.error);
                  v.status = 'failed';
                  v.error = pollResult.error;
                  v.completion_actions = buildVideoFailureActions({ ...videoMeta, status: 'failed', error: pollResult.error }, locale);
                } else {
                  v.status = 'rendering';
                  if (videoMeta.createdAt) {
                    v.elapsed_seconds = Math.round((Date.now() - new Date(videoMeta.createdAt).getTime()) / 1000);
                  }
                }
              } catch {
                v.status = 'rendering';
                if (videoMeta.createdAt) {
                  v.elapsed_seconds = Math.round((Date.now() - new Date(videoMeta.createdAt).getTime()) / 1000);
                }
              }
            } else {
              v.status = videoMeta.status === 'processing' ? 'rendering' : videoMeta.status;
              if (Array.isArray(videoMeta.completionActions) && videoMeta.completionActions.length) {
                v.completion_actions = videoMeta.completionActions;
              }
              if (videoMeta.status === 'failed') {
                v.completion_actions = buildVideoFailureActions(videoMeta, locale);
              }
            }
            return;
          }

          // v1 path: animation_task events — query project_animations table
          const { data: anim } = await admin
            .from('project_animations')
            .select('id, status, video_url, created_at, project_id, projects(user_id)')
            .eq('piapi_task_id', v.task_id)
            .single();
          if (anim) {
            if (anim.status === 'processing') {
              try {
                const taskId = v.task_id as string;
                const result = await pollVideoProvider(taskId);
                if (result.status === 'completed' && result.videoUrl) {
                  const admin = getSupabaseAdmin();
                  await admin.from('project_animations')
                    .update({ status: 'completed', video_url: result.videoUrl })
                    .eq('piapi_task_id', taskId);
                  v.status = 'completed';
                  v.url = result.videoUrl;

                  const projects = anim.projects as any;
                  const ownerUserId = Array.isArray(projects) ? projects[0]?.user_id : projects?.user_id;
                  if (anim.project_id && ownerUserId) {
                    const videoUrl = result.videoUrl;
                    const animId = anim.id;
                    const projectId = anim.project_id;
                    const ownerId = ownerUserId as string;
                    after(async () => {
                      try {
                        const { uploadVideo } = await import('@/lib/supabase/storage');
                        const res = await fetch(videoUrl);
                        if (!res.ok) return;
                        const buffer = new Uint8Array(await res.arrayBuffer());
                        const adminClient = getSupabaseAdmin();
                        const permanentUrl = await uploadVideo(adminClient, ownerId, projectId, animId, buffer);
                        if (permanentUrl) {
                          await adminClient.from('project_animations')
                            .update({ video_url: permanentUrl })
                            .eq('id', animId);
                        }
                      } catch (err) {
                        console.error('Video persist error:', err);
                      }
                    });
                  }
                } else if (result.status === 'failed') {
                  const admin = getSupabaseAdmin();
                  await admin.from('project_animations')
                    .update({ status: 'failed' })
                    .eq('piapi_task_id', taskId);
                  v.status = 'failed';
                  v.error = result.error;
                } else {
                  v.status = 'rendering';
                  if (anim.created_at) {
                    v.elapsed_seconds = Math.round((Date.now() - new Date(anim.created_at).getTime()) / 1000);
                  }
                }
              } catch {
                v.status = 'rendering';
                if (anim.created_at) {
                  v.elapsed_seconds = Math.round((Date.now() - new Date(anim.created_at).getTime()) / 1000);
                }
              }
            } else {
              v.status = anim.status === 'processing' ? 'rendering' : anim.status;
              if (anim.video_url) v.url = anim.video_url;
            }
          }
        } catch { /* best effort */ }
      })());
    }

    for (const m of musicItems) {
      enrichPromises.push((async () => {
        try {
          const { data: track } = await admin
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
    }

    await Promise.all(enrichPromises);

    // Sync legacy video/music after enrich completes
    for (const v of videoItems) {
      const lv = legacyVideos.find(x => x.taskId === v.task_id);
      if (lv) {
        if (v.status) lv.status = v.status as string;
        if (v.url) lv.videoUrl = v.url as string;
        if (v.completion_actions) lv.completionActions = v.completion_actions;
      }
    }
    for (const m of musicItems) {
      const lm = legacyMusic.find(x => x.taskId === m.task_id);
      if (lm) {
        if (m.status) lm.status = m.status as string;
        if (m.url) lm.audioUrl = m.url as string;
      }
    }

    // Determine effective status:
    // - "completed" only when agent is done AND all video/music are terminal
    const hasPendingArtifacts = [...videoItems, ...musicItems].some(
      o => o.status === 'queued' || o.status === 'rendering'
    );
    const hasFailedArtifacts = [...videoItems, ...musicItems].some(
      o => o.status === 'failed'
    );
    const agentDone = run.status === 'completed' || run.status === 'failed' || run.status === 'aborted';
    const effectiveStatus = agentDone && hasPendingArtifacts
      ? 'in_progress'
      : (agentDone && run.status === 'completed' && hasFailedArtifacts ? 'failed' : run.status);
    const incomplete = effectiveStatus === 'running' || effectiveStatus === 'in_progress' || effectiveStatus === 'queued';

    // Suggest poll interval based on state
    let nextPollAfterMs: number | undefined;
    if (incomplete) {
      if (hasPendingArtifacts) nextPollAfterMs = 10000; // video/music rendering: 10s
      else nextPollAfterMs = 3000; // agent still working: 3s
    }

    // Legacy result
    const finalOutput = dedupeVideoOutputs(output);
    const finalLegacyVideos = dedupeLegacyVideos(legacyVideos);

    const result = {
      images: legacyImages,
      designs: legacyDesigns,
      videos: finalLegacyVideos,
      music: legacyMusic,
      text: textContent.trim(),
      ...(errorMsg ? { error: errorMsg } : {}),
    };

    // Optionally include raw events
    let events: unknown[] | undefined;
    if (wantEvents) {
      let query = admin
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
      first_message_id: (run.metadata as Record<string, unknown> | null)?.firstMessageId,
      prompt: run.prompt,
      created_at: run.started_at,
      completed_at: run.ended_at,
      ...(nextPollAfterMs ? { next_poll_after_ms: nextPollAfterMs } : {}),
      // Agent execution and async artifacts have separate lifecycles. The
      // aggregate status stays in_progress while video/music renders, but CUI
      // clients must be able to release the composer as soon as the agent
      // itself has stopped.
      ...(agentDone ? { agent_status: run.status } : {}),
      output: finalOutput,
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
