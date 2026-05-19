import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoMeta } from '@/types'

interface ResolveResult {
  code: string
  changed: boolean
}

/**
 * Replace temporary provider video URLs in design code with permanent Supabase URLs.
 * Queries video snapshots to find providerUrl → videoUrl mappings.
 */
export async function resolveVideoUrlsInCode(
  code: string,
  projectId: string,
  supabase: SupabaseClient,
): Promise<ResolveResult> {
  const { data: videoSnaps } = await supabase
    .from('snapshots')
    .select('video_meta')
    .eq('project_id', projectId)
    .eq('type', 'video')

  if (!videoSnaps?.length) return { code, changed: false }

  let resolved = code
  let changed = false

  for (const snap of videoSnaps) {
    const meta = snap.video_meta as VideoMeta | null
    if (!meta?.providerUrl || !meta.videoUrl) continue
    if (meta.providerUrl === meta.videoUrl) continue
    if (!resolved.includes(meta.providerUrl)) continue

    resolved = resolved.split(meta.providerUrl).join(meta.videoUrl)
    changed = true
  }

  return { code: resolved, changed }
}
