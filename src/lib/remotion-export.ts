import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { DesignPayload, VideoMeta } from '@/types'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { toPublicStorageUrl, uploadPoster } from '@/lib/supabase/storage'
import * as workspace from '@/lib/workspace'
import { extractVideoPoster } from '@/lib/video-poster'
import { resolveRemotionLambdaEncodingSettings } from '@/lib/remotion-encoding'
import {
  prepareRemotionCodeForSandbox,
  renderDesignFrame,
  renderDesignVideo,
} from '@/lib/remotion-server'
import { resolveVideoUrlsInCode } from '@/lib/video-url-resolver'
import { resolveAudioUrlsInCode } from '@/lib/audio-url-resolver'
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations'

export type RemotionExportStatus = 'queued' | 'rendering' | 'completed' | 'failed'
export type RemotionExportOutputType = 'video' | 'image'
export type RemotionRenderProfile = 'fast_720p' | 'source'

export interface RemotionExportJob {
  id: string
  project_id: string
  user_id: string
  snapshot_id?: string | null
  design_path?: string | null
  status: RemotionExportStatus
  output_type: RemotionExportOutputType
  publish: boolean
  progress?: number | null
  workspace_path?: string | null
  storage_url?: string | null
  content_type?: string | null
  fingerprint?: string | null
  duration_seconds?: number | null
  render_seconds?: number | null
  realtime_ratio?: number | null
  width?: number | null
  height?: number | null
  fps?: number | null
  error?: string | null
  worker_id?: string | null
  heartbeat_at?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string
  started_at?: string | null
  completed_at?: string | null
}

export interface CreateRemotionExportJobInput {
  userId: string
  projectId: string
  snapshotId?: string
  designPath?: string
  design?: DesignPayload
  outputType?: RemotionExportOutputType
  renderProfile?: RemotionRenderProfile
  publish?: boolean
  publishSnapshotId?: string
  name?: string
}

export interface RemotionExportResult {
  job: RemotionExportJob
  design: DesignPayload
}

export interface RemotionExportQueueReadiness {
  ready: boolean
  error?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseDesignPayload(content: string): DesignPayload {
  const parsed = JSON.parse(content) as unknown
  if (!isObject(parsed) || typeof parsed.code !== 'string') {
    throw new Error('Workspace design file is not a valid Remotion composition payload')
  }
  return {
    code: parsed.code,
    width: Number(parsed.width) || 1080,
    height: Number(parsed.height) || 1920,
    props: isObject(parsed.props) ? parsed.props : undefined,
    animation: isObject(parsed.animation)
      ? {
          fps: Number(parsed.animation.fps) || 30,
          durationInSeconds: Number(parsed.animation.durationInSeconds) || Number(parsed.animation.duration) || 1,
          ...(typeof parsed.animation.format === 'string' ? { format: parsed.animation.format } : {}),
        }
      : undefined,
    editables: Array.isArray(parsed.editables) ? parsed.editables as DesignPayload['editables'] : undefined,
  }
}

function slugify(value: string | undefined, fallback = 'composition'): string {
  return (value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || fallback
}

function nowIso() {
  return new Date().toISOString()
}

function readRemotionAwsCredentials():
  | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | null {
  const accessKeyId = process.env.REMOTION_AWS_ACCESS_KEY_ID || process.env.REMOTION_AWS_ACCESS_KEY
  const secretAccessKey = process.env.REMOTION_AWS_SECRET_ACCESS_KEY || process.env.REMOTION_AWS_SECRET_KEY
  const sessionToken = process.env.REMOTION_AWS_SESSION_TOKEN
  if (!accessKeyId || !secretAccessKey) return null
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey }
}

function lambdaObjectKeyFromUrl(url: string, bucketName?: string | null): string | null {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return null
    if (bucketName && parts[0] === bucketName) return parts.slice(1).join('/')
    return parts.join('/')
  } catch {
    return null
  }
}

function quoteContentDispositionFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, '_')
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprintDesign(
  design: DesignPayload,
  outputType: RemotionExportOutputType,
  renderProfile: RemotionRenderProfile,
): string {
  const renderer = process.env.REMOTION_RENDERER || 'vercel'
  const lambdaEncoding = outputType === 'video' && renderer === 'lambda'
    ? resolveRemotionLambdaEncodingSettings()
    : null
  const payload = {
    renderer: 'remotion-export-v3',
    outputType,
    renderProfile,
    outputSettings: {
      renderer,
      ...(lambdaEncoding ? {
        lambdaVideoBitrate: lambdaEncoding.videoBitrate,
        lambdaAudioBitrate: lambdaEncoding.audioBitrate,
        lambdaX264Preset: process.env.REMOTION_LAMBDA_X264_PRESET || 'ultrafast',
        lambdaJpegQuality: process.env.REMOTION_LAMBDA_JPEG_QUALITY || '80',
      } : {}),
    },
    design: {
      code: design.code,
      width: Number(design.width) || 1080,
      height: Number(design.height) || 1920,
      animation: design.animation || null,
      props: design.props || null,
      editables: design.editables || null,
    },
  }
  return createHash('sha256').update(stableJson(payload)).digest('hex')
}

function readPublishSnapshotIds(metadata: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>()
  const one = metadata?.publishSnapshotId
  if (typeof one === 'string' && one) ids.add(one)
  const many = metadata?.publishSnapshotIds
  if (Array.isArray(many)) {
    many.forEach((id) => {
      if (typeof id === 'string' && id) ids.add(id)
    })
  }
  return [...ids]
}

async function addPublishSnapshotId(job: RemotionExportJob, snapshotId?: string): Promise<RemotionExportJob> {
  if (!snapshotId) return job
  const ids = new Set(readPublishSnapshotIds(job.metadata))
  if (ids.has(snapshotId)) return job
  ids.add(snapshotId)
  const metadata = {
    ...(job.metadata || {}),
    publishSnapshotId: snapshotId,
    publishSnapshotIds: [...ids],
  }
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('remotion_export_jobs')
    .update({ publish: true, metadata })
    .eq('id', job.id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as RemotionExportJob
}

async function markPublishedSnapshotsFailed(
  supabase: SupabaseClient,
  job: RemotionExportJob,
  message: string,
): Promise<void> {
  const snapshotIds = readPublishSnapshotIds(job.metadata)
  if (snapshotIds.length === 0) return

  const { data: snapshots, error } = await supabase
    .from('snapshots')
    .select('id, video_meta')
    .in('id', snapshotIds)
  if (error) {
    console.warn('[remotion-export] failed to load publish snapshots for failure update:', error.message)
    return
  }

  await Promise.all((snapshots || []).map(async (snapshot: { id: string; video_meta: VideoMeta | null }) => {
    const videoMeta = snapshot.video_meta
    if (!videoMeta || videoMeta.status !== 'processing') return
    const { error: updateError } = await supabase
      .from('snapshots')
      .update({
        video_meta: {
          ...videoMeta,
          status: 'failed',
          error: message,
        },
      })
      .eq('id', snapshot.id)
    if (updateError) {
      console.warn('[remotion-export] failed to mark publish snapshot failed:', updateError.message)
    }
  }))
}

export function resolveRemotionRenderProfile(
  design: Pick<DesignPayload, 'width' | 'height'>,
  profile: RemotionRenderProfile = 'fast_720p',
) {
  const sourceWidth = Number(design.width) || 1080
  const sourceHeight = Number(design.height) || 1920
  if (profile === 'source') {
    return { profile, scale: 1, width: even(sourceWidth), height: even(sourceHeight), sourceWidth, sourceHeight }
  }
  const shortSide = Math.min(sourceWidth, sourceHeight)
  const scale = shortSide > 0 ? Math.min(1, 720 / shortSide) : 1
  return {
    profile: 'fast_720p' as const,
    scale,
    width: even(sourceWidth * scale),
    height: even(sourceHeight * scale),
    sourceWidth,
    sourceHeight,
  }
}

function remotionWorkerId() {
  return process.env.REMOTION_EXPORT_WORKER_ID
    || process.env.VERCEL_REGION
    || `pid-${process.pid || 'unknown'}`
}

async function assertProjectOwner(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<void> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!project) throw new Error('Project not found')
  if (project.user_id !== userId) throw new Error('Forbidden')
}

async function loadDesignFromSnapshot(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  snapshotId: string,
): Promise<{ design: DesignPayload; designPath: string }> {
  const { data: snapshot, error } = await supabase
    .from('snapshots')
    .select('id, design_path, project_id')
    .eq('id', snapshotId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!snapshot) throw new Error('Snapshot not found')
  if (!snapshot.design_path) throw new Error('Snapshot has no Remotion composition design_path')

  const file = await workspace.readFile(snapshot.design_path, supabase, userId)
  if (!file?.content) throw new Error(`Design file not found: ${snapshot.design_path}`)
  return { design: parseDesignPayload(file.content), designPath: snapshot.design_path }
}

async function loadDesignFromPath(
  supabase: SupabaseClient,
  userId: string,
  designPath: string,
): Promise<DesignPayload> {
  const file = await workspace.readFile(designPath, supabase, userId)
  if (!file?.content) throw new Error(`Design file not found: ${designPath}`)
  return parseDesignPayload(file.content)
}

export async function createRemotionExportJob(input: CreateRemotionExportJobInput): Promise<RemotionExportJob> {
  const admin = getSupabaseAdmin()
  await assertProjectOwner(admin, input.userId, input.projectId)

  if (!input.snapshotId && !input.designPath && !input.design) {
    throw new Error('Provide snapshotId, designPath, or design')
  }

  const outputType = input.outputType || 'video'
  const renderProfile = input.renderProfile || 'fast_720p'
  let fingerprintSource = input.design
  let resolvedDesignPath = input.designPath
  if (!fingerprintSource && input.snapshotId) {
    const loaded = await loadDesignFromSnapshot(admin, input.userId, input.projectId, input.snapshotId)
    fingerprintSource = loaded.design
    resolvedDesignPath = resolvedDesignPath || loaded.designPath
  } else if (!fingerprintSource && input.designPath) {
    fingerprintSource = await loadDesignFromPath(admin, input.userId, input.designPath)
  }
  if (!fingerprintSource) throw new Error('Could not load Remotion composition for export')
  const fingerprint = fingerprintDesign(fingerprintSource, outputType, renderProfile)

  const { data: reusableRows, error: reusableError } = await admin
    .from('remotion_export_jobs')
    .select('*')
    .eq('project_id', input.projectId)
    .eq('user_id', input.userId)
    .eq('output_type', outputType)
    .filter('metadata->>fingerprint', 'eq', fingerprint)
    .in('status', ['completed', 'rendering', 'queued'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (reusableError) throw new Error(reusableError.message)
  const reusable = (reusableRows || []).find((row) => row.status === 'completed')
    || (reusableRows || []).find((row) => row.status === 'rendering')
    || (reusableRows || [])[0]
  if (reusable) {
    let job = await addPublishSnapshotId(reusable as RemotionExportJob, input.publishSnapshotId)
    if (job.status === 'completed' && input.publishSnapshotId && job.storage_url && job.output_type === 'video') {
      await publishExportedVideo(job, job.storage_url, job.workspace_path || '', fingerprintSource, {
        width: job.width || resolveRemotionRenderProfile(fingerprintSource, renderProfile).width,
        height: job.height || resolveRemotionRenderProfile(fingerprintSource, renderProfile).height,
      }, input.publishSnapshotId)
      job = await getRemotionExportJob(job.id) || job
    }
    return job
  }

  const metadata: Record<string, unknown> = {}
  if (input.name) metadata.name = input.name
  if (input.design) metadata.design = input.design
  metadata.fingerprint = fingerprint
  if (input.publishSnapshotId) {
    metadata.publishSnapshotId = input.publishSnapshotId
    metadata.publishSnapshotIds = [input.publishSnapshotId]
  }
  metadata.renderProfile = renderProfile

  const { data, error } = await admin.from('remotion_export_jobs').insert({
    project_id: input.projectId,
    user_id: input.userId,
    snapshot_id: input.snapshotId || null,
    design_path: resolvedDesignPath || null,
    output_type: outputType,
    publish: input.publish === true,
    metadata,
  }).select('*').single()

  if (error) throw new Error(error.message)
  return data as RemotionExportJob
}

export async function getRemotionExportJob(jobId: string): Promise<RemotionExportJob | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('remotion_export_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as RemotionExportJob | null
}

export async function resolveRemotionExportDownloadUrl(job: RemotionExportJob): Promise<string | null> {
  if (!job.storage_url) return null
  if (job.output_type !== 'video' || job.metadata?.lambdaDirectDownload !== true) return job.storage_url

  const bucketName = typeof job.metadata?.lambdaBucketName === 'string' ? job.metadata.lambdaBucketName : null
  const sourceUrl = typeof job.metadata?.lambdaOutputUrl === 'string' ? job.metadata.lambdaOutputUrl : job.storage_url
  const key = lambdaObjectKeyFromUrl(sourceUrl, bucketName)
  const credentials = readRemotionAwsCredentials()
  if (!bucketName || !key || !credentials) return job.storage_url

  const name = slugify(typeof job.metadata?.name === 'string' ? job.metadata.name : undefined)
  const client = new S3Client({
    region: process.env.REMOTION_LAMBDA_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials,
  })
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${quoteContentDispositionFilename(name)}.mp4"`,
        ResponseContentType: 'video/mp4',
      }),
      { expiresIn: 3600 },
    )
  } catch (err) {
    console.warn('[remotion-export] failed to sign Lambda download URL:', err)
    return job.storage_url
  }
}

export async function checkRemotionExportQueueReady(): Promise<RemotionExportQueueReadiness> {
  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin
      .from('remotion_export_jobs')
      .select('id')
      .limit(1)
    if (error) return { ready: false, error: error.message }
    return { ready: true }
  } catch (err) {
    return { ready: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function claimRemotionExportJob(jobId: string): Promise<RemotionExportJob | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('remotion_export_jobs')
    .update({
      status: 'rendering',
      progress: 0,
      started_at: nowIso(),
      completed_at: null,
      error: null,
      worker_id: remotionWorkerId(),
      heartbeat_at: nowIso(),
    })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return data as RemotionExportJob

  const current = await getRemotionExportJob(jobId)
  if (!current) throw new Error('Export job not found')
  if (current.status === 'completed') return current
  if (current.status === 'rendering') return null
  throw new Error(`Export job is ${current.status}`)
}

export async function claimNextRemotionExportJob(limit = 5): Promise<RemotionExportJob | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('remotion_export_jobs')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  for (const candidate of data || []) {
    const claimed = await claimRemotionExportJob(candidate.id)
    if (claimed) return claimed
  }
  return null
}

async function loadJobDesign(job: RemotionExportJob, supabase: SupabaseClient): Promise<{ design: DesignPayload; designPath?: string }> {
  const embedded = job.metadata?.design
  if (isObject(embedded) && typeof embedded.code === 'string') {
    return {
      design: parseDesignPayload(JSON.stringify(embedded)),
      designPath: job.design_path || undefined,
    }
  }
  if (job.snapshot_id) {
    return loadDesignFromSnapshot(supabase, job.user_id, job.project_id, job.snapshot_id)
  }
  if (job.design_path) {
    return { design: await loadDesignFromPath(supabase, job.user_id, job.design_path), designPath: job.design_path }
  }
  throw new Error('Export job has no design source')
}

async function normalizeDesignForServer(
  design: DesignPayload,
  projectId: string,
  supabase: SupabaseClient,
): Promise<DesignPayload> {
  const videoResolved = await resolveVideoUrlsInCode(design.code, projectId, supabase)
  const audioResolved = await resolveAudioUrlsInCode(videoResolved.code, projectId, supabase)
  return {
    ...design,
    code: audioResolved.code,
  }
}

async function fetchRemoteBuffer(url: string, timeoutMs = 120000): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Remote export download failed: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Remote export download timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function publishExportedVideo(
  job: RemotionExportJob,
  url: string,
  path: string,
  design: DesignPayload,
  output: { width: number; height: number },
  targetSnapshotId?: string,
): Promise<string> {
  const admin = getSupabaseAdmin()
  const snapshotId = targetSnapshotId || crypto.randomUUID()
  const { data: sortData } = await admin.rpc('next_sort_order', { p_project_id: job.project_id })
  const description = typeof job.metadata?.name === 'string' ? job.metadata.name : 'Remotion export'
  const videoMeta: VideoMeta = {
    taskId: `remotion-export-${job.id}`,
    videoUrl: url,
    providerUrl: url,
    videoPath: path,
    prompt: description,
    sourceSnapshotIds: job.snapshot_id ? [job.snapshot_id] : [],
    sourceUrls: [url],
    status: 'completed',
    duration: job.duration_seconds || design.animation?.durationInSeconds || null,
    model: 'upload',
    createdAt: nowIso(),
    width: output.width,
    height: output.height,
  }
  let imageUrl = VIDEO_PLACEHOLDER_IMAGE
  try {
    const posterBuffer = await extractVideoPoster(url)
    imageUrl = await uploadPoster(admin, job.user_id, job.project_id, snapshotId, posterBuffer) || imageUrl
  } catch (err) {
    console.warn('[remotion-export] poster extraction failed:', err)
  }

  const row = {
    id: snapshotId,
    project_id: job.project_id,
    image_url: imageUrl,
    tips: [],
    message_id: '',
    sort_order: sortData ?? 0,
    type: 'video',
    video_meta: videoMeta,
    description,
  }
  let error: { message: string } | null = null
  if (targetSnapshotId) {
    const updateResult = await admin.from('snapshots').update({
        image_url: row.image_url,
        type: row.type,
        video_meta: row.video_meta,
        description: row.description,
      }).eq('id', targetSnapshotId).eq('project_id', job.project_id).select('id').maybeSingle()
    error = updateResult.error
    if (!error && !updateResult.data) {
      const insertResult = await admin.from('snapshots').insert(row)
      error = insertResult.error
    }
  } else {
    const insertResult = await admin.from('snapshots').insert(row)
    error = insertResult.error
  }
  if (error) throw new Error(`Publish failed: ${error.message}`)
  return snapshotId
}

async function executeRemotionExportJob(job: RemotionExportJob): Promise<RemotionExportResult> {
  const admin = getSupabaseAdmin()
  const startedAt = job.started_at ? Date.parse(job.started_at) || Date.now() : Date.now()

  try {
    const { design, designPath } = await loadJobDesign(job, admin)
    const resolvedDesign = await normalizeDesignForServer(design, job.project_id, admin)
    const renderProfile = job.metadata?.renderProfile === 'source' ? 'source' : 'fast_720p'
    const renderTarget = resolveRemotionRenderProfile(resolvedDesign, renderProfile)
    const fps = resolvedDesign.animation?.fps || 30
    const durationSeconds = job.output_type === 'video'
      ? Math.max(1 / fps, resolvedDesign.animation?.durationInSeconds || 1 / fps)
      : 0
    const ext = job.output_type === 'video' ? 'mp4' : 'jpg'
    const contentType = job.output_type === 'video' ? 'video/mp4' : 'image/jpeg'
    const name = slugify(typeof job.metadata?.name === 'string' ? job.metadata.name : undefined)
    const workspacePath = `${job.project_id}/media/remotion-${name}-${job.id.slice(0, 8)}.${ext}`

    const updateProgress = async (progress: unknown) => {
      const progressObj = isObject(progress) ? progress : {}
      const value = typeof progressObj.progress === 'number'
        ? progressObj.progress
        : typeof progressObj.overallProgress === 'number'
          ? progressObj.overallProgress
          : undefined
      if (value !== undefined) {
        await admin.from('remotion_export_jobs').update({
          progress: value,
          heartbeat_at: nowIso(),
        }).eq('id', job.id)
      }
    }

    let publicUrl: string
    let finalWorkspacePath = workspacePath
    const outputMetadata: Record<string, unknown> = {}
    if (job.output_type === 'video' && process.env.REMOTION_RENDERER === 'lambda') {
      const { renderDesignVideoLambdaToUrl } = await import('@/lib/remotion-lambda-renderer')
      const lambdaResult = await renderDesignVideoLambdaToUrl(resolvedDesign, {
        scale: renderTarget.scale,
        onProgress: updateProgress,
      })
      const lambdaWorkspacePath = `s3://${lambdaResult.bucketName}/${new URL(lambdaResult.url).pathname.split('/').slice(2).join('/')}`
      if (job.publish) {
        await admin.from('remotion_export_jobs').update({
          progress: 1,
          heartbeat_at: nowIso(),
          metadata: {
            ...(job.metadata || {}),
            finalizing: 'downloading-lambda-output',
            lambdaRenderId: lambdaResult.renderId,
          },
        }).eq('id', job.id)
        const buffer = await fetchRemoteBuffer(lambdaResult.url)
        await admin.from('remotion_export_jobs').update({
          progress: 1,
          heartbeat_at: nowIso(),
          metadata: {
            ...(job.metadata || {}),
            finalizing: 'uploading-workspace-copy',
            lambdaRenderId: lambdaResult.renderId,
            lambdaOutputSizeInBytes: lambdaResult.outputSizeInBytes || null,
          },
        }).eq('id', job.id)
        const saved = await workspace.writeFile(workspacePath, buffer, admin, job.user_id, contentType)
        if (!saved.success || !saved.storageUrl) {
          throw new Error(saved.error || 'Workspace upload failed')
        }
        publicUrl = toPublicStorageUrl(saved.storageUrl)
        finalWorkspacePath = workspacePath
        outputMetadata.lambdaMirroredSizeInBytes = buffer.length
      } else {
        publicUrl = lambdaResult.url
        finalWorkspacePath = lambdaWorkspacePath
        outputMetadata.lambdaDirectDownload = true
      }
      outputMetadata.lambdaOutputUrl = lambdaResult.url
      outputMetadata.lambdaWorkspacePath = lambdaWorkspacePath
      outputMetadata.lambdaRenderId = lambdaResult.renderId
      outputMetadata.lambdaBucketName = lambdaResult.bucketName
      outputMetadata.lambdaFunctionName = lambdaResult.functionName
      outputMetadata.lambdaRendererFunctionName = lambdaResult.rendererFunctionName
      outputMetadata.lambdaOutputSizeInBytes = lambdaResult.outputSizeInBytes || null
      outputMetadata.lambdaVideoBitrate = lambdaResult.videoBitrate || null
      outputMetadata.lambdaAudioBitrate = lambdaResult.audioBitrate || null
      outputMetadata.lambdaRenderSeconds = lambdaResult.renderSeconds
      outputMetadata.lambdaTimings = lambdaResult.timings
    } else {
      const buffer = job.output_type === 'video'
        ? await renderDesignVideo(resolvedDesign, {
            scale: renderTarget.scale,
            onProgress: updateProgress,
          })
        : await renderDesignFrame(resolvedDesign, 0)

      const saved = await workspace.writeFile(workspacePath, buffer, admin, job.user_id, contentType)
      if (!saved.success || !saved.storageUrl) {
        throw new Error(saved.error || 'Workspace upload failed')
      }
      publicUrl = toPublicStorageUrl(saved.storageUrl)
    }

    const renderSeconds = (Date.now() - startedAt) / 1000
    const realtimeRatio = durationSeconds > 0 ? durationSeconds / renderSeconds : null
    const metadata: Record<string, unknown> = {
      ...(job.metadata || {}),
      ...outputMetadata,
      ...(designPath ? { designPath } : {}),
      preparedComponent: prepareRemotionCodeForSandbox(resolvedDesign.code).slice(0, 80),
    }
    if (job.publish && job.output_type === 'video') {
      const publishSnapshotIds = readPublishSnapshotIds(job.metadata)
      if (publishSnapshotIds.length > 0) {
        const publishedIds: string[] = []
        for (const snapshotId of publishSnapshotIds) {
          publishedIds.push(await publishExportedVideo({
          ...job,
          duration_seconds: durationSeconds,
        }, publicUrl, finalWorkspacePath, resolvedDesign, { width: renderTarget.width, height: renderTarget.height }, snapshotId))
      }
      metadata.publishedSnapshotId = publishedIds[0]
      metadata.publishedSnapshotIds = publishedIds
    } else {
      metadata.publishedSnapshotId = await publishExportedVideo({
        ...job,
        duration_seconds: durationSeconds,
      }, publicUrl, finalWorkspacePath, resolvedDesign, { width: renderTarget.width, height: renderTarget.height })
    }
  }

    const completedUpdate = {
      status: 'completed' as const,
      progress: 1,
      heartbeat_at: nowIso(),
      workspace_path: finalWorkspacePath,
      storage_url: publicUrl,
      content_type: contentType,
      duration_seconds: durationSeconds || null,
      render_seconds: renderSeconds,
      realtime_ratio: realtimeRatio,
      width: renderTarget.width,
      height: renderTarget.height,
      fps,
      metadata: {
        ...metadata,
        renderProfile: renderTarget.profile,
        sourceWidth: renderTarget.sourceWidth,
        sourceHeight: renderTarget.sourceHeight,
        outputWidth: renderTarget.width,
        outputHeight: renderTarget.height,
        scale: renderTarget.scale,
      },
      completed_at: nowIso(),
    }
    const { data: updated, error } = await admin
      .from('remotion_export_jobs')
      .update(completedUpdate)
      .eq('id', job.id)
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    return { job: updated as RemotionExportJob, design: resolvedDesign }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markPublishedSnapshotsFailed(admin, job, message)
    await admin.from('remotion_export_jobs').update({
      status: 'failed',
      error: message,
      completed_at: nowIso(),
      heartbeat_at: nowIso(),
      render_seconds: (Date.now() - startedAt) / 1000,
    }).eq('id', job.id).in('status', ['queued', 'rendering'])
    throw err
  }
}

export async function runRemotionExportJob(jobId: string): Promise<RemotionExportResult> {
  const claimed = await claimRemotionExportJob(jobId)
  if (!claimed) throw new Error(`Export job is already rendering: ${jobId}`)
  if (claimed.status === 'completed') {
    const admin = getSupabaseAdmin()
    const { design } = await loadJobDesign(claimed, admin)
    return { job: claimed, design }
  }
  return executeRemotionExportJob(claimed)
}

export async function runNextRemotionExportJob(): Promise<RemotionExportResult | null> {
  const claimed = await claimNextRemotionExportJob()
  if (!claimed) return null
  return executeRemotionExportJob(claimed)
}
