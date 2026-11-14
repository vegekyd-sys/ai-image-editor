import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findFfmpeg } from './ffmpeg-runtime'
import { readProviderImage } from './provider-image-preflight'

/** Inspect downloaded bytes; FFmpeg never opens caller-controlled remote URLs. */
export async function validateFlashAudioReferences(urls: string[]): Promise<void> {
  let total = 0
  for (const url of urls) {
    const bytes = await readProviderImage(url, 55 * 1024 * 1024)
    const dir = await mkdtemp(join(tmpdir(), 'seedance-flash-audio-'))
    try {
      const file = join(dir, 'source')
      await writeFile(file, bytes)
      let log = ''
      try { await promisify(execFile)(await findFfmpeg(), ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file], { timeout: 15000, maxBuffer: 512 * 1024 }) }
      catch (e) { log = (e as {stderr?: string}).stderr ?? '' }
      const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN
      if (!Number.isFinite(seconds) || seconds <= 0 || !/Audio:/.test(log)) throw new Error('Flash audio references must contain a measurable audio track.')
      total += seconds
      if (total > 30) throw new Error('Seedance 2.5 Flash audio references must total 30 seconds or less.')
    } finally { await rm(dir, {recursive: true, force: true}) }
  }
}
