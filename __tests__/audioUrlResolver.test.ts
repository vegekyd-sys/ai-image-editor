import { describe, expect, it, vi } from 'vitest'
import { resolveAudioUrlsInCode } from '@/lib/audio-url-resolver'

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
