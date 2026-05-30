import { execFile } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['-version'], { timeout: 2000 })
    return true
  } catch {
    return false
  }
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p
  }
  return null
}

export async function findFfmpeg(): Promise<string> {
  if (await commandExists('ffmpeg')) return 'ffmpeg'

  let packagePath = ''
  try {
    packagePath = require('ffmpeg-static') || ''
  } catch {
    packagePath = ''
  }

  const found = firstExisting([
    packagePath,
    path.resolve(process.cwd(), 'node_modules/ffmpeg-static/ffmpeg'),
    path.resolve(process.cwd(), 'node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg'),
    path.resolve(process.cwd(), 'node_modules/.pnpm/ffmpeg-static@5.2.0/node_modules/ffmpeg-static/ffmpeg'),
  ])
  if (found) return found

  throw new Error('ffmpeg not found - install ffmpeg-static or add ffmpeg to PATH')
}

export async function findFfprobe(): Promise<string> {
  if (await commandExists('ffprobe')) return 'ffprobe'

  let packagePath = ''
  try {
    packagePath = require('ffprobe-static')?.path || ''
  } catch {
    packagePath = ''
  }

  const found = firstExisting([
    packagePath,
    path.resolve(process.cwd(), 'node_modules/ffprobe-static/bin/darwin/arm64/ffprobe'),
    path.resolve(process.cwd(), 'node_modules/ffprobe-static/bin/darwin/x64/ffprobe'),
    path.resolve(process.cwd(), 'node_modules/ffprobe-static/bin/linux/x64/ffprobe'),
    path.resolve(process.cwd(), 'node_modules/ffprobe-static/bin/linux/arm64/ffprobe'),
  ])
  if (found) return found

  throw new Error('ffprobe not found - install ffprobe-static or add ffprobe to PATH')
}

export interface VideoProbe {
  duration: number | null
  width?: number
  height?: number
  fps?: number
  codec?: string
  audioCodec?: string
  format?: unknown
  streams?: unknown[]
}

function parseFps(value?: string): number | undefined {
  if (!value || value === '0/0') return undefined
  const [num, den] = value.split('/').map(Number)
  if (!num || !den) return undefined
  return num / den
}

export async function probeVideoFile(filePath: string): Promise<VideoProbe> {
  const ffprobePath = await findFfprobe()
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })

  const parsed = JSON.parse(stdout)
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find((s: Record<string, unknown>) => s.codec_type === 'video') as Record<string, unknown> | undefined
  const audio = streams.find((s: Record<string, unknown>) => s.codec_type === 'audio') as Record<string, unknown> | undefined
  const duration = Number(parsed.format?.duration ?? video?.duration)

  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: typeof video?.width === 'number' ? video.width : undefined,
    height: typeof video?.height === 'number' ? video.height : undefined,
    fps: parseFps(String(video?.avg_frame_rate || video?.r_frame_rate || '')),
    codec: typeof video?.codec_name === 'string' ? video.codec_name : undefined,
    audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : undefined,
    format: parsed.format,
    streams,
  }
}
