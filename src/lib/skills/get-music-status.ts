import { getSunoTask } from '../sunoapi'

/**
 * Read-only status lookup kept for `makaron_get_music_status` / `makaron music status`.
 *
 * Music generation is synchronous now: `makaron_create_music` already returns the
 * final takes. This only re-reads a Suno task by ID; Seed Audio task IDs have no
 * pollable state and are reported as completed through the creation response.
 */
export interface GetMusicStatusInput {
  taskId: string
}

export interface MusicTrack {
  audioUrl: string
  streamAudioUrl?: string
  duration: number
  title: string
  tags: string
  trackIndex: number
}

export interface GetMusicStatusResult {
  success: boolean
  status: 'pending' | 'processing' | 'streaming' | 'completed' | 'failed'
  tracks: MusicTrack[]
  error?: string
  message: string
}

/** Seed Audio (EvoLink) task IDs; Suno task IDs are opaque hex strings. */
function isSeedAudioTaskId(taskId: string): boolean {
  return /^task-/.test(taskId)
}

export async function getMusicStatus(input: GetMusicStatusInput): Promise<GetMusicStatusResult> {
  const taskId = input.taskId?.trim()
  if (!taskId) return { success: false, status: 'failed', tracks: [], message: 'Task ID is required.' }
  if (isSeedAudioTaskId(taskId)) {
    return {
      success: true,
      status: 'completed',
      tracks: [],
      message: 'This Seed Audio task completed synchronously; use the audio URL returned by makaron_create_music.',
    }
  }

  try {
    const result = await getSunoTask(taskId)
    const tracks = result.takes
      .map((take, trackIndex) => ({
        audioUrl: take.audioUrl,
        streamAudioUrl: take.streamAudioUrl,
        duration: take.duration,
        title: take.title,
        tags: take.tags,
        trackIndex,
      }))
      .filter(track => track.audioUrl || track.streamAudioUrl)
    const message = {
      pending: 'Music task is queued.',
      processing: 'Music is generating...',
      streaming: 'Music preview available.',
      completed: tracks.length ? `${tracks.length} track(s) ready.` : 'Completed but no audio returned.',
      failed: `Music generation failed: ${result.error || 'Unknown error'}`,
    }[result.status]
    return { success: true, status: result.status, tracks, error: result.error, message }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[get_music_status error]', msg)
    return { success: false, status: 'failed', tracks: [], message: `Failed to query music status: ${msg}` }
  }
}
