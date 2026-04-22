import { createSunoTask } from '../sunoapi'

export interface CreateMusicInput {
  prompt: string
  instrumental?: boolean
  model?: string
  style?: string
}

export interface CreateMusicResult {
  success: boolean
  taskId?: string
  message: string
}

export async function createMusic(input: CreateMusicInput): Promise<CreateMusicResult> {
  const { prompt, instrumental, model, style } = input

  if (!prompt) {
    return { success: false, message: 'Music prompt is required.' }
  }

  if (!process.env.SUNOAPI_KEY) {
    return { success: false, message: 'SUNOAPI_KEY is not configured.' }
  }

  try {
    const taskId = await createSunoTask({
      prompt,
      instrumental: instrumental ?? true,
      model,
      style,
    })

    return {
      success: true,
      taskId,
      message: 'Music generation started. Preview available in ~30s.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[create_music error]', msg)
    return { success: false, message: `Failed to create music task: ${msg}` }
  }
}
