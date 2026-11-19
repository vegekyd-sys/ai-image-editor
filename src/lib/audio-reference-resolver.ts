export interface ResolvableAudioReference {
  audioUrl: string
  title?: string
}

export function resolveAudioRefs(
  audioAttachments: ResolvableAudioReference[] | undefined,
  refs: string[] | undefined,
): { audioUrls: string[]; error?: string } {
  if (!refs?.length) return { audioUrls: [] }
  const attachments = audioAttachments || []
  const audioUrls: string[] = []
  const invalid: string[] = []
  for (const ref of refs) {
    const cleanRef = String(ref).trim()
    if (/^https:\/\//i.test(cleanRef)) {
      audioUrls.push(cleanRef)
      continue
    }
    const match = cleanRef.match(/^audio_(\d+)$/i)
    const idx = match ? Number(match[1]) - 1 : -1
    const audio = idx >= 0 ? attachments[idx] : undefined
    if (!audio?.audioUrl) {
      invalid.push(ref)
      continue
    }
    audioUrls.push(audio.audioUrl)
  }
  if (invalid.length) {
    const available = attachments.map((audio, i) => `audio_${i + 1}${audio.title ? ` (${audio.title})` : ''}`).join(', ') || 'none'
    return { audioUrls, error: `Invalid audio_refs: ${invalid.join(', ')}. Available audio refs: ${available}. Audio refs are separate from <<<media_N>>>.` }
  }
  return { audioUrls }
}

/** Bind exact composition prop markers while their turn's Audio Index is available. */
export function resolveCompositionAudioProps(
  props: unknown,
  attachments: ResolvableAudioReference[] | undefined,
): unknown {
  if (!attachments?.length) return props
  if (typeof props === 'string') {
    const label = /^<<<(audio_\d+)>>>$/i.exec(props)?.[1]
    if (!label) return props
    const { audioUrls: [url] } = resolveAudioRefs(attachments, [label])
    return url && /^https?:\/\//i.test(url) ? url : props
  }
  if (Array.isArray(props)) return props.map(value => resolveCompositionAudioProps(value, attachments))
  if (props && typeof props === 'object') {
    return Object.fromEntries(
      Object.entries(props).map(([key, value]) => [key, resolveCompositionAudioProps(value, attachments)]),
    )
  }
  return props
}
