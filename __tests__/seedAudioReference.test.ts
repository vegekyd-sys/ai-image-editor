import { describe, expect, it } from 'vitest'
import { validateSeedAudioSourceRanges } from '@/lib/seed-audio-reference'

describe('Seed Audio source voice ranges', () => {
  it('accepts ordered edit ranges totaling 2-30 seconds', () => {
    expect(validateSeedAudioSourceRanges([
      { startSec: 1.2, endSec: 5.2 },
      { startSec: 8, endSec: 15 },
    ])).toEqual({ durationSeconds: 11 })
  })

  it('rejects invalid, reordered, short, and overlong ranges', () => {
    expect(() => validateSeedAudioSourceRanges([])).toThrow('At least one')
    expect(() => validateSeedAudioSourceRanges([{ startSec: 3, endSec: 2 }])).toThrow('startSec < endSec')
    expect(() => validateSeedAudioSourceRanges([
      { startSec: 5, endSec: 7 },
      { startSec: 2, endSec: 4 },
    ])).toThrow('playback order')
    expect(() => validateSeedAudioSourceRanges([{ startSec: 1, endSec: 2 }])).toThrow('at least 2 seconds')
    expect(() => validateSeedAudioSourceRanges([{ startSec: 0, endSec: 31 }])).toThrow('30 seconds or less')
  })
})
