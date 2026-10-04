import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findFfmpeg, probeVideoFile, type VideoProbe } from './ffmpeg-runtime'
import type { UpscaleResolution } from './bytedance-video-upscale'

const exec = promisify(execFile)
const MAX_BYTES = 512 * 1024 * 1024
export async function downloadUpscaleMedia(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) throw new Error('Could not read the video file.')
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw new Error('Video exceeds the 512 MB processing limit.') }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Video exceeds the 512 MB processing limit.') }
    parts.push(value)
  }
  if (!size) throw new Error('Source video is empty.')
  return Buffer.concat(parts)
}
export async function inspectUpscaleMedia(bytes: Buffer): Promise<VideoProbe> {
  const dir = await mkdtemp(join(tmpdir(), 'upscale-probe-'))
  try {
    const file = join(dir, 'source.mp4'); await writeFile(file, bytes)
    const probe = await probeVideoFile(file)
    if (!probe.duration || !probe.fps || !probe.width || !probe.height) throw new Error('Cannot measure video duration, dimensions and frame rate.')
    if (probe.fps < 1 || probe.fps > 60) throw new Error('Video enhancement supports source frame rates from 1 to 60 fps.')
    if (probe.duration > 60.5) throw new Error('Video upscaling currently supports clips up to 60 seconds; split longer clips first.')
    return probe
  } finally { await rm(dir, { recursive: true, force: true }) }
}
/** Copy original audio and provider video without recompressing either track. */
export async function finishUpscaleMedia(source: Buffer, output: Buffer, target: UpscaleResolution): Promise<{ bytes: Buffer; meta: VideoProbe }> {
  const dir = await mkdtemp(join(tmpdir(), 'upscale-delivery-'))
  try {
    const base = join(dir, 'base.mp4'), enhanced = join(dir, 'enhanced.mp4'), final = join(dir, 'final.mp4')
    await Promise.all([writeFile(base, source), writeFile(enhanced, output)])
    const [before, after] = await Promise.all([probeVideoFile(base), probeVideoFile(enhanced)])
    const minimum = { '1080p': 1080, '2k': 1440, '4k': 2160 }[target]
    if (!after.width || !after.height || Math.min(after.width, after.height) < minimum) throw new Error('Upscaler output did not reach the requested resolution.')
    if (!before.duration || !after.duration || Math.abs(before.duration - after.duration) > .25) throw new Error('Upscaler changed the video duration.')
    if (!before.fps || !after.fps || Math.abs(before.fps - after.fps) > .02) throw new Error('Upscaler changed the source frame rate.')
    if (before.frameCount && after.frameCount && before.frameCount !== after.frameCount) throw new Error('Upscaler changed the source frame count.')
    if (!before.width || !before.height || Math.abs(after.width / after.height - before.width / before.height) > .02) throw new Error('Upscaler changed the source aspect ratio.')
    await exec(await findFfmpeg(), ['-v', 'error', '-y', '-i', enhanced, '-i', base, '-map', '0:v:0', '-map', '1:a:0?', '-c', 'copy', '-movflags', '+faststart', final], { timeout: 120_000, maxBuffer: 1024 * 1024 })
    return { bytes: await readFile(final), meta: await probeVideoFile(final) }
  } finally { await rm(dir, { recursive: true, force: true }) }
}
