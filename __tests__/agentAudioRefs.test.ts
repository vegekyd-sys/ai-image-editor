import { describe, expect, it } from 'vitest'
import { resolveAudioRefs } from '@/lib/audio-reference-resolver'

describe('generate_animation audio references', () => {
  it('accepts Audio Index labels and HTTPS outputs prepared by run_code', () => {
    expect(resolveAudioRefs([
      { audioUrl: 'https://example.com/indexed.mp3', title: 'Indexed voice' },
    ], [
      'audio_1',
      'https://cdn.example.com/workspace/source-voice.mp3',
    ])).toEqual({
      audioUrls: [
        'https://example.com/indexed.mp3',
        'https://cdn.example.com/workspace/source-voice.mp3',
      ],
    })
  })

  it('still rejects unresolved labels', () => {
    expect(resolveAudioRefs([], ['audio_3'])).toMatchObject({
      audioUrls: [],
      error: expect.stringContaining('Invalid audio_refs: audio_3'),
    })
  })
})
