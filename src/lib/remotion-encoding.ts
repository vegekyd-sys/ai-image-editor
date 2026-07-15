export interface RemotionLambdaEncodingSettings {
  videoBitrate: string | null
  audioBitrate: string | null
}

const DEFAULT_LAMBDA_VIDEO_BITRATE: string | null = null
const DEFAULT_LAMBDA_AUDIO_BITRATE = '128k'

function readBitrateEnv(name: string, fallback: string | null): string | null {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = raw.trim()
  if (!value || value === 'auto' || value === 'none' || value === 'null') return null
  if (!/^\d+(?:\.\d+)?[kKmMgG]?$/.test(value)) {
    throw new Error(`${name} must be an FFmpeg bitrate such as 1800k or 2M`)
  }
  return value
}

export function resolveRemotionLambdaEncodingSettings(): RemotionLambdaEncodingSettings {
  return {
    videoBitrate: readBitrateEnv('REMOTION_LAMBDA_VIDEO_BITRATE', DEFAULT_LAMBDA_VIDEO_BITRATE),
    audioBitrate: readBitrateEnv('REMOTION_LAMBDA_AUDIO_BITRATE', DEFAULT_LAMBDA_AUDIO_BITRATE),
  }
}
