import { getSunoTask } from '../sunoapi'

export interface GetMusicStatusInput {
  taskId: string
}

export interface GetMusicStatusResult {
  success: boolean
  status: 'pending' | 'processing' | 'completed' | 'failed'
  audioUrl?: string
  duration?: number
  title?: string
  error?: string
  message: string
}

export async function getMusicStatus(input: GetMusicStatusInput): Promise<GetMusicStatusResult> {
  const { taskId } = input

  if (!taskId) {
    return { success: false, status: 'failed', message: 'Task ID is required.' }
  }

  try {
    const result = await getSunoTask(taskId)

    let message: string
    let audioUrl: string | undefined
    let duration: number | undefined
    let title: string | undefined

    switch (result.status) {
      case 'pending':
        message = 'Music task is queued.'
        break
      case 'processing':
        message = 'Music is generating. This typically takes 2-3 minutes.'
        break
      case 'completed':
        // Pick the first track
        if (result.tracks?.length) {
          audioUrl = result.tracks[0].audioUrl
          duration = result.tracks[0].duration
          title = result.tracks[0].title
        }
        message = audioUrl ? 'Music generation completed!' : 'Music completed but URL not available yet.'
        break
      case 'failed':
        message = `Music generation failed: ${result.error || 'Unknown error'}`
        break
    }

    return {
      success: true,
      status: result.status,
      audioUrl,
      duration,
      title,
      error: result.error,
      message,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[get_music_status error]', msg)
    return {
      success: false,
      status: 'failed',
      message: `Failed to query music status: ${msg}`,
    }
  }
}
