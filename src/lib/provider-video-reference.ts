import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublicUrl } from '@/lib/supabase/storage'

const BUCKET = 'images'
const MAX_REFERENCE_BYTES = 55 * 1024 * 1024
const TRANSCODE_TIMEOUT_MS = 60_000

export interface ProviderVideoReferenceOptions {
  supabase: SupabaseClient
  userId: string
  projectId: string
  urls: string[]
  reason?: string
}

export interface PreparedProviderVideoReferences {
  urls: string[]
  normalized: Array<{ originalUrl: string; providerUrl: string }>
}

export function shouldNormalizeProviderVideoReference(url: string, contentType?: string | null): boolean {
  const cleanUrl = url.split('?')[0]?.toLowerCase() || ''
  const cleanType = contentType?.split(';')[0]?.trim().toLowerCase() || ''
  return cleanUrl.endsWith('.mov') || cleanType === 'video/quicktime' || cleanType === 'video/mov'
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export async function transcodeVideoBufferToSdrMp4(buffer: Buffer<ArrayBufferLike>): Promise<Buffer<ArrayBufferLike>> {
  const [{ execFile }, { promises: fs }, { tmpdir }, path, { promisify }, { findFfmpeg }] = await Promise.all([
    import('child_process'),
    import('fs'),
    import('os'),
    import('path'),
    import('util'),
    import('./ffmpeg-runtime'),
  ])
  const execFileAsync = promisify(execFile)
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'makaron-provider-video-'))
  const inputPath = path.join(dir, 'input.mov')
  const outputPath = path.join(dir, 'output.mp4')

  try {
    await fs.writeFile(inputPath, buffer)
    const ffmpeg = await findFfmpeg()
    await execFileAsync(ffmpeg, [
      '-hide_banner',
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', 'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ], { timeout: TRANSCODE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
    return Buffer.from(await fs.readFile(outputPath))
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function inspectVideoReference(url: string): Promise<{ contentType: string | null; shouldNormalize: boolean }> {
  if (shouldNormalizeProviderVideoReference(url)) {
    return { contentType: null, shouldNormalize: true }
  }

  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return { contentType: null, shouldNormalize: false }
    const contentType = res.headers.get('content-type')
    return { contentType, shouldNormalize: shouldNormalizeProviderVideoReference(url, contentType) }
  } catch {
    return { contentType: null, shouldNormalize: false }
  }
}

async function fetchVideoReference(url: string): Promise<Buffer<ArrayBufferLike>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch provider reference video ${res.status}: ${url}`)
  const contentLength = Number(res.headers.get('content-length') || 0)
  if (contentLength > MAX_REFERENCE_BYTES) {
    throw new Error(`Provider reference video is too large (${(contentLength / 1024 / 1024).toFixed(1)}MB).`)
  }
  const buffer: Buffer<ArrayBufferLike> = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_REFERENCE_BYTES) {
    throw new Error(`Provider reference video is too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB).`)
  }
  return buffer
}

async function uploadProviderReference(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  buffer: Buffer<ArrayBufferLike>,
): Promise<string> {
  const path = `${userId}/${projectId}/provider-inputs/${crypto.randomUUID()}.mp4`
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'video/mp4',
    upsert: true,
  })
  if (error) throw new Error(`Provider reference upload failed: ${error.message}`)
  return getPublicUrl(supabase, path)
}

export async function prepareProviderVideoReferences(options: ProviderVideoReferenceOptions): Promise<PreparedProviderVideoReferences> {
  const urls: string[] = []
  const normalized: PreparedProviderVideoReferences['normalized'] = []

  for (const url of options.urls) {
    if (!url) continue
    const inspected = await inspectVideoReference(url)
    if (!inspected.shouldNormalize) {
      urls.push(url)
      continue
    }

    const startedAt = Date.now()
    const buffer = await fetchVideoReference(url)
    const mp4 = await transcodeVideoBufferToSdrMp4(buffer)
    if (mp4.length > MAX_REFERENCE_BYTES) {
      throw new Error(`Normalized provider reference video is too large (${(mp4.length / 1024 / 1024).toFixed(1)}MB).`)
    }
    const providerUrl = await uploadProviderReference(options.supabase, options.userId, options.projectId, mp4)
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`[provider-video] normalized MOV reference for provider${options.reason ? ` (${options.reason})` : ''} in ${seconds}s (${formatMegabytes(buffer.length)} -> ${formatMegabytes(mp4.length)})`)
    urls.push(providerUrl)
    normalized.push({ originalUrl: url, providerUrl })
  }

  return { urls, normalized }
}
