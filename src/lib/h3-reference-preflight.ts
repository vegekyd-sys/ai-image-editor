import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findFfmpeg } from './ffmpeg-runtime'
import { readProviderImage, measureProviderImages } from './provider-image-preflight'

export class H3ReferenceInputError extends Error { readonly code = 'INVALID_REFERENCE_MEDIA' }

/** Inspect locally downloaded bytes, never allow FFmpeg to fetch caller-controlled URLs. */
async function inspectClip(url: string, kind: 'video' | 'audio') {
  const bytes = await readProviderImage(url, 55 * 1024 * 1024)
  const dir = await mkdtemp(join(tmpdir(), 'h3-reference-'))
  try {
    const file = join(dir, 'source')
    await writeFile(file, bytes)
    let log = ''
    try {
      await promisify(execFile)(await findFfmpeg(), ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', file], { timeout: 15_000, maxBuffer: 512 * 1024 })
    } catch (error) { log = (error as { stderr?: string }).stderr ?? '' }
    const match = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    const durationSec = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN
    if (!Number.isFinite(durationSec) || durationSec < 2 || durationSec > 15) throw new H3ReferenceInputError(`FAL H3 Max reference ${kind} must be measurable and 2–15 seconds long.`)
    if (kind === 'video') {
      const fps = Number(log.match(/Video:.*?\b(\d+(?:\.\d+)?) fps/)?.[1])
      if (!Number.isFinite(fps) || fps < 23.899) throw new H3ReferenceInputError('FAL H3 Max reference video must have a verified frame rate of at least 23.899fps. Normalize its frame rate before submitting.')
    } else if (!/Audio:/.test(log)) throw new H3ReferenceInputError('FAL H3 Max reference audio has no readable audio track.')
    return { url, durationSec }
  } finally { await rm(dir, { recursive: true, force: true }) }
}

export async function prepareH3ReferenceMedia(images: string[], videoUrls: string[], audioUrls: string[]) {
  const dimensions = await measureProviderImages(images, 'fal-h3-max')
  const videos = []
  const audios = []
  for (const url of videoUrls) videos.push(await inspectClip(url, 'video'))
  for (const url of audioUrls) audios.push(await inspectClip(url, 'audio'))
  return {
    videos, audios,
    referenceImagePixels: dimensions.reduce((sum, image) => sum + image.width * image.height, 0),
    referenceVideoDurationSec: videos.reduce((sum, clip) => sum + clip.durationSec, 0),
    referenceAudioDurationSec: audios.reduce((sum, clip) => sum + clip.durationSec, 0),
  }
}
