import { describe, expect, it } from 'vitest'
import { parseEbur128Summary } from '@/lib/ffmpeg-runtime'

describe('parseEbur128Summary', () => {
  it('reads the final integrated loudness and true peak summary', () => {
    expect(parseEbur128Summary(`
Summary:

  Integrated loudness:
    I:         -13.5 LUFS
    Threshold: -23.9 LUFS

  True peak:
    Peak:        -0.0 dBFS
`)).toEqual({ integratedLufs: -13.5, truePeakDbfs: -0 })
  })

  it('does not invent values when ffmpeg returned no summary', () => {
    expect(parseEbur128Summary('no audio stream')).toBeNull()
  })
})
