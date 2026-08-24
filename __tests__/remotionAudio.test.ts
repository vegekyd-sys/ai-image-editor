import { describe, expect, it } from 'vitest'
import { hasRemotionAudioSources } from '@/lib/remotion-audio'

describe('Remotion audio detection', () => {
  it('keeps audio enabled for Video components because source videos can carry audio', () => {
    expect(hasRemotionAudioSources('return <Video src="clip.mp4" />')).toBe(true)
  })

  it('keeps audio enabled for Audio components', () => {
    expect(hasRemotionAudioSources('return React.createElement(Audio, { src })')).toBe(true)
  })

  it('keeps audio enabled for namespaced Remotion components', () => {
    expect(hasRemotionAudioSources('return React.createElement(Remotion.Audio, { src })')).toBe(true)
    expect(hasRemotionAudioSources('return <Remotion.Video src="clip.mp4" />')).toBe(true)
  })

  it('keeps audio enabled for OffthreadVideo components', () => {
    expect(hasRemotionAudioSources('return React.createElement(Remotion.OffthreadVideo, { src })')).toBe(true)
  })

  it('keeps audio enabled when React.createElement is assigned to a local alias', () => {
    const code = `
      const h = React.createElement;
      return h(Video, { src: props.sourceVideo, trimBefore: 30, trimAfter: 90 });
    `
    expect(hasRemotionAudioSources(code)).toBe(true)
  })

  it('does not treat an unused React.createElement alias as audio', () => {
    expect(hasRemotionAudioSources('const h = React.createElement; return h(Img, { src })')).toBe(false)
  })

  it('mutes purely visual compositions', () => {
    expect(hasRemotionAudioSources('return <AbsoluteFill><Img src="x.jpg" /></AbsoluteFill>')).toBe(false)
  })
})
