import type { SupabaseClient } from '@supabase/supabase-js'

interface ResolveResult {
  code: string
  changed: boolean
}

/**
 * Replace temporary audio URLs in design code with permanent Supabase URLs.
 * Queries project_music table to find matching tracks, then does string.replace.
 * Non-destructive: returns original code if no matches or no permanent URLs available.
 */
export async function resolveAudioUrlsInCode(
  code: string,
  projectId: string,
  supabase: SupabaseClient,
): Promise<ResolveResult> {
  if (!/https?:\/\//i.test(code)) {
    return { code, changed: false }
  }

  const { data: tracks } = await supabase
    .from('project_music')
    .select('audio_url, suno_audio_url, stream_audio_url')
    .eq('project_id', projectId)
    .eq('status', 'completed')

  if (!tracks?.length) return { code, changed: false }

  let resolved = code
  let changed = false

  for (const track of tracks) {
    const permanent = track.audio_url
    if (!permanent || !/(\.supabase\.co\/|cdn\.makaron\.app\/)/i.test(permanent)) continue

    // Replace stream URL → permanent
    if (track.stream_audio_url && track.stream_audio_url !== permanent && resolved.includes(track.stream_audio_url)) {
      resolved = resolved.split(track.stream_audio_url).join(permanent)
      changed = true
    }
    // Replace Suno temp URL → permanent
    if (track.suno_audio_url && track.suno_audio_url !== permanent && resolved.includes(track.suno_audio_url)) {
      resolved = resolved.split(track.suno_audio_url).join(permanent)
      changed = true
    }
  }

  return { code: resolved, changed }
}

/** Repair a project-local audio prop only when the original is missing and its
 * exact workspace media object exists. Existing drafts are resolved at export. */
export async function resolveExportAudioProp(
  props: Record<string, unknown> | undefined,
  projectId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<Record<string, unknown> | undefined> {
  if (typeof props?.audio !== 'string' || !URL.canParse(props.audio)) return props
  const source = new URL(props.audio)
  const bucket = supabase.storage.from('images')
  const root = new URL(bucket.getPublicUrl('').data.publicUrl)
  if (source.origin !== root.origin && source.origin !== 'https://cdn.makaron.app') return props
  const prefix = `/storage/v1/object/public/images/${userId}/${projectId}/audio/`
  if (!source.pathname.startsWith(prefix) || source.search || source.hash || source.username || source.password) return props
  const filename = source.pathname.slice(prefix.length)
  // Generated workspace media uses plain filenames. Never interpret a nested or encoded path.
  if (!/^[\w.-]+\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(filename)) return props

  const original = await bucket.info(`${userId}/${projectId}/audio/${filename}`)
  if (original.error?.statusCode !== '404' && original.error?.statusCode !== 'NoSuchKey') return props

  const workspaceKey = `${userId}/workspace/${projectId}/media/${filename}`
  const { data } = await bucket.info(workspaceKey)
  if (!data?.contentType?.startsWith('audio/')) return props
  source.pathname = `/storage/v1/object/public/images/${workspaceKey}`
  return { ...props, audio: source.href }
}
