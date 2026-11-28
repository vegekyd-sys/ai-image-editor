import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findFfmpeg } from './ffmpeg-runtime'
import { readProviderImage } from './provider-image-preflight'

/** Inspect downloaded bytes; FFmpeg never opens caller-controlled remote URLs. */
export async function validateVideoAudioReferences(
  urls: string[],
  limits: { model: string; maxBytes: number; minSeconds?: number; formats?: string[]; evolinkAsset?: boolean },
): Promise<void> {
  let total = 0
  for (const url of urls) {
    const bytes = await readProviderImage(url, limits.maxBytes, { evolinkAsset: limits.evolinkAsset })
    const dir = await mkdtemp(join(tmpdir(), 'video-reference-audio-'))
    try {
      const file = join(dir, 'source')
      await writeFile(file, bytes)
      let log = ''
      try { await promisify(execFile)(await findFfmpeg(), ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file], { timeout: 15000, maxBuffer: 512 * 1024 }) }
      catch (e) { log = (e as {stderr?: string}).stderr ?? '' }
      const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN
      if (!Number.isFinite(seconds) || seconds <= 0 || !/Audio:/.test(log)) throw new Error(`${limits.model} audio references must contain a measurable audio track.`)
      const format = log.match(/Input #0, ([^,]+), from /)?.[1] || ''
      if (limits.formats && !limits.formats.includes(format)) throw new Error(`${limits.model} reference audio must be WAV or MP3.`)
      if (limits.minSeconds != null && (seconds < limits.minSeconds || seconds > 30)) throw new Error(`${limits.model} audio references must each be ${limits.minSeconds}–30 seconds.`)
      total += seconds
      if (total > 30) throw new Error(`${limits.model} audio references must total 30 seconds or less.`)
    } finally { await rm(dir, {recursive: true, force: true}) }
  }
}
