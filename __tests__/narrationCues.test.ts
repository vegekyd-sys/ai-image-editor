import { describe, expect, it } from 'vitest'
import { buildNarrationCueSheet } from '@/lib/narration-cues'
import type { VolcengineAsrTranscript } from '@/lib/volcengine-asr'
import {
  assertStoryboardNarrationTimingEvidence,
  assertSubtitleSyncEvidence,
} from '@/lib/studio-run/subtitle-sync'

function transcript(): VolcengineAsrTranscript {
  return {
    provider: 'volcengine',
    model: 'bigmodel-flash',
    resourceId: 'test',
    requestId: 'request-1',
    text: '先提出问题然后展示解决方案',
    durationMs: 5200,
    createdAt: '2026-07-23T00:00:00.000Z',
    utterances: [
      {
        text: '先提出问题',
        startMs: 200,
        endMs: 2100,
        words: [
          { text: '先', startMs: 200, endMs: 500 },
          { text: '提出', startMs: 520, endMs: 1200 },
          { text: '问题', startMs: 1250, endMs: 2100 },
        ],
      },
      {
        text: '然后展示解决方案',
        startMs: 2250,
        endMs: 5000,
        words: [
          { text: '然后', startMs: 2250, endMs: 2900 },
          { text: '展示', startMs: 2950, endMs: 3550 },
          { text: '解决方案', startMs: 3600, endMs: 5000 },
        ],
      },
    ],
  }
}

describe('buildNarrationCueSheet', () => {
  it('maps script sections to authoritative seconds and frames', () => {
    const sheet = buildNarrationCueSheet({
      transcript: transcript(),
      fps: 30,
      sections: [
        { id: 'problem', text: '先提出问题' },
        { id: 'solution', text: '然后展示解决方案' },
      ],
    })

    expect(sheet.durationSeconds).toBe(5.2)
    expect(sheet.cues).toEqual([
      expect.objectContaining({
        scriptSectionId: 'problem',
        startSeconds: 0.2,
        endSeconds: 2.1,
        startFrame: 6,
        endFrame: 63,
        matchScore: 1,
      }),
      expect.objectContaining({
        scriptSectionId: 'solution',
        startSeconds: 2.25,
        endSeconds: 5,
        startFrame: 67,
        endFrame: 150,
        matchScore: 1,
      }),
    ])
  })

  it('falls back to timed utterances when word timing is unavailable', () => {
    const input = transcript()
    input.utterances = input.utterances.map(utterance => ({ ...utterance, words: [] }))
    const sheet = buildNarrationCueSheet({
      transcript: input,
      sections: [
        { id: 'problem', text: '先提出问题' },
        { id: 'solution', text: '然后展示解决方案' },
      ],
    })

    expect(sheet.cues.map(cue => [cue.startSeconds, cue.endSeconds])).toEqual([
      [0.2, 2.1],
      [2.25, 5],
    ])
  })

  it('feeds the same measured cue ranges into Storyboard and Composition gates', () => {
    const sheet = buildNarrationCueSheet({
      transcript: transcript(),
      fps: 30,
      sections: [
        { id: 'problem', text: '先提出问题' },
        { id: 'solution', text: '然后展示解决方案' },
      ],
    })
    const script = {
      sections: [
        { id: 'problem', narration: '先提出问题', onScreenText: ['提出问题'] },
        { id: 'solution', narration: '然后展示解决方案', onScreenText: ['解决方案'] },
      ],
    }
    const storyboard = {
      scenes: [
        { id: 'problem-scene', startSeconds: 0, endSeconds: 2.2 },
        { id: 'solution-scene', startSeconds: 2.2, endSeconds: 5.2 },
      ],
      narrationTimingEvidence: sheet.cues.map((cue, index) => ({
        scriptSectionId: cue.scriptSectionId,
        sceneId: index === 0 ? 'problem-scene' : 'solution-scene',
        narrationStartSeconds: cue.startSeconds,
        narrationEndSeconds: cue.endSeconds,
        timingSource: 'transcribe_audio' as const,
      })),
    }

    expect(() => assertStoryboardNarrationTimingEvidence({
      required: true,
      script,
      storyboard,
    })).not.toThrow()

    expect(() => assertSubtitleSyncEvidence({
      required: true,
      script,
      storyboard,
      compositionSceneIds: ['problem-scene', 'solution-scene'],
      evidence: sheet.cues.map((cue, index) => ({
        scriptSectionId: cue.scriptSectionId,
        sceneId: index === 0 ? 'problem-scene' : 'solution-scene',
        visualStartSeconds: index === 0 ? 0 : 2.2,
        visualEndSeconds: index === 0 ? 2.2 : 5.2,
        narrationStartSeconds: cue.startSeconds,
        narrationEndSeconds: cue.endSeconds,
        representativeFrameSeconds: (cue.startSeconds + cue.endSeconds) / 2,
        subtitleText: index === 0 ? '提出问题' : '解决方案',
        timingSource: 'transcribe_audio' as const,
      })),
    })).not.toThrow()
  })
})
