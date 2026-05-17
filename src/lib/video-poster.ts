import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)

/**
 * Extract a poster frame from a video URL using ffmpeg-static.
 * Fetches the video, extracts frame at 0.5s, returns JPEG buffer.
 * ~1-2s total (fetch + decode + encode).
 */
async function findFfmpeg(): Promise<string> {
  // Try system ffmpeg first (available on macOS dev, some Linux deployments)
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 2000 })
    return 'ffmpeg'
  } catch { /* not in PATH */ }

  // Fallback: ffmpeg-static package binary
  const possiblePaths = [
    path.resolve(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg'),
    path.resolve(process.cwd(), 'node_modules/.pnpm/ffmpeg-static@5.2.0/node_modules/ffmpeg-static/ffmpeg'),
  ]
  const { existsSync } = await import('fs')
  for (const p of possiblePaths) {
    if (existsSync(p)) return p
  }

  throw new Error('ffmpeg not found — install ffmpeg-static or add ffmpeg to PATH')
}

export async function extractVideoPoster(videoUrl: string): Promise<Buffer> {
  const ffmpegPath = await findFfmpeg()

  const dir = await mkdtemp(path.join(tmpdir(), 'poster-'))
  const inputPath = path.join(dir, 'input.mp4')
  const outputPath = path.join(dir, 'poster.jpg')

  try {
    // Fetch video (only first 5MB for speed)
    const res = await fetch(videoUrl, {
      headers: { 'Range': 'bytes=0-5242879' },
    })
    const buffer = Buffer.from(await res.arrayBuffer())
    await writeFile(inputPath, buffer)

    // Extract frame at 0.5s
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-ss', '0.5',
      '-vframes', '1',
      '-q:v', '4',
      '-f', 'image2',
      '-update', '1',
      outputPath,
      '-y',
    ], { timeout: 10000 })

    const posterBuffer = await readFile(outputPath)
    if (posterBuffer.length === 0) {
      throw new Error('ffmpeg produced empty poster')
    }
    return posterBuffer
  } finally {
    await unlink(inputPath).catch(() => {})
    await unlink(outputPath).catch(() => {})
    await unlink(dir).catch(() => {}) // rmdir
  }
}
