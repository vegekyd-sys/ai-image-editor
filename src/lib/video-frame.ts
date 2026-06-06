import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { findFfmpeg } from './ffmpeg-runtime'

const execFileAsync = promisify(execFile)

export interface ExtractVideoFrameOptions {
  timestamp?: number
  quality?: number
}

/**
 * Extract one visual frame from a real video file URL.
 * This is for uploaded/generated MP4/MOV/WebM media, not Remotion compositions.
 */
export async function extractVideoFrame(videoUrl: string, options: ExtractVideoFrameOptions = {}): Promise<Buffer> {
  const ffmpegPath = await findFfmpeg()
  const timestamp = Number.isFinite(options.timestamp) ? Math.max(0, Number(options.timestamp)) : 0.5
  const quality = Number.isFinite(options.quality) ? Math.max(2, Math.min(31, Number(options.quality))) : 4

  const dir = await mkdtemp(path.join(tmpdir(), 'video-frame-'))
  const inputPath = path.join(dir, 'input-video')
  const outputPath = path.join(dir, 'frame.jpg')

  try {
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length) throw new Error('Downloaded video is empty')
    await writeFile(inputPath, buffer)

    await execFileAsync(ffmpegPath, [
      '-ss', String(timestamp),
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', String(quality),
      '-f', 'image2',
      outputPath,
      '-y',
    ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })

    const frame = await readFile(outputPath)
    if (!frame.length) throw new Error('ffmpeg produced an empty frame')
    return frame
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
