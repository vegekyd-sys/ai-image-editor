import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from './supabase/service'
import { normalizeVideoModelId, resolveVideoGenerationRoute } from './video-model-capabilities'
import { createVideo, type CreateVideoInput, type CreateVideoResult } from './skills/create-video'
import { downloadUpscaleMedia, inspectUpscaleMedia, finishUpscaleMedia } from './video-upscale-media'
import { submitByteDanceUpscale, pollByteDanceUpscale, UPSCALE_RESOLUTIONS, UpscaleSubmissionError, type UpscaleResolution } from './bytedance-video-upscale'
import type { GetVideoStatusResult } from './skills/get-video-status'

const TABLE = 'video_upscale_jobs'
const PREFIX = 'video-pipeline-'
type Job = {
  id: string; user_id: string; project_id: string | null; model_id: string; resolution: UpscaleResolution;
  stage: string; generation_task_id?: string; base_provider_url?: string; base_url?: string;
  source_meta?: { duration: number; fps: number; width: number; height: number };
  upscale_request_id?: string; output_provider_url?: string; output_url?: string;
  output_meta?: Record<string, unknown>; upscale_failed: boolean; error?: string;
  preset: 'aigc' | 'general'; lease_token?: string; lease_until?: string;
  updated_at: string;
}
export function isVideoPipelineTask(taskId: string) { return taskId.startsWith(PREFIX) }
async function save(job: Job, patch: Record<string, unknown>, token?: string) {
  let query = getSupabaseAdmin().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id).eq('user_id', job.user_id)
  if (token) query = query.eq('lease_token', token)
  const { data, error } = await query.select('id').maybeSingle()
  if (error || !data) throw new Error('Could not persist the video pipeline receipt. Retain the existing task.')
  Object.assign(job, patch)
}
function status(job: Job): GetVideoStatusResult {
  const failed = job.stage === 'failed', completed = job.stage === 'completed'
  return { success: !failed, status: failed ? 'failed' : completed ? 'completed' : 'processing',
    ...(completed ? { videoUrl: job.output_url || job.base_url } : {}), baseVideoUrl: job.base_url,
    stage: job.stage, requestedResolution: job.resolution,
    actualResolution: job.upscale_failed ? '480p' : completed ? job.resolution : undefined,
    enhancementStatus: job.upscale_failed ? 'failed' : completed ? 'completed' : 'processing',
    ...(job.error ? { error: job.error } : {}),
    message: failed ? 'Video generation failed.' : completed
      ? job.upscale_failed ? 'Upscaling failed. The original 480p video is available; only the upscale charge is refunded.' : 'HD video completed.'
      : job.stage === 'submission_uncertain' || job.stage === 'submitting_upscale'
        ? 'Provider receipt needs reconciliation. Do not submit another job.'
        : job.stage === 'generating' ? 'Generating the 480p video.' : 'Enhancing video resolution.' }
}
async function store(job: Job, bytes: Buffer, suffix: string) {
  const admin = getSupabaseAdmin(), path = `${job.user_id}/${job.project_id ?? 'video-tools'}/videos/${job.id}-${suffix}.mp4`
  const { error } = await admin.storage.from('images').upload(path, bytes, { contentType: 'video/mp4', upsert: true })
  if (error) throw new Error('Could not save video. Retrying delivery will not resubmit the paid job.')
  return admin.storage.from('images').getPublicUrl(path).data.publicUrl
}
export async function createVideoPipeline(input: CreateVideoInput): Promise<CreateVideoResult> {
  if (!input.userId) return { success: false, retryable: false, message: 'Video enhancement requires an authenticated owner.' }
  if (!process.env.FAL_KEY?.trim()) return { success: false, retryable: false, message: 'Video enhancement is not configured. No provider was submitted.' }
  const model = normalizeVideoModelId(input.videoModel), eco = model === 'seedance-2.5-eco'
  const resolution = resolveVideoGenerationRoute({ model, resolution: input.videoResolution }).resolution
  if (!UPSCALE_RESOLUTIONS.includes(resolution as UpscaleResolution)) return { success: false, retryable: false, message: 'Supported enhancement resolutions: 720p, 1080p, 2K, 4K. Higher tiers need verified pricing first.' }
  if (eco && input.outputFormat === 'mov') return { success: false, retryable: false, message: 'Seedance 2.5 Eco delivers MP4. Use native Seedance for a MOV grading master.' }
  if (input.motionControl) return { success: false, retryable: false, message: 'Motion control is not supported by this route.' }
  let source: Buffer | undefined, sourceMeta: Awaited<ReturnType<typeof inspectUpscaleMedia>> | undefined
  if (!eco) {
    const urls = [...(input.videoUrl ? [input.videoUrl] : []), ...(input.videoUrls ?? [])]
    if (urls.length !== 1 || input.images.some(Boolean) || input.audioUrls?.length) return { success: false, retryable: false, message: 'Upscaling requires exactly one source video, with no image or replacement-audio references.' }
    source = await downloadUpscaleMedia(urls[0]); sourceMeta = await inspectUpscaleMedia(source)
    const billing = await input.onBeforeProviderSubmit?.({ model, resolution, durationSec: sourceMeta.duration!, outputFps: sourceMeta.fps })
    if (billing) input.reservedUpscaleCredits = billing.reservedUpscaleCredits
  }
  const id = randomUUID(), taskId = PREFIX + id
  const job = { id, user_id: input.userId, project_id: input.projectId ?? null, model_id: model,
    updated_at: new Date().toISOString(),
    resolution: resolution as UpscaleResolution, stage: eco ? 'generating' : 'saving_base',
    ...(sourceMeta ? { source_meta: sourceMeta, base_provider_url: input.videoUrl ?? input.videoUrls?.[0] } : {}), preset: eco ? 'aigc' : 'general',
    reserved_upscale_credits: input.reservedUpscaleCredits ?? 0,
    billing_tool: input.billingToolName ?? 'create_video', billing_source: input.billingSource ?? 'app', upscale_failed: false } as Job
  const { error } = await getSupabaseAdmin().from(TABLE).insert(job)
  if (error) return { success: false, retryable: false, submissionUncertain: false, message: 'Could not initialize the durable video enhancement task. No provider was submitted.' }
  try {
    if (!eco && source) {
      const url = await store(job, source, 'base')
      await save(job, { base_url: url, stage: 'ready_to_upscale' })
    } else {
      const result = await createVideo({ ...input, videoModel: 'seedance-2.5', videoResolution: '480p',
        onBeforeProviderSubmit: input.onBeforeProviderSubmit ? async usage => {
          const billing = await input.onBeforeProviderSubmit!({ ...usage, model, resolution })
          if (billing) await save(job, { reserved_upscale_credits: billing.reservedUpscaleCredits })
        } : undefined })
      if (!result.success || !result.taskId) {
        await save(job, { stage: result.submissionUncertain ? 'submission_uncertain' : 'failed', error: result.message })
        if (!result.submissionUncertain) return result
      } else {
        console.info('[video-pipeline] generation receipt', { id: job.id, taskId: result.taskId })
        await save(job, { generation_task_id: result.taskId })
      }
    }
  } catch {
    // Any saved root is recoverable. Never turn an uncertain paid receipt or a
    // Storage error into permission to submit the generation again.
    return { success: true, taskId, videoModel: model, status: 'processing', retryable: false,
      message: 'Video pipeline created; receipt/delivery reconciliation required. Poll this task; do not resubmit.' }
  }
  return { success: true, taskId, videoModel: model, provider: 'fal-bytedance-fast', status: 'processing',
    message: 'Video task created. Poll the same root through generation, upscaling and permanent delivery.' }
}

/** One leased advancement per poll; expired submission flags are never reposted. */
export async function advanceVideoPipeline(taskId: string, userId?: string): Promise<GetVideoStatusResult> {
  const id = taskId.slice(PREFIX.length)
  if (!/^[0-9a-f-]{36}$/.test(id) || !userId) throw new Error('Authenticated owner and valid video task are required.')
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from(TABLE).select('*').eq('id', id).eq('user_id', userId).maybeSingle()
  if (error || !data) throw new Error('Video pipeline unavailable or not owned by this user.')
  const job = data as Job
  if (job.stage === 'completed') {
    if (job.upscale_failed) { const { error } = await admin.rpc('refund_video_upscale_stage', { p_id: id, p_user_id: userId }); if (error) throw new Error('Upscale refund reconciliation pending.') }
    return status(job)
  }
  if (job.stage === 'failed') return status(job)
  const token = randomUUID(), now = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin.from(TABLE)
    .update({ lease_token: token, lease_until: new Date(Date.now() + 10 * 60_000).toISOString() })
    .eq('id', id).eq('user_id', userId).eq('updated_at', job.updated_at)
    .or(`lease_until.is.null,lease_until.lt.${now}`).select('id').maybeSingle()
  if (claimError) throw new Error('Unable to claim the video pipeline.')
  if (!claimed) return status(job)
  try {
    if (job.stage === 'generating') {
      if (!job.generation_task_id) return status(job)
      const { getEvolinkTask } = await import('./evolink')
      const result = await getEvolinkTask(job.generation_task_id)
      if (result.status === 'failed') await save(job, {
        stage: 'failed',
        error: [result.errorCode, result.error].filter(Boolean).join(': ') || '480p generation failed.',
      }, token)
      else if (result.status === 'completed' && result.videoUrl) await save(job, { stage: 'saving_base', base_provider_url: result.videoUrl }, token)
    }
    if (job.stage === 'saving_base' && job.base_provider_url) {
      const bytes = await downloadUpscaleMedia(job.base_provider_url), meta = await inspectUpscaleMedia(bytes)
      const url = await store(job, bytes, 'base')
      await save(job, { base_url: url, source_meta: meta, stage: 'ready_to_upscale' }, token)
    }
    if (job.stage === 'ready_to_upscale' && job.base_url && job.source_meta) {
      // The intent flag is durable BEFORE the single paid POST. A crashed or
      // ambiguous POST requires reconciliation rather than a duplicate charge.
      await save(job, { stage: 'submitting_upscale' }, token)
      try {
        const requestId = await submitByteDanceUpscale({ videoUrl: job.base_url, resolution: job.resolution, fps: job.source_meta.fps, preset: job.preset })
        console.info('[video-pipeline] upscale receipt', { id: job.id, requestId })
        await save(job, { upscale_request_id: requestId, stage: 'upscaling' }, token)
      } catch (error) {
        if (error instanceof UpscaleSubmissionError && !error.uncertain) await failUpscale(job, token)
        else await save(job, { stage: 'submission_uncertain' }, token)
      }
    }
    if (job.stage === 'upscaling' && job.upscale_request_id) {
      const result = await pollByteDanceUpscale(job.upscale_request_id)
      if (result.status === 'failed') await failUpscale(job, token)
      else if (result.status === 'completed' && result.videoUrl) await save(job, { output_provider_url: result.videoUrl, stage: 'saving_final' }, token)
    }
    if (job.stage === 'saving_final' && job.output_provider_url && job.base_url) {
      const [source, output] = await Promise.all([downloadUpscaleMedia(job.base_url), downloadUpscaleMedia(job.output_provider_url)])
      const final = await finishUpscaleMedia(source, output, job.resolution)
      const url = await store(job, final.bytes, 'enhanced')
      await save(job, { output_url: url, output_meta: final.meta, stage: 'completed' }, token)
    }
    if (job.stage === 'completed' && job.upscale_failed) {
      const { error } = await admin.rpc('refund_video_upscale_stage', { p_id: id, p_user_id: userId })
      if (error) throw new Error('Upscale refund reconciliation pending.')
    }
    return status(job)
  } finally {
    const { error } = await admin.from(TABLE).update({ lease_token: null, lease_until: null }).eq('id', id).eq('lease_token', token)
    if (error) console.warn('[video-pipeline] lease release requires expiry recovery', { id })
  }
}
async function failUpscale(job: Job, token: string) {
  if (job.model_id === 'seedance-2.5-eco' && job.base_url) await save(job, { stage: 'completed', upscale_failed: true, error: 'Enhancement failed; original 480p retained.' }, token)
  else await save(job, { stage: 'failed', error: 'Video enhancement failed.' }, token)
}
export async function reconcileVideoPipelines(): Promise<number> {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select('id,user_id')
    .or('stage.not.in.(completed,failed),and(upscale_failed.eq.true,refund_complete.eq.false)').order('updated_at').limit(10)
  if (error) throw new Error('Pipeline reconciliation query failed.')
  let processed = 0
  for (const row of data ?? []) {
    try { await advanceVideoPipeline(PREFIX + row.id, row.user_id); processed++ }
    catch { console.warn('[video-pipeline] retained task for recovery', { id: row.id }) }
  }
  return processed
}
