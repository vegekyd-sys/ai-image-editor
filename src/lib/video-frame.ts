import { execFile } from 'node:child_process'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { findFfmpeg } from './ffmpeg-runtime'
import { extractRetakeSourceFileFrames } from './video-retake-media'

export const MAX_PREVIEW_SOURCE_BYTES = 64 * 1024 * 1024
const exec = promisify(execFile)
const USER_AGENT = 'Mozilla/5.0 MakaronPreview/1.0'

export interface ExtractVideoFrameOptions {
  timestamp?: number
  quality?: number
  signal?: AbortSignal
}

// Write each chunk before reading the next one so concurrent previews never
// hold complete source videos or concatenated copies in memory.
async function downloadSmallSource(response: Response, path: string, signal: AbortSignal): Promise<boolean> {
  if (!response.body) throw new Error('Video response has no body')
  const reader = response.body.getReader()
  try {
    if (Number(response.headers.get('content-length')) > MAX_PREVIEW_SOURCE_BYTES) return false
    const file = await open(path, 'wx', 0o600)
    let bytes = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const chunk = await reader.read()
        signal.throwIfAborted()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > MAX_PREVIEW_SOURCE_BYTES) return false
        await file.writeFile(chunk.value)
      }
      if (!bytes) throw new Error('Downloaded video is empty')
      return true
    } finally {
      await file.close()
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Large sources seek over HTTP Range in FFmpeg, outside the Node heap. */
async function extractRemoteFrames(dir: string, url: string, times: number[], quality: number, signal: AbortSignal): Promise<Buffer[]> {
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
  const dir = await mkdtemp(join(tmpdir(), 'makaron-preview-'))
  try {
    const response = await fetch(videoUrl,{headers:{'User-Agent':USER_AGENT},signal})
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Failed to download video: HTTP ${response.status}`)
    }
    const sourcePath = join(dir, 'source.mp4')
    if (await downloadSmallSource(response, sourcePath, signal)) {
      return await extractRetakeSourceFileFrames(sourcePath,timestamps,quality,signal)
    }
    // An unknown-length response can leave a partial copy behind.
    await rm(sourcePath, {force:true})
    return await extractRemoteFrames(dir,videoUrl,timestamps,quality,signal)
  } finally {
    await rm(dir,{recursive:true,force:true})
  }
}

/** Real videos, with exact visual-tail handling retained for small sources. */
export async function extractVideoFrame(videoUrl: string, options: ExtractVideoFrameOptions = {}): Promise<Buffer> {
  const timestamp = Number.isFinite(options.timestamp) ? Math.max(0,Number(options.timestamp)) : 0.5
  return (await extractVideoFrames(videoUrl,[timestamp],options))[0]
}
