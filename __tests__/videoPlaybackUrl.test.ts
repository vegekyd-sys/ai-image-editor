import { describe, expect, it } from 'vitest'
import {
  buildVideoProxyUrl,
  requiresAuthenticatedVideoProxy,
  resolveNativeVideoPlaybackUrl,
} from '@/lib/video-playback-url'

describe('native video playback URLs', () => {
  it.each([
    'https://v3b.fal.media/files/video.mp4',
    'https://cdn.klingai.com/output/video.mp4?token=signed',
    'https://example.evolink.ai/video.mp4',
    'https://cdn.makaron.app/video.mp4',
    'https://project.supabase.co/storage/v1/object/public/images/video.mp4',
  ])('plays a public provider URL directly: %s', (url) => {
    expect(requiresAuthenticatedVideoProxy(url)).toBe(false)
    expect(resolveNativeVideoPlaybackUrl(url)).toBe(url)
  })

  it('keeps the server proxy for Google downloads that require an API-key header', () => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/files/abc123:download'
    expect(requiresAuthenticatedVideoProxy(url)).toBe(true)
    expect(resolveNativeVideoPlaybackUrl(url)).toBe(buildVideoProxyUrl(url))
  })

  it('leaves local, blob, and data sources untouched', () => {
    for (const url of ['/local/video.mp4', 'blob:https://www.makaron.app/id', 'data:video/mp4;base64,AAAA']) {
      expect(resolveNativeVideoPlaybackUrl(url)).toBe(url)
    }
  })
})
