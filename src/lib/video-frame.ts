import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findFfmpeg } from './ffmpeg-runtime'
import { extractRetakeSourceFrames } from './video-retake-media'

export const MAX_PREVIEW_SOURCE_BYTES = 64 * 1024 * 1024
const exec = promisify(execFile)
const USER_AGENT = 'Mozilla/5.0 MakaronPreview/1.0'

export interface ExtractVideoFrameOptions {
  timestamp?: number
  quality?: number
  signal?: AbortSignal
}

/** Unknown-length bodies are bounded too; never arrayBuffer a remote source. */
async function readSmallSource(response: Response, signal: AbortSignal): Promise<Buffer | null> {
  if (!response.body) throw new Error('Video response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    if (Number(response.headers.get('content-length')) > MAX_PREVIEW_SOURCE_BYTES) return null
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_PREVIEW_SOURCE_BYTES) return null
      chunks.push(chunk.value)
    }
    if (!bytes) throw new Error('Downloaded video is empty')
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Large sources seek over HTTP Range in FFmpeg, outside the Node heap. */
async function extractRemoteFrames(url: string, times: number[], quality: number, signal: AbortSignal): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), 'makaron-preview-'))
  try {
    const ffmpeg = await findFfmpeg()
    const images: Buffer[] = []
    for (const [index,time] of times.entries()) {
      signal.throwIfAborted()
      const output = join(dir, `${index}.jpg`)
      await exec(ffmpeg, ['-v','error','-y','-protocol_whitelist','http,https,tcp,tls,crypto',
        '-rw_timeout','15000000','-user_agent',USER_AGENT,'-ss',String(time),'-i',url,
        '-map','0:v:0','-an','-frames:v','1','-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuvj420p",
        '-q:v',String(quality),'-threads','1',output],
      {timeout:45_000,maxBuffer:1024*1024,signal})
      images.push(await readFile(output))
    }
    return images
  } catch {
    // Child-process errors include the command line and signed source URL.
    throw new Error(signal.aborted ? 'Video preview cancelled or timed out' : 'Remote video frame extraction failed; check source access and seek support')
  } finally {
    await rm(dir,{recursive:true,force:true})
  }
}

export async function extractVideoFrames(videoUrl: string, timestamps: number[], options: Omit<ExtractVideoFrameOptions,'timestamp'> = {}): Promise<Buffer[]> {
  if (!timestamps.length || timestamps.length > 6 || timestamps.some(time => !Number.isFinite(time) || time < 0)) {
    throw new Error('Video preview requires 1–6 finite nonnegative timestamps')
  }
  const parsed = new URL(videoUrl)
  if (!['http:','https:'].includes(parsed.protocol)) throw new Error('Video preview requires an HTTP(S) source')
  const signal = AbortSignal.any([AbortSignal.timeout(120_000),...(options.signal ? [options.signal] : [])])
  const quality = Number.isFinite(options.quality) ? Math.max(2,Math.min(31,Number(options.quality))) : 4
  signal.throwIfAborted()
  const response = await fetch(videoUrl,{headers:{'User-Agent':USER_AGENT},signal})
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Failed to download video: HTTP ${response.status}`)
  }
  const source = await readSmallSource(response,signal)
  return source
    ? extractRetakeSourceFrames(source,timestamps,quality,signal)
    : extractRemoteFrames(videoUrl,timestamps,quality,signal)
}

/** Real videos, with exact visual-tail handling retained for small sources. */
export async function extractVideoFrame(videoUrl: string, options: ExtractVideoFrameOptions = {}): Promise<Buffer> {
  const timestamp = Number.isFinite(options.timestamp) ? Math.max(0,Number(options.timestamp)) : 0.5
  return (await extractVideoFrames(videoUrl,[timestamp],options))[0]
}
