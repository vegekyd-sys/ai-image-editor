import { describe, expect, it } from 'vitest'
import {
  buildNarrationCueSheet,
  normalizeExpectedNarrationSections,
} from '@/lib/narration-cues'
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
  it('drops structured-tool placeholders without weakening real script verification', () => {
    expect(normalizeExpectedNarrationSections([{ id: '_', text: '_' }])).toBeUndefined()
    expect(normalizeExpectedNarrationSections([{ id: 'placeholder', text: 'placeholder' }])).toBeUndefined()
    expect(normalizeExpectedNarrationSections([{ id: 'placeholder', text: 'x' }])).toBeUndefined()
    expect(normalizeExpectedNarrationSections([{ id: 'x', text: 'x' }])).toBeUndefined()
    expect(normalizeExpectedNarrationSections([{ id: 'source', text: 'source' }])).toBeUndefined()
    expect(normalizeExpectedNarrationSections([{ id: 'hook', text: '真实旁白' }])).toEqual([
      { id: 'hook', text: '真实旁白' },
    ])
  })

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

  it('rejects a Japanese script when ASR returns unrelated romanized fragments', () => {
    const input = transcript()
    input.text = 'Chotto matte. Yorugohan mo, yoshokumo, tabeyo.'
    input.utterances = [
      {
        text: input.text,
        startMs: 0,
        endMs: 5200,
        words: [
          { text: 'Chotto', startMs: 0, endMs: 600 },
          { text: 'matte', startMs: 650, endMs: 1100 },
          { text: 'Yorugohan', startMs: 1200, endMs: 2200 },
          { text: 'mo', startMs: 2250, endMs: 2500 },
          { text: 'yoshokumo', startMs: 2600, endMs: 3700 },
          { text: 'tabeyo', startMs: 3800, endMs: 5000 },
        ],
      },
    ]

    expect(() => buildNarrationCueSheet({
      transcript: input,
      sections: [
        { id: 'hook', text: 'ちょっと待って。' },
        { id: 'action', text: '夜ごはんも、洋食も、食べよう。' },
      ],
    })).toThrow(/Narration verification failed/)
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
