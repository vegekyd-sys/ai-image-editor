import { randomUUID, createHash } from 'node:crypto'
import { getSupabaseAdmin } from './supabase/service'
import { readProviderImage } from './provider-image-preflight'
import { createVideo, type CreateVideoInput, type CreateVideoResult } from './skills/create-video'
import { getVideoStatus, type GetVideoStatusResult } from './skills/get-video-status'
import { planRetake, retakePrompt, resolveRetakeModel, validateRetakeRange, type RetakePlan } from './video-retake-contract'
import { inspectRetakeSource, extractRetakeContext, assembleRetake } from './video-retake-media'
import { submitLtxRetake, pollLtxRetake, LtxSubmissionError } from './fal-ltx-retake'
import { VIDEO_PLACEHOLDER_IMAGE } from './editor/timeline-derivations'
import type { VideoMeta } from '@/types'
import { toPublicStorageUrl } from './supabase/storage'

const TABLE = 'video_retake_jobs', PREFIX = 'video-retake-'
type Job = {
  id: string; user_id: string; project_id: string | null; fingerprint: string; stage: string;
  source_url: string; instruction: string; model_id: string; resolution: string;
  plan: RetakePlan; source_meta: Record<string, unknown>; context_url?: string;
  provider_task_id?: string; patch_url?: string; output_url?: string;
  error?: string; updated_at: string; created_at: string; timings: Record<string, number>;
}
async function save(job: Job, patch: Partial<Job>, lease?: string) {
  let query = getSupabaseAdmin().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id).eq('user_id', job.user_id)
  if (lease) query = query.eq('lease_token', lease)
  const { data, error } = await query.select('id').maybeSingle()
  if (error || !data) throw new Error('Retake receipt could not be saved. Keep this task; do not resubmit.')
  Object.assign(job, patch)
}
async function store(job: Job, bytes: Buffer, suffix: string) {
  const admin = getSupabaseAdmin(), path = `${job.user_id}/${job.project_id ?? 'video-tools'}/videos/retake-${job.id}-${suffix}.mp4`
  const { error } = await admin.storage.from('images').upload(path, bytes, { contentType: 'video/mp4', upsert: true })
  if (error) throw new Error('Could not save Retake media. Delivery can be retried without regeneration.')
  return toPublicStorageUrl(admin.storage.from('images').getPublicUrl(path).data.publicUrl)
}
export function retakeVideoMeta(job: Job): VideoMeta {
  return { taskId: PREFIX + job.id, videoUrl: job.output_url ?? null, prompt: job.instruction,
    sourceSnapshotIds: [], sourceUrls: [job.source_url], status: job.stage === 'completed' ? 'completed' : job.stage === 'failed' ? 'failed' : 'processing',
    duration: job.plan.sourceDuration, model: job.model_id, resolution: job.resolution as VideoMeta['resolution'], operation: 'edit',
    createdAt: job.created_at, error: job.error, pipelineStage: job.stage,
    retake: { start: job.plan.start, end: job.plan.end, sourceUrl: job.source_url },
    width: Number(job.source_meta.width), height: Number(job.source_meta.height) }
}
async function publish(job: Job) {
  if (!job.project_id) return
  const admin = getSupabaseAdmin()
  const { data: existing, error: readError } = await admin.from('snapshots').select('id,video_meta').eq('id', job.id).maybeSingle()
  if (readError) throw new Error('Cannot read Retake snapshot receipt.')
  if (existing) {
    if (existing.video_meta?.status === 'abandoned') return
    const { error } = await admin.from('snapshots').update({ video_meta: retakeVideoMeta(job) }).eq('id', job.id).eq('project_id', job.project_id)
    if (error) throw new Error('Could not update Retake snapshot.')
  } else {
    const { data: order, error: orderError } = await admin.rpc('next_sort_order', { p_project_id: job.project_id })
    if (orderError) throw new Error('Could not allocate Retake snapshot order.')
    const { error } = await admin.from('snapshots').insert({ id: job.id, project_id: job.project_id, type: 'video',
      image_url: VIDEO_PLACEHOLDER_IMAGE, tips: [], message_id: '', sort_order: order ?? 0, video_meta: retakeVideoMeta(job) })
    if (error) throw new Error('Could not publish Retake snapshot.')
  }
}
function status(job: Job): GetVideoStatusResult {
  return { success: job.stage !== 'failed', status: job.stage === 'completed' ? 'completed' : job.stage === 'failed' ? 'failed' : 'processing',
    videoUrl: job.output_url, stage: job.stage, error: job.error,
    message: job.stage === 'completed' ? `Retake completed: replaced ${job.plan.start}-${job.plan.end}s; original audio and total duration preserved.`
      : job.stage === 'failed' ? job.error ?? 'Retake failed.'
      : job.stage === 'submission_uncertain' || job.stage === 'submitting' ? 'Retake submission receipt needs reconciliation. Do not submit another generation.'
      : job.stage === 'assembling' ? 'Putting the new interval back into the original video.' : 'Retaking the selected interval.' }
}
async function settle(job: Job) {
  if (job.stage === 'completed' || job.stage === 'failed') {
    const { settleMcpVideoStatus } = await import('./billing/mcp-video')
    await settleMcpVideoStatus(job.user_id, PREFIX + job.id, job.stage)
  }
}

export async function createVideoRetake(input: CreateVideoInput): Promise<CreateVideoResult> {
  let job: Job | undefined
  let posting = false
  try {
    if (!input.userId || !input.retake || !input.videoUrl) throw new Error('Retake requires an authenticated owner, source video and start/end seconds.')
    validateRetakeRange(input.retake)
    const model = resolveRetakeModel(input.videoModel)
    if (!input.script.trim()) throw new Error('Describe what to change in the selected interval.')
    if (input.images.some(Boolean) || input.videoUrls?.length || input.audioUrls?.length || input.motionControl) throw new Error('Retake accepts exactly one source video without extra media references.')
    const admin = getSupabaseAdmin()
    if (input.projectId) {
      const { data, error } = await admin.from('projects').select('id').eq('id', input.projectId).eq('user_id', input.userId).maybeSingle()
      if (error || !data) throw new Error('Retake project is unavailable or not owned by this user.')
    }
    const id = input.billingRequestId ?? randomUUID()
    const fingerprint = createHash('sha256').update(JSON.stringify([input.videoUrl, input.retake, input.script, model, input.videoResolution, input.projectId])).digest('hex')
    const { data: old, error: oldError } = await admin.from(TABLE).select('*').eq('id', id).eq('user_id', input.userId).maybeSingle()
    if (oldError) throw new Error('Retake task storage is not configured. No provider submitted.')
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error('Retake request conflict: reuse the same ID only with identical inputs.')
      return { success: old.stage !== 'failed', taskId: PREFIX + id, videoModel: model, snapshotId: old.project_id ? id : undefined,
        status: old.stage === 'completed' ? 'completed' : old.stage === 'failed' ? 'failed' : 'processing', videoUrl: old.output_url, retryable: false, message: status(old as Job).message }
    }
    const started = performance.now()
    const source = await readProviderImage(input.videoUrl, 512 * 1024 * 1024)
    const meta = await inspectRetakeSource(source)
    const plan = planRetake(input.retake, meta.duration!, model)
    if (Math.round(plan.end * meta.fps!) <= Math.round(plan.start * meta.fps!)) throw new Error('Retake interval must include at least one source frame.')
    const now = new Date().toISOString()
    job = { id, user_id: input.userId, project_id: input.projectId ?? null, fingerprint, stage: 'preparing', source_url: input.videoUrl,
      instruction: input.script, model_id: model, resolution: input.videoResolution && input.videoResolution !== 'auto' ? input.videoResolution : model === 'fal-h3-max' ? '768p' : '720p',
      plan, source_meta: { fps: meta.fps, width: meta.width, height: meta.height, duration: meta.duration, audioCodec: meta.audioCodec, frameCount: meta.frameCount },
      timings: {}, created_at: now, updated_at: now }
    const { error: insertError } = await admin.from(TABLE).insert(job)
    if (insertError) throw new Error('Could not create the Retake receipt. No provider submitted.')
    // Existing Makaron public objects already persist across provider polling.
    const sourceUrl = new URL(input.videoUrl)
    if (sourceUrl.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin || !sourceUrl.pathname.startsWith('/storage/v1/object/public/images/')) {
      await save(job, { source_url: await store(job, source, 'source') })
    }
    const context = await extractRetakeContext(source, plan)
    const contextUrl = await store(job, context, 'context')
    await save(job, { context_url: contextUrl, stage: 'prepared', timings: { preparationMs: performance.now() - started } })
    const prompt = retakePrompt(input.script, plan)
    let result: CreateVideoResult
    const beforeSubmit = async (usage: Parameters<NonNullable<CreateVideoInput['onBeforeProviderSubmit']>>[0]) => {
      const reservation = await input.onBeforeProviderSubmit?.(usage)
      await save(job!, { stage: 'submitting' })
      posting = true
      return reservation
    }
    if (model === 'ltx-2.3-retake') {
      await beforeSubmit({ model, resolution: '720p', operation: 'edit', durationSec: plan.end - plan.start })
      const requestId = await submitLtxRetake(contextUrl, input.script, plan.patchOffset, plan.end - plan.start)
      result = { success: true, taskId: requestId, message: 'LTX Retake submitted.' }
    } else {
      result = await createVideo({ ...input, retake: undefined, videoUrl: contextUrl, videoUrls: undefined,
        script: prompt, duration: model === 'seedance-2.5' ? -1 : plan.generationDuration,
        referenceVideoDuration: plan.contextEnd - plan.contextStart, referenceVideoMetas: undefined,
        videoModel: model, videoResolution: job.resolution as CreateVideoInput['videoResolution'],
        videoOperation: model === 'seedance-2.5' ? 'edit' : 'generate', videoReferType: 'feature',
        onBeforeProviderSubmit: beforeSubmit })
    }
    if (!result.success || !result.taskId) {
      // A preflight failure never posted. Once posted, an unclassified missing
      // receipt must retain the reservation rather than encourage a paid retry.
      const uncertain = posting && result.submissionUncertain !== false && !result.errorCode
      await save(job, { stage: uncertain ? 'submission_uncertain' : 'failed', error: result.message })
      return { ...result, submissionUncertain: uncertain, taskId: uncertain ? PREFIX + id : undefined }
    }
    await save(job, { provider_task_id: result.taskId, stage: 'generating', timings: { ...job.timings, submittedMs: performance.now() - started } })
    await publish(job)
    return { success: true, taskId: PREFIX + id, videoModel: model, snapshotId: input.projectId ? id : undefined,
      status: 'processing', sourceDuration: meta.duration!, retryable: false, message: `Retake submitted for ${plan.start}-${plan.end}s. Poll this task through generation and automatic full-video assembly. No merge confirmation is needed.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retake failed.'
    const uncertain = posting && !(error instanceof LtxSubmissionError && !error.uncertain)
    if (job) {
      if (!job.provider_task_id) await save(job, { stage: uncertain ? 'submission_uncertain' : 'failed', error: message }).catch(() => {})
      return { success: !!job.provider_task_id || uncertain, taskId: job.provider_task_id || uncertain ? PREFIX + job.id : undefined,
        snapshotId: job.project_id && job.provider_task_id ? job.id : undefined, videoModel: job.model_id, status: 'processing',
        sourceDuration: job.plan.sourceDuration, submissionUncertain: uncertain, retryable: false, message }
    }
    return { success: false, retryable: false, submissionUncertain: false, message }
  }
}

export async function advanceVideoRetake(taskId: string, userId?: string): Promise<GetVideoStatusResult> {
  if (!userId || !/^video-retake-[0-9a-f-]{36}$/.test(taskId)) throw new Error('Retake requires its authenticated owner and a valid task ID.')
  const admin = getSupabaseAdmin(), id = taskId.slice(PREFIX.length)
  const { data, error } = await admin.from(TABLE).select('*').eq('id', id).eq('user_id', userId).maybeSingle()
  if (error || !data) throw new Error('Retake task unavailable or not owned by this user.')
  const job = data as Job
  if (job.stage === 'completed' || job.stage === 'failed') { await publish(job); await settle(job); return status(job) }
  const token = randomUUID(), now = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin.from(TABLE).update({ lease_token: token, lease_until: new Date(Date.now() + 5 * 60_000).toISOString() })
    .eq('id', id).eq('user_id', userId).eq('updated_at', job.updated_at).or(`lease_until.is.null,lease_until.lt.${now}`).select('id').maybeSingle()
  if (claimError) throw new Error('Could not claim Retake delivery.')
  if (!claimed) return status(job)
  try {
    if (job.stage === 'generating' && job.provider_task_id) {
      const result = job.model_id === 'ltx-2.3-retake' ? await pollLtxRetake(job.provider_task_id)
        : await getVideoStatus({ taskId: job.provider_task_id, userId })
      if (result.status === 'failed' && !('queryFailed' in result && result.queryFailed)) await save(job, { stage: 'failed', error: result.error ?? 'Retake generation failed.' }, token)
      else if (result.status === 'completed' && result.videoUrl) {
        await save(job, { stage: 'saving_patch', patch_url: result.videoUrl, timings: { ...job.timings, generationMs: Date.now() - Date.parse(job.created_at) - (job.timings.submittedMs ?? 0) } }, token)
      }
    }
    if (job.stage === 'saving_patch' && job.patch_url) {
      const bytes = await readProviderImage(job.patch_url, 512 * 1024 * 1024, { falAsset: job.model_id !== 'seedance-2.5', evolinkAsset: job.model_id === 'seedance-2.5' })
      const permanentPatch = await store(job, bytes, 'patch')
      await save(job, { patch_url: permanentPatch, stage: 'assembling' }, token)
    }
    if (job.stage === 'assembling' && job.patch_url) {
      const started = performance.now()
      const [source, patch] = await Promise.all([readProviderImage(job.source_url, 512 * 1024 * 1024), readProviderImage(job.patch_url, 512 * 1024 * 1024)])
      const final = await assembleRetake(source, patch, job.plan)
      const outputUrl = await store(job, final.bytes, 'final')
      await save(job, { output_url: outputUrl, stage: 'completed', timings: { ...job.timings, assemblyMs: performance.now() - started, totalMs: Date.now() - Date.parse(job.created_at) } }, token)
    }
    await publish(job)
    await settle(job)
    return status(job)
  } catch {
    // A read/storage/assembly error is recoverable and never creates another paid task.
    return { ...status(job), queryFailed: true, message: 'Retake delivery is pending. Poll this same task; do not regenerate.' }
  } finally {
    await admin.from(TABLE).update({ lease_token: null, lease_until: null }).eq('id', id).eq('lease_token', token)
  }
}

export async function reconcileVideoRetakes(): Promise<number> {
  const { data, error } = await getSupabaseAdmin().from(TABLE).select('id,user_id').in('stage', ['generating', 'saving_patch', 'assembling'])
    .order('updated_at').limit(5)
  if (error) return 0
  let done = 0
  for (const job of data ?? []) { const result = await advanceVideoRetake(PREFIX + job.id, job.user_id); if (result.status === 'completed' || result.status === 'failed') done++ }
  return done
}
