import { execFile } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findFfmpeg } from './ffmpeg-runtime'
import { uploadAudio } from './supabase/storage'

const execFileAsync = promisify(execFile)

export const MIN_SEED_AUDIO_REFERENCE_SECONDS = 2
export const MAX_SEED_AUDIO_REFERENCE_SECONDS = 30
export const MAX_SEED_AUDIO_SOURCE_RANGES = 20

export interface SeedAudioSourceRange {
  startSec: number
  endSec: number
}

export function validateSeedAudioSourceRanges(
  ranges: SeedAudioSourceRange[],
): { durationSeconds: number } {
  if (!ranges.length) throw new Error('At least one source voice range is required.')
  if (ranges.length > MAX_SEED_AUDIO_SOURCE_RANGES) {
    throw new Error(`Source voice supports at most ${MAX_SEED_AUDIO_SOURCE_RANGES} ranges.`)
  }

  let durationSeconds = 0
  let priorStart = -1
  for (const [index, range] of ranges.entries()) {
    if (
      !Number.isFinite(range.startSec)
      || !Number.isFinite(range.endSec)
      || range.startSec < 0
      || range.endSec <= range.startSec
    ) {
      throw new Error(`Source voice range ${index + 1} must have 0 <= startSec < endSec.`)
    }
    if (range.startSec < priorStart) {
      throw new Error('Source voice ranges must be in playback order.')
    }
    priorStart = range.startSec
    durationSeconds += range.endSec - range.startSec
  }

  if (durationSeconds < MIN_SEED_AUDIO_REFERENCE_SECONDS) {
    throw new Error(`Source voice must contain at least ${MIN_SEED_AUDIO_REFERENCE_SECONDS} seconds of speech.`)
  }
  if (durationSeconds > MAX_SEED_AUDIO_REFERENCE_SECONDS) {
    throw new Error(`Source voice must be ${MAX_SEED_AUDIO_REFERENCE_SECONDS} seconds or less.`)
  }
  return { durationSeconds }
}

export async function materializeSeedAudioReference(input: {
  mediaUrl: string
  ranges: SeedAudioSourceRange[]
  supabase: SupabaseClient
  userId: string
  projectId: string
}): Promise<{ audioUrl: string; durationSeconds: number }> {
  if (!/^https:\/\//i.test(input.mediaUrl)) {
    throw new Error('Source voice media must have a public HTTPS URL.')
  }
  const { durationSeconds } = validateSeedAudioSourceRanges(input.ranges)
  const workDir = await mkdtemp(path.join(tmpdir(), 'makaron-seed-voice-'))
  try {
    const outputPath = path.join(workDir, 'reference.mp3')
    const ffmpegPath = await findFfmpeg()
    const rangeFilters = input.ranges.map((range, index) => (
      `[0:a:0]atrim=start=${range.startSec}:end=${range.endSec},asetpts=PTS-STARTPTS[a${index}]`
    ))
    const concatInputs = input.ranges.map((_, index) => `[a${index}]`).join('')
    const filter = [
      ...rangeFilters,
      `${concatInputs}concat=n=${input.ranges.length}:v=0:a=1[outa]`,
    ].join(';')

    await execFileAsync(ffmpegPath, [
      '-y',
      '-i', input.mediaUrl,
      '-filter_complex', filter,
      '-map', '[outa]',
      '-ac', '1',
      '-ar', '44100',
      '-b:a', '192k',
      '-f', 'mp3',
      outputPath,
    ], { timeout: 180_000, maxBuffer: 12 * 1024 * 1024 })

    const buffer = await readFile(outputPath)
    const taskId = `seed-voice-ref-${crypto.randomUUID()}`
    const audioUrl = await uploadAudio(
      input.supabase,
      input.userId,
      input.projectId,
      taskId,
      0,
      buffer,
      'mp3',
    )
    if (!audioUrl) throw new Error('Failed to persist the extracted Seed Audio voice reference.')
    return { audioUrl, durationSeconds }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
