import { getSunoTask, type SunoTrack } from '../sunoapi'

export interface GetMusicStatusInput {
  taskId: string
}

export interface MusicTrack {
  audioUrl: string
  duration: number
  title: string
  tags: string
  trackIndex: number
}

export interface GetMusicStatusResult {
  success: boolean
  status: 'pending' | 'processing' | 'completed' | 'failed'
  tracks: MusicTrack[]
  error?: string
  message: string
}

export async function getMusicStatus(input: GetMusicStatusInput): Promise<GetMusicStatusResult> {
  const { taskId } = input

  if (!taskId) {
    return { success: false, status: 'failed', tracks: [], message: 'Task ID is required.' }
  }

  try {
    const result = await getSunoTask(taskId)

    let message: string
    const tracks: MusicTrack[] = []

    switch (result.status) {
      case 'pending':
        message = 'Music task is queued.'
        break
      case 'processing':
        message = 'Music is generating...'
        break
      case 'completed':
        if (result.tracks?.length) {
          result.tracks.forEach((t: SunoTrack, i: number) => {
            tracks.push({
              audioUrl: t.audioUrl,
              duration: t.duration,
              title: t.title,
              tags: t.tags,
              trackIndex: i,
            })
          })
        }
        message = tracks.length ? `${tracks.length} track(s) ready` : 'Completed but no audio yet.'
        break
      case 'failed':
        message = `Music generation failed: ${result.error || 'Unknown error'}`
        break
    }

    return {
      success: true,
      status: result.status,
      tracks,
      error: result.error,
      message,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[get_music_status error]', msg)
    return {
      success: false,
      status: 'failed',
      tracks: [],
      message: `Failed to query music status: ${msg}`,
    }
  }
}
