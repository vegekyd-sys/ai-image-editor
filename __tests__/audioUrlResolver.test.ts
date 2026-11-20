import { describe, expect, it, vi } from 'vitest'
import { resolveAudioUrlsInCode, resolveExportAudioProp } from '@/lib/audio-url-resolver'

function supabaseWithTracks(tracks: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: tracks })),
        })),
      })),
    })),
  }
}

describe('resolveAudioUrlsInCode', () => {
  it('replaces extensionless removeai stream URLs with permanent Makaron CDN audio', async () => {
    const code = 'return <Audio src="https://musicfile.removeai.ai/NWEyZjk4MjctOTU5ZS00YTZkLThkMDMtMjk5YWU3Zjc5NGZi" />'
    const permanent = 'https://cdn.makaron.app/storage/v1/object/public/images/user/project/music/song.mp3'
    const supabase = supabaseWithTracks([{
      audio_url: permanent,
      suno_audio_url: 'https://tempfile.aiquickdraw.com/r/source.mp3',
      stream_audio_url: 'https://musicfile.removeai.ai/NWEyZjk4MjctOTU5ZS00YTZkLThkMDMtMjk5YWU3Zjc5NGZi',
    }])

    const result = await resolveAudioUrlsInCode(code, 'project-1', supabase as never)

    expect(result.changed).toBe(true)
    expect(result.code).toContain(permanent)
    expect(result.code).not.toContain('musicfile.removeai.ai')
  })

  it('still replaces tempfile URLs when the permanent URL is Supabase-hosted', async () => {
    const code = 'return <Audio src="https://tempfile.aiquickdraw.com/r/source.mp3" />'
    const permanent = 'https://abc.supabase.co/storage/v1/object/public/images/user/project/music/song.mp3'
    const supabase = supabaseWithTracks([{
      audio_url: permanent,
      suno_audio_url: 'https://tempfile.aiquickdraw.com/r/source.mp3',
      stream_audio_url: null,
    }])

    const result = await resolveAudioUrlsInCode(code, 'project-1', supabase as never)

    expect(result.changed).toBe(true)
    expect(result.code).toContain(permanent)
  })
})

describe('resolveExportAudioProp', () => {
  const root = 'https://cdn.makaron.app/storage/v1/object/public/images/'
  const props = { audio: root + 'owner/project/audio/sound.wav', volume: 0.5 }
  function storage(info: ReturnType<typeof vi.fn>) {
    return { storage: { from: () => ({ info, getPublicUrl: () => ({ data: { publicUrl: root } }) }) } } as never
  }
  it('uses the existing audio with the same filename in this project workspace', async () => {
    const info = vi.fn().mockResolvedValueOnce({ error: { statusCode: '404' } })
      .mockResolvedValueOnce({ data: { contentType: 'audio/wav' } })
    const result = await resolveExportAudioProp(props, 'project', 'owner', storage(info))
    expect(result).toEqual({ ...props, audio: root + 'owner/workspace/project/media/sound.wav' })
    expect(info.mock.calls).toEqual([['owner/project/audio/sound.wav'], ['owner/workspace/project/media/sound.wav']])
    expect(props.audio).toBe(root + 'owner/project/audio/sound.wav')
  })
  it.each([{ data: {} }, { error: { statusCode: '403' } }, { error: { statusCode: '503' } }])(
    'keeps the original unless Storage confirms it is missing', async response => {
      const info = vi.fn().mockResolvedValue(response)
      expect(await resolveExportAudioProp(props, 'project', 'owner', storage(info))).toBe(props)
      expect(info).toHaveBeenCalledTimes(1)
    },
  )
  it.each([{ data: { contentType: 'image/png' } }, { data: null }])('requires an audio replacement', async response => {
    const info = vi.fn().mockResolvedValueOnce({ error: { statusCode: 'NoSuchKey' } }).mockResolvedValueOnce(response)
    expect(await resolveExportAudioProp(props, 'project', 'owner', storage(info))).toBe(props)
  })
  it.each([root + 'other/project/audio/sound.wav', root + 'owner/other/audio/sound.wav',
    root + 'owner/project/audio/a%2Fb.wav', props.audio + '?token=test',
    props.audio.replace('cdn.makaron.app', 'example.org')])('leaves unrelated URLs alone', async audio => {
    const info = vi.fn()
    const original = { audio }
    expect(await resolveExportAudioProp(original, 'project', 'owner', storage(info))).toBe(original)
    expect(info).not.toHaveBeenCalled()
  })
})
