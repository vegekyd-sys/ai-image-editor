import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import type { DesignPayload, VideoMeta } from '@/types'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import { toPublicStorageUrl } from '@/lib/supabase/storage'
import * as workspace from '@/lib/workspace'
import { resolveRemotionLambdaEncodingSettings } from '@/lib/remotion-encoding'
import {
  prepareRemotionCodeForSandbox,
  renderDesignFrame,
  renderDesignVideo,
} from '@/lib/remotion-server'
import { resolveVideoUrlsInCode } from '@/lib/video-url-resolver'
import { resolveAudioUrlsInCode } from '@/lib/audio-url-resolver'
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations'
import type { RemotionLambdaOutputDestination } from '@/lib/remotion-lambda-renderer'
import { normalizeCompositionAnimation } from '@/lib/composition-duration'

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
  const animation = isObject(parsed.animation)
    ? normalizeCompositionAnimation(parsed.code, {
        fps: Number(parsed.animation.fps) || 30,
        durationInSeconds: Number(parsed.animation.durationInSeconds) || Number(parsed.animation.duration) || undefined,
        durationInFrames: Number(parsed.animation.durationInFrames) || undefined,
        ...(typeof parsed.animation.format === 'string' ? { format: parsed.animation.format } : {}),
      })
    : undefined
  return {
    code: parsed.code,
    width: Number(parsed.width) || 1080,
    height: Number(parsed.height) || 1920,
    props: isObject(parsed.props) ? parsed.props : undefined,
    animation,
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

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()
  return value || undefined
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = readEnv(name)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function remotionExportStaleMs(): number {
  return readPositiveIntegerEnv('REMOTION_EXPORT_STALE_MS', 2 * 60 * 1000)
}

function remotionWorkspaceMirrorMaxBytes(): number {
  return readPositiveIntegerEnv('REMOTION_WORKSPACE_MIRROR_MAX_BYTES', 500 * 1024 * 1024)
}

function isStaleRenderingJob(job: Pick<RemotionExportJob, 'status' | 'heartbeat_at' | 'started_at'>): boolean {
  if (job.status !== 'rendering') return false
  const stamp = job.heartbeat_at || job.started_at
  if (!stamp) return true
  const timestamp = Date.parse(stamp)
  if (!Number.isFinite(timestamp)) return true
  return Date.now() - timestamp > remotionExportStaleMs()
}

function remotionExportStaleCutoffIso(): string {
  return new Date(Date.now() - remotionExportStaleMs()).toISOString()
}

function readRemotionAwsCredentials():
  | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | null {
  const accessKeyId = readEnv('REMOTION_AWS_ACCESS_KEY_ID') || readEnv('REMOTION_AWS_ACCESS_KEY') || readEnv('AWS_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('REMOTION_AWS_SECRET_ACCESS_KEY') || readEnv('REMOTION_AWS_SECRET_KEY') || readEnv('AWS_SECRET_ACCESS_KEY')
  const sessionToken = readEnv('REMOTION_AWS_SESSION_TOKEN') || readEnv('AWS_SESSION_TOKEN')
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

function workspaceStoragePath(userId: string, path: string): string {
  return `${userId}/workspace/${path}`
}

function resolveSupabaseS3OutputDestination(
  supabase: SupabaseClient,
  userId: string,
  workspacePath: string,
): (RemotionLambdaOutputDestination & { publicUrl: string; storagePath: string }) | null {
  if (readEnv('REMOTION_LAMBDA_SUPABASE_DIRECT_OUTPUT') === 'false') return null
  const endpoint = readEnv('SUPABASE_S3_ENDPOINT')
  const region = readEnv('SUPABASE_S3_REGION')
  const accessKeyId = readEnv('SUPABASE_S3_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('SUPABASE_S3_SECRET_ACCESS_KEY')
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) return null

  const bucketName = readEnv('SUPABASE_S3_BUCKET') || 'images'
  const storagePath = workspaceStoragePath(userId, workspacePath)
  const { data } = supabase.storage.from(bucketName).getPublicUrl(storagePath)
  return {
    bucketName,
    key: storagePath,
    storagePath,
    publicUrl: toPublicStorageUrl(data.publicUrl),
    privacy: 'no-acl',
    s3OutputProvider: {
      endpoint,
      region: region as NonNullable<RemotionLambdaOutputDestination['s3OutputProvider']['region']>,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    },
  }
}

async function indexDirectWorkspaceFile(
  supabase: SupabaseClient,
  userId: string,
  path: string,
  storageUrl: string,
  contentType: string,
  sizeBytes?: number | null,
): Promise<void> {
  const { error } = await supabase.from('workspace_files').upsert({
    user_id: userId,
    path,
    content_type: contentType,
    size_bytes: sizeBytes || 0,
    storage_url: storageUrl,
    updated_at: nowIso(),
  }, { onConflict: 'user_id,path' })
  if (error) throw new Error(`Workspace index update failed: ${error.message}`)
  workspace.clearWorkspaceCache()
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
  const renderer = readEnv('REMOTION_RENDERER') || 'vercel'
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
        lambdaX264Preset: readEnv('REMOTION_LAMBDA_X264_PRESET') || 'ultrafast',
        lambdaJpegQuality: readEnv('REMOTION_LAMBDA_JPEG_QUALITY') || '80',
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
  return readEnv('REMOTION_EXPORT_WORKER_ID')
    || readEnv('VERCEL_REGION')
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
    const reusableNeedsPromotion = !job.workspace_path?.startsWith(`${job.project_id}/`)
      || !job.storage_url?.includes('/workspace/')
    if (job.status === 'completed' && input.publish && reusableNeedsPromotion && job.storage_url) {
      const extension = job.output_type === 'video' ? 'mp4' : 'jpg'
      const contentType = job.output_type === 'video' ? 'video/mp4' : 'image/jpeg'
      const name = slugify(typeof job.metadata?.name === 'string' ? job.metadata.name : input.name)
      const workspacePath = `${job.project_id}/media/remotion-${name}-${job.id.slice(0, 8)}.${extension}`
      const buffer = await fetchRemoteBuffer(job.storage_url)
      const saved = await workspace.writeFile(workspacePath, buffer, admin, job.user_id, contentType)
      if (!saved.success || !saved.storageUrl) {
        throw new Error(saved.error || 'Reusable export promotion failed')
      }
      const { error: promotionError } = await admin.from('remotion_export_jobs').update({
        publish: true,
        storage_url: saved.storageUrl,
        workspace_path: workspacePath,
        metadata: {
          ...(job.metadata || {}),
          promotedReusableExport: true,
        },
      }).eq('id', job.id)
      if (promotionError) throw new Error(promotionError.message)
      job = await getRemotionExportJob(job.id) || {
        ...job,
        publish: true,
        storage_url: saved.storageUrl,
        workspace_path: workspacePath,
      }
    }
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
  try {
    const [{ GetObjectCommand, S3Client }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ])
    const client = new S3Client({
      region: readEnv('REMOTION_LAMBDA_REGION') || readEnv('AWS_REGION') || 'us-east-1',
      credentials,
    })
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
  const claimedAt = nowIso()
  const { data, error } = await admin
    .from('remotion_export_jobs')
    .update({
      status: 'rendering',
      progress: 0,
      started_at: claimedAt,
      completed_at: null,
      error: null,
      worker_id: remotionWorkerId(),
      heartbeat_at: claimedAt,
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
  if (current.status === 'rendering') {
    if (!isStaleRenderingJob(current)) return null
    const reclaimedAt = nowIso()
    const { data: reclaimed, error: reclaimError } = await admin
      .from('remotion_export_jobs')
      .update({
        status: 'rendering',
        progress: 0,
        started_at: reclaimedAt,
        completed_at: null,
        error: null,
        worker_id: remotionWorkerId(),
        heartbeat_at: reclaimedAt,
        metadata: {
          ...(current.metadata || {}),
          reclaimedAt,
          reclaimedFromWorkerId: current.worker_id || null,
          reclaimedPreviousHeartbeatAt: current.heartbeat_at || null,
        },
      })
      .eq('id', jobId)
      .eq('status', 'rendering')
      .select('*')
      .maybeSingle()
    if (reclaimError) throw new Error(reclaimError.message)
    return reclaimed as RemotionExportJob | null
  }
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
  const staleCutoff = remotionExportStaleCutoffIso()
  const { data: staleData, error: staleError } = await admin
    .from('remotion_export_jobs')
    .select('id')
    .eq('status', 'rendering')
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${staleCutoff}`)
    .order('heartbeat_at', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (staleError) throw new Error(staleError.message)

  for (const candidate of staleData || []) {
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
  stageTimings?: Record<string, number>,
): Promise<string> {
  const admin = getSupabaseAdmin()
  const snapshotId = targetSnapshotId || crypto.randomUUID()
  const sortStart = Date.now()
  const { data: sortData } = await admin.rpc('next_sort_order', { p_project_id: job.project_id })
  if (stageTimings) stageTimings.publishNextSortOrderMs = (stageTimings.publishNextSortOrderMs || 0) + Date.now() - sortStart
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
  const imageUrl = VIDEO_PLACEHOLDER_IMAGE
  if (stageTimings) stageTimings.publishPosterDeferredToClient = 1

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
  const snapshotWriteStart = Date.now()
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
  if (stageTimings) stageTimings.publishSnapshotWriteMs = (stageTimings.publishSnapshotWriteMs || 0) + Date.now() - snapshotWriteStart
  if (error) throw new Error(`Publish failed: ${error.message}`)
  return snapshotId
}

async function executeRemotionExportJob(job: RemotionExportJob): Promise<RemotionExportResult> {
  const admin = getSupabaseAdmin()
  const startedAt = job.started_at ? Date.parse(job.started_at) || Date.now() : Date.now()
  const stageTimings: Record<string, number> = {}

  try {
    const loadStart = Date.now()
    const { design, designPath } = await loadJobDesign(job, admin)
    const resolvedDesign = await normalizeDesignForServer(design, job.project_id, admin)
    stageTimings.resolveDesignMs = Date.now() - loadStart
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
    if (job.output_type === 'video' && readEnv('REMOTION_RENDERER') === 'lambda') {
      const { renderDesignVideoLambdaToUrl } = await import('@/lib/remotion-lambda-renderer')
      const directOutputDestination = job.publish
        ? resolveSupabaseS3OutputDestination(admin, job.user_id, workspacePath)
        : null
      const lambdaStart = Date.now()
      let usedDirectOutputDestination = Boolean(directOutputDestination)
      let directOutputError: string | null = null
      let lambdaResult: Awaited<ReturnType<typeof renderDesignVideoLambdaToUrl>>
      try {
        lambdaResult = await renderDesignVideoLambdaToUrl(resolvedDesign, {
          scale: renderTarget.scale,
          onProgress: updateProgress,
          outputDestination: directOutputDestination || undefined,
        })
      } catch (err) {
        if (!directOutputDestination) throw err
        directOutputError = err instanceof Error ? err.message : String(err)
        console.warn('[remotion-export] Lambda direct Supabase output failed; retrying with default Lambda output:', directOutputError)
        await admin.from('remotion_export_jobs').update({
          heartbeat_at: nowIso(),
          metadata: {
            ...(job.metadata || {}),
            finalizing: 'retrying-lambda-default-output',
            lambdaDirectSupabaseOutputError: directOutputError,
          },
        }).eq('id', job.id)
        const retryStart = Date.now()
        lambdaResult = await renderDesignVideoLambdaToUrl(resolvedDesign, {
          scale: renderTarget.scale,
          onProgress: updateProgress,
        })
        stageTimings.lambdaDirectOutputRetryMs = Date.now() - retryStart
        usedDirectOutputDestination = false
      }
      stageTimings.lambdaWallMs = Date.now() - lambdaStart
      const lambdaWorkspacePath = usedDirectOutputDestination && directOutputDestination
        ? `s3://${directOutputDestination.bucketName}/${directOutputDestination.key}`
        : `s3://${lambdaResult.bucketName}/${new URL(lambdaResult.url).pathname.split('/').slice(2).join('/')}`
      if (job.publish && usedDirectOutputDestination && directOutputDestination) {
        await admin.from('remotion_export_jobs').update({
          progress: 1,
          heartbeat_at: nowIso(),
          metadata: {
            ...(job.metadata || {}),
            finalizing: 'indexing-direct-supabase-output',
            lambdaRenderId: lambdaResult.renderId,
            lambdaOutputSizeInBytes: lambdaResult.outputSizeInBytes || null,
            directSupabaseStoragePath: directOutputDestination.storagePath,
          },
        }).eq('id', job.id)
        const indexStart = Date.now()
        publicUrl = directOutputDestination.publicUrl
        finalWorkspacePath = workspacePath
        await indexDirectWorkspaceFile(
          admin,
          job.user_id,
          workspacePath,
          publicUrl,
          contentType,
          lambdaResult.outputSizeInBytes || null,
        )
        stageTimings.workspaceIndexMs = Date.now() - indexStart
        stageTimings.lambdaOutputDownloadMs = 0
        stageTimings.workspaceWriteMs = 0
        outputMetadata.lambdaDirectSupabaseOutput = true
        outputMetadata.lambdaDirectSupabaseBucket = directOutputDestination.bucketName
        outputMetadata.lambdaDirectSupabaseKey = directOutputDestination.key
      } else if (job.publish) {
        if (directOutputError) {
          outputMetadata.lambdaDirectSupabaseOutputFallback = true
          outputMetadata.lambdaDirectSupabaseOutputError = directOutputError
        }
        const mirrorMaxBytes = remotionWorkspaceMirrorMaxBytes()
        const outputSize = lambdaResult.outputSizeInBytes || null
        if (outputSize && outputSize > mirrorMaxBytes) {
          publicUrl = lambdaResult.url
          finalWorkspacePath = lambdaWorkspacePath
          outputMetadata.lambdaDirectDownload = true
          outputMetadata.lambdaDirectSupabaseOutput = false
          outputMetadata.lambdaWorkspaceMirrorSkipped = 'output-too-large'
          outputMetadata.lambdaWorkspaceMirrorMaxBytes = mirrorMaxBytes
        } else {
          await admin.from('remotion_export_jobs').update({
            progress: 1,
            heartbeat_at: nowIso(),
            metadata: {
              ...(job.metadata || {}),
              finalizing: 'downloading-lambda-output',
              lambdaRenderId: lambdaResult.renderId,
            },
          }).eq('id', job.id)
          const downloadStart = Date.now()
          const buffer = await fetchRemoteBuffer(lambdaResult.url)
          stageTimings.lambdaOutputDownloadMs = Date.now() - downloadStart
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
          const workspaceUploadStart = Date.now()
          const saved = await workspace.writeFile(workspacePath, buffer, admin, job.user_id, contentType)
          stageTimings.workspaceWriteMs = Date.now() - workspaceUploadStart
          if (!saved.success || !saved.storageUrl) {
            throw new Error(saved.error || 'Workspace upload failed')
          }
          publicUrl = toPublicStorageUrl(saved.storageUrl)
          finalWorkspacePath = workspacePath
          outputMetadata.lambdaMirroredSizeInBytes = buffer.length
          outputMetadata.lambdaDirectSupabaseOutput = false
        }
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

      const workspaceUploadStart = Date.now()
      const saved = await workspace.writeFile(workspacePath, buffer, admin, job.user_id, contentType)
      stageTimings.workspaceWriteMs = Date.now() - workspaceUploadStart
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
      const publishStart = Date.now()
      if (publishSnapshotIds.length > 0) {
        const publishedIds: string[] = []
        for (const snapshotId of publishSnapshotIds) {
          publishedIds.push(await publishExportedVideo({
            ...job,
            duration_seconds: durationSeconds,
          }, publicUrl, finalWorkspacePath, resolvedDesign, { width: renderTarget.width, height: renderTarget.height }, snapshotId, stageTimings))
        }
        metadata.publishedSnapshotId = publishedIds[0]
        metadata.publishedSnapshotIds = publishedIds
      } else {
        metadata.publishedSnapshotId = await publishExportedVideo({
          ...job,
          duration_seconds: durationSeconds,
        }, publicUrl, finalWorkspacePath, resolvedDesign, { width: renderTarget.width, height: renderTarget.height }, undefined, stageTimings)
      }
      stageTimings.publishVideoMs = Date.now() - publishStart
    }
    stageTimings.totalServerJobMs = Date.now() - startedAt

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
        stageTimings,
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
