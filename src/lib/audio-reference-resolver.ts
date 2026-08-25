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
