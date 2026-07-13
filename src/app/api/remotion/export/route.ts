import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import {
  createRemotionExportJob,
  resolveRemotionExportDownloadUrl,
  runRemotionExportJob,
  type RemotionExportOutputType,
  type RemotionRenderProfile,
} from '@/lib/remotion-export'

export const maxDuration = 1800

function appUrl(req: NextRequest): string {
  return process.env.MAKARON_APP_URL || new URL(req.url).origin
}

function shouldRunInlineExportFallback(): boolean {
  return process.env.REMOTION_EXPORT_INLINE_AFTER !== 'false'
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req)
    if ('error' in authResult) return authResult.error
    const { userId } = authResult.auth

    const body = await req.json()
    const projectId = body.projectId || body.project_id
    const snapshotId = body.snapshotId || body.snapshot_id
    const designPath = body.designPath || body.design_path
    const outputType = (body.outputType || body.output_type || 'video') as RemotionExportOutputType
    const renderProfile = (body.renderProfile || body.render_profile || 'fast_720p') as RemotionRenderProfile
    const publish = body.publish === true
    const publishSnapshotId = body.publishSnapshotId || body.publish_snapshot_id
      || (publish && outputType === 'video' ? crypto.randomUUID() : undefined)
    const name = typeof body.name === 'string' ? body.name : undefined

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }
    if (!snapshotId && !designPath && !body.design) {
      return NextResponse.json({ error: 'snapshotId, designPath, or design is required' }, { status: 400 })
    }
    if (outputType !== 'video' && outputType !== 'image') {
      return NextResponse.json({ error: 'outputType must be video or image' }, { status: 400 })
    }
    if (renderProfile !== 'fast_720p' && renderProfile !== 'source') {
      return NextResponse.json({ error: 'renderProfile must be fast_720p or source' }, { status: 400 })
    }

    const job = await createRemotionExportJob({
      userId,
      projectId,
      snapshotId,
      designPath,
      design: body.design,
      outputType,
      renderProfile,
      publish,
      publishSnapshotId,
      name,
    })

    if (shouldRunInlineExportFallback()) {
      after(async () => {
        try {
          await runRemotionExportJob(job.id)
        } catch (err) {
          console.error('[remotion/export] job failed:', err)
        }
      })
    }

    const downloadUrl = await resolveRemotionExportDownloadUrl(job)
    return NextResponse.json({
      jobId: job.id,
      id: job.id,
      status: job.status,
      projectId: job.project_id,
      project_id: job.project_id,
      url: downloadUrl,
      storageUrl: downloadUrl,
      storage_url: downloadUrl,
      fingerprint: job.fingerprint || (typeof job.metadata?.fingerprint === 'string' ? job.metadata.fingerprint : undefined),
      duration_seconds: job.duration_seconds,
      render_seconds: job.render_seconds,
      realtime_ratio: job.realtime_ratio,
      width: job.width,
      height: job.height,
      fps: job.fps,
      exportUrl: `${appUrl(req)}/api/remotion/export/${job.id}`,
      next_poll_after_ms: 3000,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg === 'Forbidden' ? 403 : msg === 'Project not found' ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
