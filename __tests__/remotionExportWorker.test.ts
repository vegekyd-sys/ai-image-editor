import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolveRemotionRenderProfile } from '@/lib/remotion-export'
import { resolveRemotionLambdaEncodingSettings } from '@/lib/remotion-encoding'
import { readAgentRuntimeSource } from './helpers/agentRuntimeSource'

const read = (path: string) => readFileSync(path, 'utf-8')

describe('Remotion export worker contract', () => {
  it('uses 720p output profile by default for portrait compositions', () => {
    expect(resolveRemotionRenderProfile({ width: 1080, height: 1920 })).toMatchObject({
      profile: 'fast_720p',
      width: 720,
      height: 1280,
      sourceWidth: 1080,
      sourceHeight: 1920,
    })
  })

  it('uses true 720p for landscape-ish compositions', () => {
    expect(resolveRemotionRenderProfile({ width: 1080, height: 960 })).toMatchObject({
      profile: 'fast_720p',
      width: 810,
      height: 720,
      sourceWidth: 1080,
      sourceHeight: 960,
    })
  })

  it('can preserve source dimensions when requested', () => {
    expect(resolveRemotionRenderProfile({ width: 1080, height: 1920 }, 'source')).toMatchObject({
      profile: 'source',
      width: 1080,
      height: 1920,
      scale: 1,
    })
  })

  it('uses CRF/default video bitrate for downloadable Lambda exports', () => {
    expect(resolveRemotionLambdaEncodingSettings()).toEqual({
      videoBitrate: null,
      audioBitrate: '128k',
    })
  })

  it('adds a durable export job table with timing metrics', () => {
    const migration = read('supabase/migrations/20260607000000_remotion_export_jobs.sql')

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS remotion_export_jobs')
    expect(migration).toContain('duration_seconds numeric')
    expect(migration).toContain('render_seconds numeric')
    expect(migration).toContain('realtime_ratio numeric')
    expect(migration).toContain('workspace_path text')
    expect(migration).toContain('storage_url text')
    expect(migration).toContain("metadata->>'fingerprint'")
    expect(migration).toContain('worker_id text')
    expect(migration).toContain('heartbeat_at timestamptz')
    expect(migration).toContain('idx_remotion_export_jobs_status_created')
  })

  it('deduplicates concurrent active exports for the same composition', () => {
    const migration = read('supabase/migrations/20260717000000_dedupe_active_remotion_exports.sql')
    const exporter = read('src/lib/remotion-export.ts')

    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_remotion_export_jobs_active_fingerprint')
    expect(migration).toContain("WHERE status IN ('queued', 'rendering')")
    expect(exporter).toContain("error?.code === '23505'")
    expect(exporter).toContain(".in('status', ['rendering', 'queued'])")
  })

  it('renders MP4s server-side and records workspace output', () => {
    const server = read('src/lib/remotion-server.ts')
    const exporter = read('src/lib/remotion-export.ts')
    const nextConfig = read('next.config.ts')

    expect(server).toContain('renderMediaOnVercel')
    expect(server).toContain('export async function renderDesignVideo')
    expect(server).toContain('scale?: number')
    expect(server).toContain('scale,')
    expect(exporter).toContain('runRemotionExportJob')
    expect(exporter).toContain('runRemotionExportJobAndWait')
    expect(exporter).toContain("if (job.status === 'completed')")
    expect(exporter).toContain('The database row is the canonical completion signal')
    expect(exporter).toContain('runNextRemotionExportJob')
    expect(exporter).toContain('checkRemotionExportQueueReady')
    expect(exporter).toContain('resolveRemotionExportDownloadUrl')
    expect(exporter).toContain('ResponseContentDisposition')
    expect(exporter).toContain("export type RemotionRenderProfile = 'fast_720p' | 'source'")
    expect(exporter).toContain('resolveRemotionRenderProfile')
    expect(exporter).toContain('metadata.renderProfile')
    expect(exporter).toContain('fingerprintDesign')
    expect(exporter).toContain("renderer: 'remotion-export-v6-font-runtime-pinned'")
    expect(exporter).toContain('fontCatalogVersion: REMOTION_FONT_CATALOG_VERSION')
    expect(exporter).toContain('fontRuntimeVersion: REMOTION_FONT_RUNTIME_VERSION')
    expect(exporter).toContain('editableRuntimeVersion: REMOTION_EDITABLE_RUNTIME_VERSION')
    expect(exporter).toContain("lambdaServeUrl: readEnv('REMOTION_LAMBDA_SERVE_URL') || null")
    expect(exporter).toContain('fontSubstitutions: design.fontSubstitutions || null')
    expect(exporter).toContain('publishSnapshotIds')
    expect(exporter).toContain('completeStudioRunForExport')
    expect(exporter).toContain('completePersistedStudioRunFromMaterialization')
    expect(exporter).toContain('metadata.studioRunId')
    expect(exporter).toContain('promotedReusableExport')
    expect(exporter).toContain('reusableNeedsPromotion')
    expect(exporter).toContain('Reusable export promotion failed')
    expect(exporter).toContain(".eq('status', 'queued')")
    expect(exporter).toContain('REMOTION_EXPORT_STALE_MS')
    expect(exporter).toContain('isStaleRenderingJob')
    expect(exporter).toContain('reclaimedPreviousHeartbeatAt')
    expect(exporter).toContain('workspace.writeFile(workspacePath, buffer')
    expect(exporter).toContain('realtime_ratio')
    expect(exporter).toContain("readEnv('REMOTION_RENDERER') === 'lambda'")
    expect(exporter).toContain("replace(/\\\\[rn]|[\\u0000-\\u001F\\u007F]/g, '').trim()")
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain("replace(/\\\\[rn]|[\\u0000-\\u001F\\u007F]/g, '').trim()")
    expect(read('src/lib/supabase/service.ts')).toContain("replace(/\\\\[rn]|[\\u0000-\\u001F\\u007F]/g, '').trim()")
    expect(read('src/lib/remotion-lambda-renderer.ts')).not.toContain('process.env.AWS_ACCESS_KEY_ID =')
    expect(exporter).toContain("readEnv('AWS_ACCESS_KEY_ID')")
    expect(exporter).toContain('renderDesignVideoLambdaToUrl')
    expect(exporter).toContain('if (job.publish)')
    expect(exporter).toContain('fetchRemoteBuffer(lambdaResult.url)')
    expect(exporter).toContain('outputMetadata.lambdaDirectDownload = true')
    expect(exporter).toContain('lambdaOutputUrl')
    expect(exporter).toContain('lambdaMirroredSizeInBytes')
    expect(exporter).toContain('REMOTION_WORKSPACE_MIRROR_MAX_BYTES')
    expect(exporter).toContain('500 * 1024 * 1024')
    expect(exporter).toContain('lambdaWorkspaceMirrorSkipped')
    expect(exporter).toContain('outputMetadata.lambdaTimings')
    expect(exporter).toContain('publishPosterDeferredToClient')
    expect(exporter).not.toContain('extractVideoPoster')
    expect(exporter).not.toContain('uploadPoster')
    expect(read('src/lib/remotion-encoding.ts')).toContain('REMOTION_LAMBDA_VIDEO_BITRATE')
    expect(read('src/lib/remotion-encoding.ts')).toContain('REMOTION_LAMBDA_AUDIO_BITRATE')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('videoBitrate: encoding.videoBitrate')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('audioBitrate')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain("readEnv('REMOTION_LAMBDA_FRAMES_PER_LAMBDA')")
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('const DEFAULT_FRAMES_PER_LAMBDA = 20')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('resolveFramesPerLambda(')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('MAX_LAMBDAS_PER_RENDER')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('REMOTION_LAMBDA_USE_CONCURRENCY')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('REMOTION_LAMBDA_TIMEOUT_MS')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('timeoutInMilliseconds')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain("new URL('public/remotion-runtime.json', serveUrl)")
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('Remotion render site is not font-pinned')
    expect(JSON.parse(read('public/remotion-runtime.json'))).toEqual({
      runtimeVersion: 'remotion-font-runtime-r10-google-fonts-on-demand',
      fontCatalogVersion: 'makaron-fonts-r2-symbol-fallback',
      editableRuntimeVersion: 'remotion-editable-runtime-r4-caption-style-preserving',
    })
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('editableRuntimeVersion !== REMOTION_EDITABLE_RUNTIME_VERSION')
    expect(read('src/remotion/DynamicDesign.tsx')).toContain('makaron-remotion-font-timing')
    expect(read('src/remotion/DynamicDesign.tsx')).toContain('props: propsObj')
    expect(read('src/lib/remotion-lambda-renderer.ts')).toContain('fontTelemetry')
    expect(read('scripts/remotion-lambda-provision.ts')).toContain("publicDir: path.resolve(process.cwd(), 'public')")
    expect(nextConfig).toContain("'@remotion/lambda-client'")
  })

  it('exposes API and CLI entrypoints for composition export', () => {
    const postRoute = read('src/app/api/remotion/export/route.ts')
    const getRoute = read('src/app/api/remotion/export/[id]/route.ts')
    const materializeRoute = read('src/app/api/media/materialize/route.ts')
    const cli = read('packages/makaron-cli/bin/makaron.mjs')
    const agent = readAgentRuntimeSource()
    const worker = read('workers/remotion-export-worker.ts')
    const videoSnapshotRoute = read('src/app/api/video-snapshot/[snapshotId]/route.ts')
    const videoPollCron = read('src/app/api/cron/video-poll/route.ts')
    const packageJson = read('package.json')

    expect(postRoute).toContain('createRemotionExportJob')
    expect(postRoute).toContain("publish && outputType === 'video' ? crypto.randomUUID()")
    expect(postRoute).toContain('runRemotionExportJob')
    expect(postRoute).toContain('REMOTION_EXPORT_INLINE_AFTER')
    expect(getRoute).toContain('duration_seconds')
    expect(getRoute).toContain('realtime_ratio')
    expect(getRoute).toContain('worker_id')
    expect(materializeRoute).toContain('@/app/api/remotion/export/route')
    expect(agent).toContain('materialize_media')
    expect(agent).toContain('createRemotionExportJob')
    expect(agent).toContain('const shouldPublish = publish !== false')
    expect(agent).not.toContain('runRemotionExportJobAndWait')
    expect(agent).not.toContain("profile: z.enum(['fast_720p', 'source'])")
    expect(agent).not.toContain('wait: z.boolean()')
    expect(agent).toContain("studioCheckpoint.studioRunId\n            ? 'source'\n            : 'fast_720p'")
    expect(agent).toContain('studioRunId: studioCheckpoint.studioRunId')
    expect(agent).toContain('studioRunPending: Boolean(studioCheckpoint.studioRunId)')
    expect(agent).toContain('ctx.pendingVideoSnapshot')
    expect(agent).not.toContain('void runRemotionExportJob(job.id)')
    expect(agent).toContain('runRemotionExportAfterResponse(job.id)')
    expect(agent).toContain("if (job.status === 'queued')")
    expect(agent).toContain('Pending export snapshot insert failed')
    expect(agent).toContain("taskId: `remotion-export-pending-${job.id}`")
    expect(agent).toContain('VIDEO_PLACEHOLDER_IMAGE')
    expect(videoSnapshotRoute).toContain('runRemotionExportAfterResponse')
    expect(videoSnapshotRoute).toContain('remotion-export-pending-')
    expect(videoSnapshotRoute).toContain("status: 'failed'")
    expect(videoPollCron).toContain('runNextRemotionExportJob')
    expect(videoPollCron).toContain('remotionProcessed')
    expect(videoPollCron).toContain(".order('created_at', { ascending: true })")
    expect(videoPollCron).toContain('Provider polling failed after 30 minutes')
    expect(cli).toContain('composition export --project <id> --media <N> --wait')
    expect(cli).toContain("command === 'materialize'")
    expect(cli).toContain('--design-json')
    expect(cli).toContain('--materialize')
    expect(cli).toContain('--export-compositions')
    expect(cli).toContain('first_video_url')
    expect(worker).toContain('runNextRemotionExportJob')
    expect(worker).toContain('--check')
    expect(packageJson).toContain('worker:remotion-export')
    expect(packageJson).toContain('worker:remotion-export:check')
    expect(packageJson).toContain('benchmark:remotion-export')
  })
})
