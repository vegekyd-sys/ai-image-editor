/**
 * One deliverable that contains voice and music must be ONE Seed Audio
 * `kind: "mixed"` generation. Generating speech with Seed Audio and a separate
 * music bed (Suno or Seed) for the same piece doubles the cost and loses the
 * mix, so a single Agent run may not combine them.
 */

export interface GeneratedAudioRecord {
  /** Audio intent recorded at generation time (`kind:` tag). */
  kind?: string
  /** Agent run that generated the asset (`run:` tag). */
  runId?: string
}

/** Assets that already carry speech. */
const VOICE_KINDS = new Set(['voiceover', 'dialogue', 'mixed'])
/** Assets that already carry a music bed. */
const MUSIC_KINDS = new Set(['music', 'mixed'])

/** Read `kind:` and `run:` from project_music tags. */
export function parseGeneratedAudioTags(tags: string | null | undefined): GeneratedAudioRecord {
  const record: GeneratedAudioRecord = {}
  for (const raw of String(tags || '').split(',')) {
    const tag = raw.trim()
    if (tag.startsWith('kind:')) record.kind = tag.slice(5)
    else if (tag.startsWith('run:')) record.runId = tag.slice(4)
  }
  return record
}

/**
 * Returns an error message when `kind` would split one soundtrack across
 * generations in the same run, otherwise null.
 */
export function findSplitSoundtrackConflict(input: {
  kind: string
  runId?: string | null
  existing: Array<GeneratedAudioRecord & { label?: string }>
}): string | null {
  const { kind, runId } = input
  if (!runId) return null
  const sameRun = input.existing.filter(item => item.runId === runId && item.kind)
  const describe = (items: Array<GeneratedAudioRecord & { label?: string }>) =>
    items.map(item => item.label ? `${item.label} (${item.kind})` : item.kind).join(', ')

  if (kind === 'music') {
    const voiced = sameRun.filter(item => VOICE_KINDS.has(item.kind!))
    if (voiced.length) {
      return [
        `Blocked: this run already generated speech audio (${describe(voiced)}).`,
        'Voice and music for the same deliverable must be ONE generate_audio call with kind="mixed" on Seed Audio; do not add a separate music bed (that pays twice and loses the mix).',
        'If the existing asset is already kind="mixed", use it as is. If it is voice-only, regenerate the complete soundtrack once with kind="mixed", directing voice, music, and SFX together; to keep the same voice, pass the voice asset as reference_voices and bind it as @audio1.',
      ].join(' ')
    }
  }
  if (kind === 'voiceover' || kind === 'dialogue') {
    const scored = sameRun.filter(item => MUSIC_KINDS.has(item.kind!))
    if (scored.length) {
      return [
        `Blocked: this run already generated music (${describe(scored)}).`,
        'Voice and music for the same deliverable must be ONE generate_audio call with kind="mixed" on Seed Audio; do not generate speech separately on top of a music bed.',
        'Regenerate the complete soundtrack once with kind="mixed" and use that single asset.',
      ].join(' ')
    }
  }
  return null
}
