import { synthesizeWithVolcengineTts, type VolcengineTtsResult } from '../volcengine-tts'

export interface CreateVoiceoverInput {
  text: string
  voiceId?: string
  resourceId?: string
  title?: string
  speechRate?: number
  contextPrompt?: string
}

export interface CreateVoiceoverResult {
  success: boolean
  message: string
  taskId?: string
  title?: string
  audio?: Uint8Array
  tts?: VolcengineTtsResult
}

/**
 * @deprecated Internal legacy fallback only. Do not expose this as an Agent tool
 * or route normal narration here; all Agent voiceover generation uses Seed Audio.
 */
export async function createVoiceover(input: CreateVoiceoverInput): Promise<CreateVoiceoverResult> {
  const text = input.text.trim()
  if (!text) {
    return { success: false, message: 'Voiceover text is required.' }
  }

  try {
    const tts = await synthesizeWithVolcengineTts({
      text,
      voiceId: input.voiceId,
      resourceId: input.resourceId,
      speechRate: input.speechRate,
      contextTexts: input.contextPrompt ? [input.contextPrompt] : undefined,
      enableTimestamp: true,
    })

    return {
      success: true,
      taskId: tts.taskId,
      title: input.title || 'Generated voiceover',
      audio: tts.audio,
      tts,
      message: 'Voiceover generated.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[create_voiceover error]', msg)
    return { success: false, message: `Failed to create voiceover: ${msg}` }
  }
}
