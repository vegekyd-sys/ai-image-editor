const GOOGLE_GENERATIVE_VIDEO_HOST = 'generativelanguage.googleapis.com'

export function requiresAuthenticatedVideoProxy(videoUrl: string): boolean {
  try {
    const parsed = new URL(videoUrl)
    return parsed.hostname === GOOGLE_GENERATIVE_VIDEO_HOST
      && parsed.pathname.startsWith('/v1beta/files/')
      && parsed.pathname.endsWith(':download')
  } catch {
    return false
  }
}

export function buildVideoProxyUrl(videoUrl: string): string {
  return `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`
}

/**
 * Native App playback should use public provider CDNs directly. The proxy is
 * reserved for private downloads that require a server-only authorization
 * header, and as a runtime fallback when a provider CDN rejects direct media.
 */
export function resolveNativeVideoPlaybackUrl(videoUrl: string): string {
  return requiresAuthenticatedVideoProxy(videoUrl)
    ? buildVideoProxyUrl(videoUrl)
    : videoUrl
}
