import type { VolcengineAsrTranscript, TranscriptWord } from './volcengine-asr'
import type { RetakePlan } from './video-retake-contract'
import { retakeOutputTime } from './video-retake-inspection'

interface TranscriptResult {
  transcript?: VolcengineAsrTranscript
  error?: string
  cached?: boolean
  transcriptPath?: string
  source_range?: { start_sec: number; end_sec: number }
}

function timed(start: number | null, end: number | null): start is number {
  return start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end > start
}

/** ASR times are relative to its input. Return source evidence separately from
 * output cues: assembly restores the original audio after retiming the visuals. */
export function retakeAudioEvidence(result: TranscriptResult, plan: RetakePlan) {
  if (!result.transcript) return { status: 'unavailable' as const, warning: result.error || 'ASR returned no transcript. Do not invent speech or synchronization timings.' }
  const transcript = result.transcript
  const offset = result.source_range?.start_sec ?? 0
  // Speech context can extend beyond the provider crop (which may consume the
  // full 15s budget); it is evidence only and never expands the replacement.
  const contextStart = Math.max(0, Math.min(plan.contextStart, plan.start - 1))
  const contextEnd = Math.min(plan.sourceDuration, Math.max(plan.contextEnd, plan.end + 1))
  const cues = transcript.utterances.flatMap(utterance => {
    if (!timed(utterance.startMs, utterance.endMs)) return []
    const sourceStart = offset + utterance.startMs / 1000
    const sourceEnd = offset + utterance.endMs! / 1000
    if (sourceEnd <= contextStart || sourceStart >= contextEnd) return []
    const words = utterance.words.flatMap((word: TranscriptWord) => timed(word.startMs, word.endMs)
      ? [{ text: word.text, sourceStart: offset + word.startMs / 1000, sourceEnd: offset + word.endMs! / 1000 }]
      : [])
    return [{ text: utterance.text, sourceStart, sourceEnd, words }]
  })
  const selectedSpeech = cues.filter(cue => cue.sourceEnd > plan.start && cue.sourceStart < plan.end).map(cue => ({
    ...cue,
    crossesSelectionBoundary: cue.sourceStart < plan.start || cue.sourceEnd > plan.end,
    // Clamp only the output overlap. Keep actual source word/utterance times.
    outputStart: retakeOutputTime(plan, Math.max(plan.start, cue.sourceStart)),
    outputEnd: retakeOutputTime(plan, Math.min(plan.end, cue.sourceEnd)),
    words: cue.words.filter(word => word.sourceEnd > plan.start && word.sourceStart < plan.end).map(word => ({
      ...word, outputStart: retakeOutputTime(plan, Math.max(plan.start, word.sourceStart)),
      outputEnd: retakeOutputTime(plan, Math.min(plan.end, word.sourceEnd)),
    })),
  }))
  const adjacentSpeech = cues.flatMap(cue => {
    return ([{ role: 'before_selection', start: contextStart, end: plan.start },
      { role: 'after_selection', start: plan.end, end: contextEnd }] as const).flatMap(range => {
      const start = Math.max(range.start, cue.sourceStart), end = Math.min(range.end, cue.sourceEnd)
      if (end <= start) return []
      return [{ role: range.role, text: cue.text, sourceStart: cue.sourceStart, sourceEnd: cue.sourceEnd,
        contextOverlap: { start, end }, words: cue.words.filter(word => word.sourceEnd > start && word.sourceStart < end) }]
    })
  })
  const untimed = transcript.utterances.filter(cue => !timed(cue.startMs, cue.endMs)).map(cue => cue.text)
  const hasSpeech = !!transcript.text.trim() || transcript.utterances.some(cue => cue.text.trim())
  return {
    status: hasSpeech ? 'transcribed' as const : 'no_speech_recognized' as const,
    provider: transcript.provider, model: transcript.model, cached: !!result.cached, transcriptPath: result.transcriptPath,
    selectedSpeech, adjacentSpeech,
    ...(untimed.length || (hasSpeech && !transcript.utterances.length) ? {
      untimedSpeech: untimed.length ? untimed : [transcript.text],
      warning: 'Some speech has no measured timing and cannot be attributed to this selection or used for precise synchronization.',
    } : {}),
    timingContract: 'sourceStart/sourceEnd are original-source seconds. outputStart/outputEnd are measured provider-output seconds, mapped for visual retiming; they are NOT regenerated dialogue timing. Source speech is evidence. audio_mode=original retains the full source audio; generated replaces selected audio and must be checked against its new dialogue, not these source speech times. Whole-sentence text may cross the selection; use measured selected words for local timing. Adjacent speech is outside the replacement. ASR is speech evidence, not sound-effect, music-beat or lip-sync verification.',
  }
}

export async function inspectRetakeAudio(input: { hasAudio: boolean; plan: RetakePlan; transcribe: () => Promise<TranscriptResult> }) {
  if (!input.hasAudio) return { status: 'no_audio' as const }
  try { return retakeAudioEvidence(await input.transcribe(), input.plan) }
  catch (error) { return { status: 'unavailable' as const, warning: `ASR unavailable: ${error instanceof Error ? error.message : String(error)}. Do not invent speech or synchronization timings.` } }
}
