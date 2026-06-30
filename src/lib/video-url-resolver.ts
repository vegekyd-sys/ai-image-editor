import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoMeta } from '@/types'

interface ResolveResult {
  code: string
  changed: boolean
}

const PERMANENT_HOSTS = ['supabase.co', 'cdn.makaron.app']

function isPermanentUrl(url: string): boolean {
  return PERMANENT_HOSTS.some(h => url.includes(h))
}

function hasResolvableVideoUrl(code: string): boolean {
  const videoUrlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(mp4|webm|mov)([^\s"'`<>)}\]]*)/gi
  for (const match of code.matchAll(videoUrlPattern)) {
    if (!isPermanentUrl(match[0])) return true
  }
  return false
}

/**
 * Replace temporary provider video URLs in design code with permanent Supabase URLs.
 * Two strategies:
 * 1. Exact match via providerUrl field (new videos)
 * 2. Fallback: match non-permanent .mp4 URLs in code order to video snapshots in timeline order (legacy)
 */
export async function resolveVideoUrlsInCode(
  code: string,
  projectId: string,
  supabase: SupabaseClient,
): Promise<ResolveResult> {
  if (!hasResolvableVideoUrl(code)) return { code, changed: false }

  const { data: videoSnaps } = await supabase
    .from('snapshots')
    .select('video_meta')
    .eq('project_id', projectId)
    .eq('type', 'video')
    .order('sort_order', { ascending: true })

  if (!videoSnaps?.length) return { code, changed: false }

  let resolved = code
  let changed = false

  // Strategy 1: exact providerUrl → videoUrl mapping
  for (const snap of videoSnaps) {
    const meta = snap.video_meta as VideoMeta | null
    if (!meta?.providerUrl || !meta.videoUrl) continue
    if (meta.providerUrl === meta.videoUrl) continue
    if (!resolved.includes(meta.providerUrl)) continue

    resolved = resolved.split(meta.providerUrl).join(meta.videoUrl)
    changed = true
  }

  // Strategy 2: fallback for legacy data without providerUrl
  // Find non-permanent video URLs in code, match to video snapshots by occurrence order
  if (!changed) {
    const videoUrlPattern = /https?:\/\/[^\s"'`<>)}\]]+\.(mp4|webm|mov)([^\s"'`<>)}\]]*)/gi
    const codeUrls: string[] = []
    for (const m of code.matchAll(videoUrlPattern)) {
      if (!isPermanentUrl(m[0]) && !codeUrls.includes(m[0])) codeUrls.push(m[0])
    }

    if (codeUrls.length > 0) {
      const permanentUrls = videoSnaps
        .map(s => (s.video_meta as VideoMeta | null)?.videoUrl)
        .filter((u): u is string => !!u && isPermanentUrl(u))

      for (let i = 0; i < codeUrls.length && i < permanentUrls.length; i++) {
        resolved = resolved.split(codeUrls[i]).join(permanentUrls[i])
        changed = true
      }
    }
  }

  return { code: resolved, changed }
}
