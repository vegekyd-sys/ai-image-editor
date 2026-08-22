import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import type { DesignPayload } from '@/types'
import { hasRemotionAudioSources } from '@/lib/remotion-audio'
import { normalizeRemotionTextValue } from '@/lib/remotion-text-normalization'
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest'

let bundlePromise: Promise<string> | null = null
let mediaServer: http.Server | null = null
let mediaServerRoot: string | null = null
let mediaServerPort: number | null = null

function normalizeRemotionServerCode(code: string): string {
  return code
    .trim()
    .replace(/^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Remotion\s*;?\s*$/gm, '')
    .replace(/^\s*(?:const|let|var)\s+Remotion\s*=\s*window\.Remotion\s*;?\s*$/gm, '')
    .replace(/\bwindow\.Remotion\./g, '')
    .replace(/\bRemotion\./g, '')
    .trim()
}

function pickRemotionServerComponentName(code: string): string {
  const names = [
    ...Array.from(code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g), m => m[1]),
    ...Array.from(code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g), m => m[1]),
  ]

  const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene']
  for (const name of preferred) {
    if (names.includes(name)) return name
  }

  const descriptive = [...names].reverse().find(name =>
    /(?:Composition|Design)$/i.test(name) &&
    !/(?:Caption|Badge|Label|Title|Subtitle|Overlay)$/i.test(name),
  )
  if (descriptive) return descriptive

  return names[names.length - 1] || 'Design'
}

function prepareRemotionCodeForLocalRenderer(code: string): string {
  const normalized = normalizeRemotionServerCode(code)
  const componentName = pickRemotionServerComponentName(normalized)
  if (componentName === 'Design') return normalized

  return `function Design(props) {
  return React.createElement(${componentName}, props);
}

${normalized}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function videoExtensionForUrl(url: string): string {
  const pathname = (() => {
    try { return new URL(url).pathname } catch { return url }
  })()
  const ext = path.extname(pathname).toLowerCase()
  return ['.mp4', '.mov', '.webm', '.m4v'].includes(ext) ? ext : '.mp4'
}

function extractVideoUrlsFromText(text: string): string[] {
  const urls = new Set<string>()
  const pattern = /https?:\/\/[^\s"'`<>)}\]]+\.(?:mp4|mov|webm|m4v)(?:[^\s"'`<>)}\]]*)?/gi
  for (const match of text.matchAll(pattern)) urls.add(match[0])
  return [...urls]
}

function extractVideoUrlsFromValue(value: unknown): string[] {
  if (typeof value === 'string') return extractVideoUrlsFromText(value)
  if (Array.isArray(value)) return value.flatMap(extractVideoUrlsFromValue)
  if (isObject(value)) return Object.values(value).flatMap(extractVideoUrlsFromValue)
  return []
}

function resolveLocalConcurrency(value: number | string | null | undefined): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) return Number(trimmed)
    if (trimmed) return trimmed
  }
  return 4
}

function resolveChromeMode(browserExecutable: string | undefined): 'chrome-for-testing' | 'headless-shell' {
  const value = process.env.REMOTION_CHROME_MODE
  if (value === 'chrome-for-testing' || value === 'headless-shell') return value
  return browserExecutable ? 'chrome-for-testing' : 'headless-shell'
}

async function downloadToCache(url: string, cacheDir: string): Promise<string> {
  mkdirSync(cacheDir, { recursive: true })
  const hash = createHash('sha256').update(url).digest('hex')
  const filePath = path.join(cacheDir, `${hash}${videoExtensionForUrl(url)}`)
  if (existsSync(filePath)) return filePath

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`Failed to prefetch video ${url}: ${res.status}`)
  }
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmpPath))
  await fs.rename(tmpPath, filePath)
  return filePath
}

function safeCacheName(filePath: string): string {
  return path.basename(filePath)
}

async function ensureMediaServer(root: string, port: number): Promise<void> {
  if (mediaServer && mediaServerRoot === root && mediaServerPort === port) return
  if (mediaServer) {
    await new Promise<void>((resolve) => mediaServer?.close(() => resolve()))
    mediaServer = null
  }

  mediaServerRoot = root
  mediaServerPort = port
  mediaServer = http.createServer(async (req, res) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Accept-Ranges': 'bytes',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers)
      res.end()
      return
    }

    try {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      const fileName = path.basename(decodeURIComponent(requestUrl.pathname))
      const filePath = path.join(root, fileName)
      if (!filePath.startsWith(root) || !existsSync(filePath)) {
        res.writeHead(404, headers)
        res.end('not found')
        return
      }

      const stat = await fs.stat(filePath)
      const range = req.headers.range
      const contentType = fileName.endsWith('.webm') ? 'video/webm' : 'video/mp4'
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/)
        const start = match?.[1] ? Number(match[1]) : 0
        const end = match?.[2] ? Number(match[2]) : stat.size - 1
        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, {
            ...headers,
            'Content-Range': `bytes */${stat.size}`,
          })
          res.end()
          return
        }
        res.writeHead(206, {
          ...headers,
          'Content-Type': contentType,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(filePath, { start, end }).pipe(res)
        return
      }

      res.writeHead(200, {
        ...headers,
        'Content-Type': contentType,
        'Content-Length': stat.size,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath).pipe(res)
    } catch (err) {
      res.writeHead(500, headers)
      res.end(err instanceof Error ? err.message : String(err))
    }
  })

  await new Promise<void>((resolve, reject) => {
    mediaServer?.once('error', reject)
    mediaServer?.listen(port, '127.0.0.1', () => resolve())
  })
}

async function localizeVideos(design: DesignPayload, cacheDir: string, port: number): Promise<DesignPayload> {
  const urls = new Set<string>([
    ...extractVideoUrlsFromText(design.code),
    ...extractVideoUrlsFromValue(design.props || {}),
  ])
  if (urls.size === 0) return design

  const t0 = Date.now()
  await ensureMediaServer(cacheDir, port)
  const replacements = new Map<string, string>()
  await Promise.all([...urls].map(async (url) => {
    const cached = await downloadToCache(url, cacheDir)
    replacements.set(url, `http://127.0.0.1:${port}/${encodeURIComponent(safeCacheName(cached))}`)
  }))
  console.log(JSON.stringify({
    event: 'remotion_local_media_localized',
    count: replacements.size,
    seconds: (Date.now() - t0) / 1000,
  }))

  let code = design.code
  for (const [from, to] of replacements) {
    while (code.includes(from)) code = code.replace(from, to)
  }

  const replaceInValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let next = value
      for (const [from, to] of replacements) {
        while (next.includes(from)) next = next.replace(from, to)
      }
      return next
    }
    if (Array.isArray(value)) return value.map(replaceInValue)
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceInValue(child)]))
    return value
  }

  return {
    ...design,
    code,
    props: replaceInValue(design.props || {}) as Record<string, unknown>,
  }
}

async function getBundleUrl(): Promise<string> {
  if (!bundlePromise) {
    const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx')
    const repoKey = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12)
    // Keep generated webpack chunks outside the repository. Leaving them under
    // process.cwd() makes eslint/build treat thousands of bundle files as
    // application source after the first local render.
    const outDir = process.env.REMOTION_LOCAL_BUNDLE_DIR
      || path.join(process.env.TMPDIR || '/tmp', `makaron-remotion-bundle-${repoKey}`)
    const t0 = Date.now()
    bundlePromise = bundle({
      entryPoint,
      outDir,
      onProgress: () => {},
    }).then((serveUrl) => {
      console.log(JSON.stringify({
        event: 'remotion_local_bundle_ready',
        seconds: (Date.now() - t0) / 1000,
      }))
      return serveUrl
    })
  }
  return bundlePromise
}

export async function renderDesignVideoLocal(
  design: DesignPayload,
  options: {
    onProgress?: (progress: unknown) => void | Promise<void>
    scale?: number
    concurrency?: number | string
    cacheDir?: string
    mediaServerPort?: number
  } = {},
): Promise<Buffer> {
  const fps = design.animation?.fps || 30
  const dur = design.animation?.durationInSeconds || 1 / fps
  const durationInFrames = Math.max(1, Math.round(fps * dur))
  const scale = Number.isFinite(options.scale) && options.scale && options.scale > 0 ? options.scale : 1
  const cacheDir = options.cacheDir || process.env.REMOTION_LOCAL_MEDIA_CACHE_DIR || '/tmp/makaron-remotion-media'
  const mediaServerPort = options.mediaServerPort || Number(process.env.REMOTION_LOCAL_MEDIA_PORT || 5123)
  const concurrency = resolveLocalConcurrency(options.concurrency ?? process.env.REMOTION_LOCAL_CONCURRENCY)
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined
  const chromeMode = resolveChromeMode(browserExecutable)
  const chromiumOptions = {
    gl: null,
    disableWebSecurity: true,
  }

  const resolvedDesign = await localizeVideos(design, cacheDir, mediaServerPort)
  const serveUrl = await getBundleUrl()
  const outputLocation = path.join(
    process.env.REMOTION_LOCAL_OUTPUT_DIR || '/tmp',
    `remotion-export-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`,
  )
  mkdirSync(path.dirname(outputLocation), { recursive: true })

  const inputProps = {
    code: prepareRemotionCodeForLocalRenderer(resolvedDesign.code),
    designProps: normalizeRemotionTextValue(resolvedDesign.props || {}),
    fps,
    durationInFrames,
    width: resolvedDesign.width || 1080,
    height: resolvedDesign.height || 1920,
    fontManifestUrl: resolveRemotionFontManifestUrl(),
    fontSubstitutions: resolvedDesign.fontSubstitutions || {},
    useNativeVideo: true,
  }
  const hasAudioSources = hasRemotionAudioSources(resolvedDesign.code)
  const composition = await selectComposition({
    serveUrl,
    id: 'dynamic-design',
    inputProps,
    browserExecutable,
    chromeMode,
    chromiumOptions,
  })

  const t0 = Date.now()
  console.log(JSON.stringify({
    event: 'remotion_local_render_started',
    durationInFrames,
    fps,
    width: resolvedDesign.width || 1080,
    height: resolvedDesign.height || 1920,
    scale,
    concurrency,
    browser: browserExecutable ? 'custom-executable' : 'remotion-managed',
    chromeMode,
  }))
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    browserExecutable,
    chromeMode,
    chromiumOptions,
    imageFormat: 'jpeg',
    scale,
    crf: 23,
    x264Preset: 'veryfast',
    concurrency,
    muted: !hasAudioSources,
    audioCodec: hasAudioSources ? 'aac' : null,
    enforceAudioTrack: hasAudioSources,
    onProgress: async (progress) => {
      await options.onProgress?.(progress)
    },
  })

  const buffer = await fs.readFile(outputLocation)
  await fs.unlink(outputLocation).catch(() => {})
  console.log(JSON.stringify({
    event: 'remotion_local_render_completed',
    renderSeconds: (Date.now() - t0) / 1000,
    bytes: buffer.length,
  }))
  return buffer
}

export async function renderDesignFrameLocal(
  design: DesignPayload,
  frame = 0,
  options: {
    cacheDir?: string
    mediaServerPort?: number
  } = {},
): Promise<Buffer> {
  const fps = design.animation?.fps || 30
  const dur = design.animation?.durationInSeconds || 1 / fps
  const durationInFrames = Math.max(1, Math.round(fps * dur))
  const cacheDir = options.cacheDir || process.env.REMOTION_LOCAL_MEDIA_CACHE_DIR || '/tmp/makaron-remotion-media'
  const mediaServerPort = options.mediaServerPort || Number(process.env.REMOTION_LOCAL_MEDIA_PORT || 5123)
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined
  const chromeMode = resolveChromeMode(browserExecutable)
  const chromiumOptions = {
    gl: null,
    disableWebSecurity: true,
  }

  const resolvedDesign = await localizeVideos(design, cacheDir, mediaServerPort)
  const serveUrl = await getBundleUrl()
  const outputLocation = path.join(
    process.env.REMOTION_LOCAL_OUTPUT_DIR || '/tmp',
    `remotion-still-${frame}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpeg`,
  )
  mkdirSync(path.dirname(outputLocation), { recursive: true })
  const inputProps = {
    code: prepareRemotionCodeForLocalRenderer(resolvedDesign.code),
    designProps: normalizeRemotionTextValue(resolvedDesign.props || {}),
    fps,
    durationInFrames,
    width: resolvedDesign.width || 1080,
    height: resolvedDesign.height || 1920,
    fontManifestUrl: resolveRemotionFontManifestUrl(),
    fontSubstitutions: resolvedDesign.fontSubstitutions || {},
    useOffthreadVideo: true,
  }
  const composition = await selectComposition({
    serveUrl,
    id: 'dynamic-design',
    inputProps,
    browserExecutable,
    chromeMode,
    chromiumOptions,
  })

  const safeFrame = Math.min(Math.max(0, Math.round(frame)), durationInFrames - 1)
  await renderStill({
    composition,
    serveUrl,
    output: outputLocation,
    inputProps,
    browserExecutable,
    chromeMode,
    chromiumOptions,
    imageFormat: 'jpeg',
    jpegQuality: 90,
    frame: safeFrame,
  })
  const buffer = await fs.readFile(outputLocation)
  await fs.unlink(outputLocation).catch(() => {})
  return buffer
}
