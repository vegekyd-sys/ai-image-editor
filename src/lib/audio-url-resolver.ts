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
    if (!permanent?.includes('.supabase.co/')) continue

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
