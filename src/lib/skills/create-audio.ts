import type { SupabaseClient } from '@supabase/supabase-js'
import { getAudioModelCapability, normalizeAudioModelId, validateAudioRequest } from '../audio-model-capabilities'
import {
  generateWithEvolinkSeedAudio,
  type EvolinkSeedAudioResult,
  type SeedAudioFormat,
} from '../evolink-seed-audio'
import { uploadAudio } from '../supabase/storage'

export interface CreateAudioInput {
  prompt: string
  durationSeconds?: number
  audioReferences?: string[]
  imageUrls?: string[]
  speechRate?: number
  loudnessRate?: number
  pitchRate?: number
  format?: SeedAudioFormat
  sampleRate?: number
  callbackUrl?: string
  model?: string
  title?: string
  supabase?: SupabaseClient
  userId?: string
  projectId?: string
}

export interface CreateAudioResult {
  success: boolean
  message: string
  taskId?: string
  provider?: string
  model?: string
  title?: string
  audioUrl?: string
  providerAudioUrl?: string
  duration?: number
  generationSeconds?: number
  creditsUsed?: number
  trackIndex?: number
  format?: string
  sampleRate?: number
}

async function nextTrackIndex(supabase: SupabaseClient, projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('project_music')
    .select('track_index')
    .eq('project_id', projectId)
    .order('track_index', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return Number(data?.[0]?.track_index ?? -1) + 1
}

async function persistAudioAsset(input: {
  supabase: SupabaseClient
  userId: string
  projectId: string
  prompt: string
  title: string
  result: EvolinkSeedAudioResult
}): Promise<{ audioUrl: string; trackIndex: number }> {
  const { supabase, userId, projectId, prompt, title, result } = input
  const trackIndex = await nextTrackIndex(supabase, projectId)
  let permanentUrl = result.audioUrl

  try {
    const res = await fetch(result.audioUrl)
    if (res.ok) {
      const buffer = new Uint8Array(await res.arrayBuffer())
      const storageFormat: SeedAudioFormat = ['mp3', 'wav', 'pcm', 'ogg_opus'].includes(result.format)
        ? result.format as SeedAudioFormat
        : 'wav'
      const uploaded = await uploadAudio(
        supabase,
        userId,
        projectId,
        result.taskId,
        trackIndex,
        buffer,
        storageFormat,
      )
      if (uploaded) permanentUrl = uploaded
    }
  } catch (err) {
    console.warn('[create_audio] provider audio download/upload failed:', err)
  }

  await supabase.from('project_music').upsert({
    suno_task_id: result.taskId,
    track_index: trackIndex,
    project_id: projectId,
    user_id: userId,
    prompt,
    audio_url: permanentUrl,
    suno_audio_url: result.audioUrl,
    stream_audio_url: null,
    duration: result.duration || null,
    title,
    tags: [
      'audio',
      'seed-audio',
      result.provider,
      result.model,
      `format:${result.format}`,
      `generation:${result.generationSeconds.toFixed(1)}s`,
    ].join(','),
    status: 'completed',
    selected: false,
  }, { onConflict: 'suno_task_id,track_index' })

  return { audioUrl: permanentUrl, trackIndex }
}

export async function createAudio(input: CreateAudioInput): Promise<CreateAudioResult> {
  const prompt = input.prompt.trim()
  if (!prompt) {
    return { success: false, message: 'Audio prompt is required.' }
  }

  const model = normalizeAudioModelId(input.model)
  const capability = getAudioModelCapability(model)
  const validationError = validateAudioRequest({ model, durationSeconds: input.durationSeconds })
  if (validationError) {
    return { success: false, message: validationError }
  }

  if (capability.provider !== 'evolink') {
    return {
      success: false,
      message: `${capability.label} is not available through generate_audio. Use the dedicated ${capability.provider === 'tts' ? 'generate_voiceover' : 'generate_music'} tool.`,
    }
  }

  try {
    const result = await generateWithEvolinkSeedAudio({
      prompt,
      durationSeconds: input.durationSeconds,
      audioReferences: input.audioReferences,
      imageUrls: input.imageUrls,
      speechRate: input.speechRate,
      loudnessRate: input.loudnessRate,
      pitchRate: input.pitchRate,
      format: input.format || capability.defaultFormat,
      sampleRate: input.sampleRate || capability.defaultSampleRate,
      callbackUrl: input.callbackUrl,
    })

    const title = input.title?.trim() || 'Generated audio'
    let audioUrl = result.audioUrl
    let trackIndex: number | undefined

    if (input.supabase && input.userId && input.projectId) {
      const persisted = await persistAudioAsset({
        supabase: input.supabase,
        userId: input.userId,
        projectId: input.projectId,
        prompt,
        title,
        result,
      })
      audioUrl = persisted.audioUrl
      trackIndex = persisted.trackIndex
    }

    return {
      success: true,
      message: `Audio generated with ${capability.label}.`,
      taskId: result.taskId,
      provider: result.provider,
      model: result.model,
      title,
      audioUrl,
      providerAudioUrl: result.audioUrl,
      duration: result.duration,
      generationSeconds: result.generationSeconds,
      creditsUsed: result.creditsUsed,
      trackIndex,
      format: result.format,
      sampleRate: input.sampleRate || capability.defaultSampleRate,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[create_audio error]', msg)
    return { success: false, message: `Failed to create audio: ${msg}` }
  }
}
