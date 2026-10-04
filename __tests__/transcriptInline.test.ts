import { describe, expect, it } from 'vitest'
import {
  formatInlineWordTimingCoverageNotice,
  formatTranscriptForModel,
} from '../src/lib/transcript-inline'
import type { VolcengineAsrTranscript } from '../src/lib/volcengine-asr'

function transcript(wordCount: number): VolcengineAsrTranscript {
  const words = Array.from({ length: wordCount }, (_, index) => ({
    text: `词${index}`,
    startMs: index * 120,
    endMs: (index + 1) * 120,
  }))
  return {
    provider: 'volcengine',
    model: 'bigmodel-flash',
    resourceId: 'test',
    requestId: 'request',
    text: words.map(word => word.text).join(''),
    durationMs: wordCount * 120,
    utterances: [{
      text: words.map(word => word.text).join(''),
      startMs: 0,
      endMs: wordCount * 120,
      words,
    }],
    createdAt: '2026-08-22T00:00:00.000Z',
  }
}

describe('inline transcript word timing coverage', () => {
  it('marks long utterances as truncated and exposes the measured coverage end', () => {
    const formatted = formatTranscriptForModel(transcript(200))

    expect(formatted.wordTimingTruncated).toBe(true)
    expect(formatted.text).toContain(' | ...')
    expect(formatted.truncatedUtterances).toHaveLength(1)
    expect(formatted.truncatedUtterances[0].inlineWordTimingEndMs).toBeGreaterThan(0)
    expect(formatted.truncatedUtterances[0].inlineWordTimingEndMs).toBeLessThan(24_000)
    expect(formatted.truncatedUtterances[0].utteranceEndMs).toBe(24_000)

    const notice = formatInlineWordTimingCoverageNotice(formatted, 'project/transcripts/asr-request.json')
    expect(notice).toContain('"wordTimingTruncated":true')
    expect(notice).toContain('"transcriptPath":"project/transcripts/asr-request.json"')
    expect(notice).toContain('read transcriptPath with read_file')
    expect(notice).toContain('do not retranscribe')
  })

  it('does not raise the signal when every word timing is inline', () => {
    const formatted = formatTranscriptForModel(transcript(5))

    expect(formatted.wordTimingTruncated).toBe(false)
    expect(formatted.truncatedUtterances).toEqual([])
    expect(formatted.text).not.toContain('...')
    expect(formatInlineWordTimingCoverageNotice(formatted, 'unused.json')).toBe('')
  })
})
