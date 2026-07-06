import type { SupabaseClient } from '@supabase/supabase-js'
import { createAudio } from './create-audio'

export interface CreateMusicInput {
  prompt: string
  instrumental?: boolean
  model?: string
  style?: string
  durationSeconds?: number
  supabase?: SupabaseClient
  userId?: string
  projectId?: string
}

export interface CreateMusicResult {
  success: boolean
  taskId?: string
  status?: 'completed' | 'failed'
  audioUrl?: string
  providerAudioUrl?: string
  title?: string
  duration?: number
  tags?: string
  trackIndex?: number
  message: string
}

function buildSeedAudioPrompt(input: CreateMusicInput): string {
  const parts = [input.prompt.trim()]
  if (input.style?.trim()) parts.push(`Style tags: ${input.style.trim()}.`)
  if (input.instrumental !== false) {
    parts.push('Instrumental background music only, no vocals or lyrics.')
  } else {
    parts.push('Use subtle vocal texture only if it supports the requested music bed; avoid dominant sung lyrics unless explicitly required.')
  }
  return parts.join('\n')
}

export async function createMusic(input: CreateMusicInput): Promise<CreateMusicResult> {
  if (!input.prompt?.trim()) {
    return { success: false, status: 'failed', message: 'Music prompt is required.' }
  }

  const result = await createAudio({
    prompt: buildSeedAudioPrompt(input),
    durationSeconds: input.durationSeconds,
    title: 'Generated music',
    model: 'evolink-seed-audio',
    supabase: input.supabase,
    userId: input.userId,
    projectId: input.projectId,
  })

  if (!result.success) {
    return {
      success: false,
      status: 'failed',
      message: result.message,
    }
  }

  return {
    success: true,
    taskId: result.taskId,
    status: 'completed',
    audioUrl: result.audioUrl,
    providerAudioUrl: result.providerAudioUrl,
    title: result.title || 'Generated music',
    duration: result.duration,
    tags: ['audio', 'music', 'seed-audio', result.provider, result.model].filter(Boolean).join(','),
    trackIndex: result.trackIndex,
    message: `${result.message} Music is ready with Seed Audio.`,
  }
}
