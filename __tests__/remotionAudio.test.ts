import { describe, expect, it } from 'vitest'
import { hasRemotionAudioSources } from '@/lib/remotion-audio'

describe('Remotion audio detection', () => {
  it('keeps audio enabled for Video components because source videos can carry audio', () => {
    expect(hasRemotionAudioSources('return <Video src="clip.mp4" />')).toBe(true)
  })

  it('keeps audio enabled for Audio components', () => {
    expect(hasRemotionAudioSources('return React.createElement(Audio, { src })')).toBe(true)
  })

  it('mutes purely visual compositions', () => {
    expect(hasRemotionAudioSources('return <AbsoluteFill><Img src="x.jpg" /></AbsoluteFill>')).toBe(false)
  })
})
