import type { SupabaseClient } from '@supabase/supabase-js'
import { getPublicUrl } from '@/lib/supabase/storage'

const BUCKET = 'images'
const MAX_REFERENCE_BYTES = 55 * 1024 * 1024
const TRANSCODE_TIMEOUT_MS = 60_000

interface ProviderVideoColorMetadata {
  colorTransfer?: string
  colorPrimaries?: string
  colorSpace?: string
  pixelFormat?: string
  hasDolbyVision?: boolean
}

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

export function shouldInspectProviderVideoColor(url: string, contentType?: string | null): boolean {
  const cleanUrl = url.split('?')[0]?.toLowerCase() || ''
  const cleanType = contentType?.split(';')[0]?.trim().toLowerCase() || ''
  if (cleanUrl.includes('/provider-inputs/')) return false
  return shouldNormalizeProviderVideoReference(url, contentType)
    || cleanType.startsWith('video/')
    || cleanUrl.endsWith('.mp4')
    || cleanUrl.endsWith('.m4v')
}

export function providerVideoNeedsSdrToneMap(metadata: ProviderVideoColorMetadata): boolean {
  const transfer = metadata.colorTransfer?.toLowerCase() || ''
  const primaries = metadata.colorPrimaries?.toLowerCase() || ''
  const colorSpace = metadata.colorSpace?.toLowerCase() || ''
  const pixelFormat = metadata.pixelFormat?.toLowerCase() || ''
  const isWideGamutHighBitDepth = (primaries === 'bt2020' || colorSpace === 'bt2020nc' || colorSpace === 'bt2020c')
    && /(?:10|12|16)(?:le|be)?/.test(pixelFormat)
  return metadata.hasDolbyVision === true
    || transfer === 'arib-std-b67'
    || transfer === 'smpte2084'
    || transfer === 'smpte428'
    || isWideGamutHighBitDepth
}

function extractProviderVideoColorMetadata(streams: unknown[] | undefined): ProviderVideoColorMetadata {
  const stream = (streams || []).find((candidate) => {
    return typeof candidate === 'object'
      && candidate !== null
      && (candidate as { codec_type?: unknown }).codec_type === 'video'
  }) as {
    color_transfer?: unknown
    color_primaries?: unknown
    color_space?: unknown
    pix_fmt?: unknown
    side_data_list?: unknown
  } | undefined
  const sideData = Array.isArray(stream?.side_data_list) ? stream.side_data_list : []
  return {
    colorTransfer: typeof stream?.color_transfer === 'string' ? stream.color_transfer : undefined,
    colorPrimaries: typeof stream?.color_primaries === 'string' ? stream.color_primaries : undefined,
    colorSpace: typeof stream?.color_space === 'string' ? stream.color_space : undefined,
    pixelFormat: typeof stream?.pix_fmt === 'string' ? stream.pix_fmt : undefined,
    hasDolbyVision: sideData.some((item) => {
      if (typeof item !== 'object' || item === null) return false
      const type = (item as { side_data_type?: unknown }).side_data_type
      return typeof type === 'string' && type.toLowerCase().includes('dovi')
    }),
  }
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

async function transcodeVideoBufferToProviderMp4(
  buffer: Buffer<ArrayBufferLike>,
  options: { toneMapHdr: boolean },
): Promise<Buffer<ArrayBufferLike>> {
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
    const videoFilter = options.toneMapHdr
      ? 'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p'
      : 'format=yuv420p'
    await execFileAsync(ffmpeg, [
      '-hide_banner',
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-color_range', 'tv',
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

export async function transcodeVideoBufferToSdrMp4(buffer: Buffer<ArrayBufferLike>): Promise<Buffer<ArrayBufferLike>> {
  return transcodeVideoBufferToProviderMp4(buffer, { toneMapHdr: true })
}

async function inspectVideoBuffer(buffer: Buffer<ArrayBufferLike>): Promise<ProviderVideoColorMetadata> {
  const [{ promises: fs }, { tmpdir }, path, { probeVideoFile }] = await Promise.all([
    import('fs'),
    import('os'),
    import('path'),
    import('./ffmpeg-runtime'),
  ])
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'makaron-provider-probe-'))
  const inputPath = path.join(dir, 'input.mp4')
  try {
    await fs.writeFile(inputPath, buffer)
    const probe = await probeVideoFile(inputPath)
    return extractProviderVideoColorMetadata(probe.streams)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function providerVideoBufferNeedsSdrToneMap(buffer: Buffer<ArrayBufferLike>): Promise<boolean> {
  return providerVideoNeedsSdrToneMap(await inspectVideoBuffer(buffer))
}

async function inspectVideoReference(url: string): Promise<{
  contentType: string | null
  shouldNormalize: boolean
  shouldInspectColor: boolean
}> {
  const cleanUrl = url.split('?')[0]?.toLowerCase() || ''
  if (shouldNormalizeProviderVideoReference(url)) {
    return { contentType: null, shouldNormalize: true, shouldInspectColor: true }
  }

  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) {
      return {
        contentType: null,
        shouldNormalize: false,
        shouldInspectColor: shouldInspectProviderVideoColor(cleanUrl),
      }
    }
    const contentType = res.headers.get('content-type')
    const cleanType = contentType?.split(';')[0]?.trim().toLowerCase() || ''
    return {
      contentType,
      shouldNormalize: shouldNormalizeProviderVideoReference(url, contentType),
      shouldInspectColor: shouldInspectProviderVideoColor(cleanUrl, cleanType),
    }
  } catch {
    return {
      contentType: null,
      shouldNormalize: false,
      shouldInspectColor: shouldInspectProviderVideoColor(cleanUrl),
    }
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
    if (!inspected.shouldNormalize && !inspected.shouldInspectColor) {
      urls.push(url)
      continue
    }

    const startedAt = Date.now()
    const buffer = await fetchVideoReference(url)
    const toneMapHdr = await providerVideoBufferNeedsSdrToneMap(buffer).catch(() => false)
    if (!inspected.shouldNormalize && !toneMapHdr) {
      urls.push(url)
      continue
    }
    const mp4 = await transcodeVideoBufferToProviderMp4(buffer, { toneMapHdr })
    if (mp4.length > MAX_REFERENCE_BYTES) {
      throw new Error(`Normalized provider reference video is too large (${(mp4.length / 1024 / 1024).toFixed(1)}MB).`)
    }
    const providerUrl = await uploadProviderReference(options.supabase, options.userId, options.projectId, mp4)
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    const normalization = toneMapHdr ? 'HDR reference to SDR BT.709' : 'video container'
    console.log(`[provider-video] normalized ${normalization} for provider${options.reason ? ` (${options.reason})` : ''} in ${seconds}s (${formatMegabytes(buffer.length)} -> ${formatMegabytes(mp4.length)})`)
    urls.push(providerUrl)
    normalized.push({ originalUrl: url, providerUrl })
  }

  return { urls, normalized }
}
