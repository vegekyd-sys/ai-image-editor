// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { inspectRetakeAudio, retakeAudioEvidence } from '@/lib/video-retake-audio'
import { planRetake } from '@/lib/video-retake-contract'
import type { VolcengineAsrTranscript, TranscriptUtterance } from '@/lib/volcengine-asr'

const utterance = (text: string, startMs: number | null, endMs: number | null): TranscriptUtterance => ({ text, startMs, endMs, words: [] })
const transcript = (utterances: TranscriptUtterance[]): VolcengineAsrTranscript => ({
  provider: 'volcengine', model: 'bigmodel-flash', resourceId: 'test', requestId: 'test', durationMs: 30000,
  createdAt: '', text: utterances.map(cue => cue.text).join(''), utterances,
})

describe('Retake speech evidence and audiovisual clocks', () => {
  it('maps measured source words to expanded H3 output, excluding adjacent speech', () => {
    const selected = { ...utterance('move forward', 18200, 20900), words: [
      { text: 'move', startMs: 18200, endMs: 19000 }, { text: 'forward', startMs: 19500, endMs: 20900 },
    ] }
    const evidence = retakeAudioEvidence({ transcript: transcript([
      utterance('before', 17000, 18000), selected, utterance('after', 21000, 22000),
      utterance('outside', 24000, 25000),
    ]) }, planRetake({ start: 18, end: 21 }, 30, 'fal-h3-max'))
    expect(evidence.status).toBe('transcribed')
    if (!('selectedSpeech' in evidence)) throw new Error('Missing speech evidence')
    expect(evidence.selectedSpeech).toHaveLength(1)
    expect(evidence.selectedSpeech[0].words[1]).toMatchObject({ sourceStart: 19.5, outputStart: 2.5 })
    expect(evidence.selectedSpeech[0].outputEnd).toBeCloseTo(4.833333)
    expect(evidence.adjacentSpeech.map(cue => cue.role)).toEqual(['before_selection', 'after_selection'])
    expect(evidence.adjacentSpeech[0]).not.toHaveProperty('outputStart')
  })
  it('keeps the nonzero selected offset in Seedance context output', () => {
    const evidence = retakeAudioEvidence({ transcript: transcript([utterance('walking', 9500, 11000)]) },
      planRetake({ start: 9, end: 12 }, 30, 'seedance-2.5-eco'))
    if (!('selectedSpeech' in evidence)) throw new Error('Missing speech evidence')
    expect(evidence.selectedSpeech[0]).toMatchObject({ sourceStart: 9.5, outputStart: 1, outputEnd: 2.5 })
  })
  it('handles source-range-local ASR without confusing it with original timestamps', () => {
    const evidence = retakeAudioEvidence({ transcript: transcript([utterance('local', 1000, 2000)]),
      source_range: { start_sec: 10, end_sec: 15 } }, planRetake({ start: 11, end: 14 }, 30))
    if (!('selectedSpeech' in evidence)) throw new Error('Missing speech evidence')
    expect(evidence.selectedSpeech[0]).toMatchObject({ sourceStart: 11, sourceEnd: 12, outputStart: 0 })
  })
  it('clamps crossing words only in output and keeps their real measured source times', () => {
    const evidence = retakeAudioEvidence({ transcript: transcript([{ ...utterance('crossing sentence', 17500, 21500),
      words: [{ text: 'crossing', startMs: 17500, endMs: 18500 }, { text: 'sentence', startMs: 20500, endMs: 21500 }],
    }]) }, planRetake({ start: 18, end: 21 }, 30))
    if (!('selectedSpeech' in evidence)) throw new Error('Missing speech evidence')
    expect(evidence.selectedSpeech[0].crossesSelectionBoundary).toBe(true)
    expect(evidence.selectedSpeech[0].words[0]).toMatchObject({ sourceStart: 17.5, outputStart: 0 })
    expect(evidence.selectedSpeech[0].words[1]).toMatchObject({ sourceEnd: 21.5, outputEnd: 5 })
    expect(evidence.adjacentSpeech).toHaveLength(2)
  })
  it('returns adjacent audio evidence even when the edit consumes the full crop budget', () => {
    const evidence = retakeAudioEvidence({ transcript: transcript([utterance('next', 20000, 20500)]) },
      planRetake({ start: 5, end: 20 }, 30))
    if (!('selectedSpeech' in evidence)) throw new Error('Missing speech evidence')
    expect(evidence.selectedSpeech).toEqual([])
    expect(evidence.adjacentSpeech[0].role).toBe('after_selection')
  })
  it('does not invent timestamps for untimed or empty ASR speech', () => {
    const evidence = retakeAudioEvidence({ transcript: transcript([utterance('not timed', null, null)]) }, planRetake({ start: 3, end: 6 }, 30))
    expect(evidence).toMatchObject({ status: 'transcribed', selectedSpeech: [], untimedSpeech: ['not timed'] })
    expect(retakeAudioEvidence({ transcript: transcript([]), cached: true }, planRetake({ start: 3, end: 6 }, 30)))
      .toMatchObject({ status: 'no_speech_recognized', cached: true, selectedSpeech: [] })
  })
  it('skips ASR for video with no audio track and distinguishes provider failure', async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error('service unavailable'))
    const plan = planRetake({ start: 3, end: 6 }, 30)
    expect(await inspectRetakeAudio({ hasAudio: false, plan, transcribe })).toEqual({ status: 'no_audio' })
    expect(transcribe).not.toHaveBeenCalled()
    expect(await inspectRetakeAudio({ hasAudio: true, plan, transcribe })).toMatchObject({ status: 'unavailable' })
    expect(await inspectRetakeAudio({ hasAudio: true, plan, transcribe: async () => ({ error: 'missing credentials' }) }))
      .toMatchObject({ status: 'unavailable', warning: 'missing credentials' })
  })
})
