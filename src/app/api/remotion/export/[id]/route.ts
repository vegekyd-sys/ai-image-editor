import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { getRemotionExportJob, resolveRemotionExportDownloadUrl } from '@/lib/remotion-export'

async function normalizeJob(job: NonNullable<Awaited<ReturnType<typeof getRemotionExportJob>>>) {
  const downloadUrl = await resolveRemotionExportDownloadUrl(job)
  return {
    id: job.id,
    jobId: job.id,
    status: job.status,
    projectId: job.project_id,
    project_id: job.project_id,
    snapshotId: job.snapshot_id,
    snapshot_id: job.snapshot_id,
    designPath: job.design_path,
    design_path: job.design_path,
    outputType: job.output_type,
    output_type: job.output_type,
    publish: job.publish,
    progress: job.progress,
    workspacePath: job.workspace_path,
    workspace_path: job.workspace_path,
    url: downloadUrl,
    storageUrl: downloadUrl,
    storage_url: downloadUrl,
    contentType: job.content_type,
    content_type: job.content_type,
    fingerprint: job.fingerprint || (typeof job.metadata?.fingerprint === 'string' ? job.metadata.fingerprint : undefined),
    duration_seconds: job.duration_seconds,
    render_seconds: job.render_seconds,
    realtime_ratio: job.realtime_ratio,
    width: job.width,
    height: job.height,
    fps: job.fps,
    error: job.error,
    workerId: job.worker_id,
    worker_id: job.worker_id,
    heartbeat_at: job.heartbeat_at,
    metadata: job.metadata,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    ...(job.status === 'queued' || job.status === 'rendering' ? { next_poll_after_ms: 3000 } : {}),
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId } = authResult.auth
    const { id } = await params

    const job = await getRemotionExportJob(id)
    if (!job) return NextResponse.json({ error: 'Export job not found' }, { status: 404 })
    if (job.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    return NextResponse.json(await normalizeJob(job))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
