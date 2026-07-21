import * as childProcess from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import { createRequire } from 'module'
import * as os from 'os'
import path from 'path'
import * as util from 'util'
import sharp from 'sharp'
import { transform as sucraseTransform } from 'sucrase'
import { findFfmpeg, findFfprobe, probeVideoFile, type VideoProbe } from './ffmpeg-runtime'
import * as workspace from './workspace'
import { toPublicStorageUrl } from '@/lib/supabase/storage'

const { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } = fsPromises
const { existsSync } = fs
const { tmpdir } = os
const INPUT_DOWNLOAD_CONCURRENCY = 2
const INPUT_DOWNLOAD_TIMEOUT_MS = 180_000
const serverRequire = createRequire(import.meta.url)
const BLOCKED_NODE_MODULES = new Set([
  'cluster',
  'inspector',
  'inspector/promises',
  'module',
  'repl',
  'vm',
  'worker_threads',
])
// Keep every runtime dependency statically discoverable by Next/Webpack.
// `serverRequire(id)` with a variable passes Vitest but produces an incomplete
// production bundle ("request of a dependency is an expression").
const NODE_BUILTIN_LOADERS: Record<string, () => unknown> = {
  assert: () => serverRequire('assert'),
  'assert/strict': () => serverRequire('assert/strict'),
  async_hooks: () => serverRequire('async_hooks'),
  buffer: () => serverRequire('buffer'),
  console: () => serverRequire('console'),
  constants: () => serverRequire('constants'),
  crypto: () => serverRequire('crypto'),
  dgram: () => serverRequire('dgram'),
  diagnostics_channel: () => serverRequire('diagnostics_channel'),
  dns: () => serverRequire('dns'),
  'dns/promises': () => serverRequire('dns/promises'),
  domain: () => serverRequire('domain'),
  events: () => serverRequire('events'),
  http: () => serverRequire('http'),
  http2: () => serverRequire('http2'),
  https: () => serverRequire('https'),
  net: () => serverRequire('net'),
  os: () => serverRequire('os'),
  perf_hooks: () => serverRequire('perf_hooks'),
  punycode: () => serverRequire('punycode'),
  querystring: () => serverRequire('querystring'),
  readline: () => serverRequire('readline'),
  'readline/promises': () => serverRequire('readline/promises'),
  stream: () => serverRequire('stream'),
  'stream/consumers': () => serverRequire('stream/consumers'),
  'stream/promises': () => serverRequire('stream/promises'),
  'stream/web': () => serverRequire('stream/web'),
  string_decoder: () => serverRequire('string_decoder'),
  sys: () => serverRequire('sys'),
  timers: () => serverRequire('timers'),
  'timers/promises': () => serverRequire('timers/promises'),
  tls: () => serverRequire('tls'),
  trace_events: () => serverRequire('trace_events'),
  tty: () => serverRequire('tty'),
  url: () => serverRequire('url'),
  util: () => serverRequire('util'),
  'util/types': () => serverRequire('util/types'),
  v8: () => serverRequire('v8'),
  wasi: () => serverRequire('wasi'),
  zlib: () => serverRequire('zlib'),
}

const MEDIA_PACKAGE_LOADERS: Record<string, () => unknown> = {
  '@remotion/media': () => serverRequire('@remotion/media'),
  '@remotion/media-utils': () => serverRequire('@remotion/media-utils'),
  '@remotion/renderer': () => serverRequire('@remotion/renderer'),
  canvas: () => serverRequire('canvas'),
  exifr: () => serverRequire('exifr'),
  'heic-convert': () => serverRequire('heic-convert'),
  jszip: () => serverRequire('jszip'),
  remotion: () => serverRequire('remotion'),
  sharp: () => sharp,
}
const SAFE_ENV_KEYS = new Set([
  'CI',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'PATH',
  'TMP',
  'TMPDIR',
  'TEMP',
  'TZ',
])
const SENSITIVE_ENV_RE = /(api|auth|credential|database|key|password|private|secret|session|signing|supabase|token|webhook)/i

type SupabaseClient = any

export interface MediaItem {
  index: number
  kind: 'image' | 'video'
  url: string
  workspacePath?: string
  localPath?: string
  posterUrl?: string
  description?: string
  duration?: number | null
  width?: number
  height?: number
  status?: string
}

export interface MediaInputFile extends MediaItem {
  inputPath: string
  fileName: string
  contentType: string
  source: 'workspace' | 'cache' | 'data-url' | 'remote'
}

export interface MediaSandboxOutput {
  path?: string
  workspacePath?: string
  storageUrl?: string
  contentType?: string
  description?: string
  duration?: number | null
  width?: number
  height?: number
  probe?: VideoProbe
}

export interface MediaSandboxResult {
  type: 'video' | 'image' | 'files' | 'text' | 'error'
  content?: string
  outputs: MediaSandboxOutput[]
  primaryOutput?: MediaSandboxOutput
  workDir: string
}

interface RunNodeMediaCodeOptions {
  code: string
  codePath?: string
  description?: string
  mediaRefs?: number[]
  workspacePaths?: string[]
  mediaItems: MediaItem[]
  projectId: string
  userId: string
  supabase?: SupabaseClient
  timeoutMs?: number
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.json') return 'application/json'
  if (ext === '.txt') return 'text/plain'
  return 'application/octet-stream'
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'media'
}

async function downloadFile(url: string, filePath: string, timeoutMs = INPUT_DOWNLOAD_TIMEOUT_MS): Promise<{ filePath: string; contentType: string; size: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`Failed to download ${url.slice(0, 80)}: ${res.status}`)
    const contentType = res.headers.get('content-type') || guessContentType(url)
    const buffer = Buffer.from(await res.arrayBuffer())
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, buffer)
    return { filePath, contentType, size: buffer.length }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Download timed out after ${timeoutMs}ms: ${url.slice(0, 120)}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function urlCacheKey(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16)
}

function mediaExtension(item: MediaItem): string {
  if (item.url.startsWith('data:')) return item.kind === 'video' ? '.mp4' : '.jpg'
  const cleanUrl = item.url.split('?')[0] || item.url
  const ext = path.extname(cleanUrl)
  if (ext) return ext
  return item.kind === 'video' ? '.mp4' : '.jpg'
}

async function resolveMediaInputFile(options: {
  item: MediaItem
  ref: number
  projectId: string
  userId: string
  supabase?: SupabaseClient
}): Promise<MediaInputFile> {
  const { item, ref } = options
  const ext = mediaExtension(item)
  const fileName = `media_${ref}${ext}`

  if (item.workspacePath && options.supabase) {
    const handle = await workspace.resolveWorkspaceFile(item.workspacePath, options.supabase, options.userId, { hydrate: true })
    if (handle?.localPath && handle.localAvailable) {
      console.log(`[media-sandbox] input <<<media_${ref}>>> workspace local ${item.workspacePath}`)
      return {
        ...item,
        inputPath: handle.localPath,
        localPath: handle.localPath,
        fileName,
        contentType: handle.contentType || guessContentType(fileName),
        source: 'workspace',
      }
    }
  }

  const cachePath = `${options.projectId}/media-inputs/${fileName.replace(ext, '')}-${urlCacheKey(item.url)}${ext}`
  const targetPath = workspace.getLocalWorkspacePath(options.userId, cachePath)
  if (existsSync(targetPath)) {
    console.log(`[media-sandbox] input <<<media_${ref}>>> cache local ${cachePath}`)
    return {
      ...item,
      inputPath: targetPath,
      localPath: targetPath,
      workspacePath: item.workspacePath || cachePath,
      fileName,
      contentType: guessContentType(fileName),
      source: item.url.startsWith('data:') ? 'data-url' : 'cache',
    }
  }

  const downloaded = await downloadFile(item.url, targetPath)
  console.log(`[media-sandbox] input <<<media_${ref}>>> hydrated ${cachePath}`)
  return {
    ...item,
    inputPath: downloaded.filePath,
    localPath: downloaded.filePath,
    workspacePath: item.workspacePath || cachePath,
    fileName,
    contentType: downloaded.contentType || guessContentType(fileName),
    source: item.url.startsWith('data:') ? 'data-url' : 'remote',
  }
}

async function resolveWorkspaceInputFile(options: {
  workspacePath: string
  index: number
  userId: string
  supabase?: SupabaseClient
}): Promise<MediaInputFile> {
  if (!options.supabase) throw new Error('Workspace file inputs require workspace access.')
  const handle = await workspace.resolveWorkspaceFile(options.workspacePath, options.supabase, options.userId, { hydrate: true })
  if (!handle?.localPath || !handle.localAvailable) {
    throw new Error(`Workspace file is not available: ${options.workspacePath}`)
  }
  const fileName = path.basename(options.workspacePath)
  const kind = handle.contentType.startsWith('video/') ? 'video' : 'image'
  console.log(`[media-sandbox] input workspace local ${options.workspacePath}`)
  return {
    index: options.index,
    kind,
    url: handle.storageUrl || '',
    workspacePath: handle.path,
    localPath: handle.localPath,
    inputPath: handle.localPath,
    fileName,
    contentType: handle.contentType,
    source: 'workspace',
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  })
  await Promise.all(workers)
  return results
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(full))
    } else {
      files.push(full)
    }
  }
  return files
}

function normalizeLocalPath(filePath: string, outputDir: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(outputDir, filePath)
}

function normalizeOutputs(raw: unknown, outputDir: string): MediaSandboxOutput[] {
  if (!raw || typeof raw !== 'object') return []
  const value = raw as Record<string, unknown>
  const rawOutputs = Array.isArray(value.outputs) ? value.outputs : (
    value.path || value.file || value.outputPath
      ? [{
          path: value.path || value.file || value.outputPath,
          contentType: value.contentType || value.mimeType,
          description: value.description,
          duration: value.duration,
          width: value.width,
          height: value.height,
        }]
      : []
  )

  return rawOutputs
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => ({
      path: typeof item.path === 'string' ? normalizeLocalPath(item.path, outputDir) : undefined,
      workspacePath: typeof item.workspacePath === 'string' ? item.workspacePath : undefined,
      storageUrl: typeof item.storageUrl === 'string' ? item.storageUrl : undefined,
      contentType: typeof item.contentType === 'string' ? item.contentType : (typeof item.mimeType === 'string' ? item.mimeType : undefined),
      description: typeof item.description === 'string' ? item.description : undefined,
      duration: typeof item.duration === 'number' ? item.duration : undefined,
      width: typeof item.width === 'number' ? item.width : undefined,
      height: typeof item.height === 'number' ? item.height : undefined,
    }))
}

function normalizeModuleId(id: string): string {
  return id.startsWith('node:') ? id.slice(5) : id
}

function sanitizeProcessEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || SENSITIVE_ENV_RE.test(key)) continue
      env[key] = value
    }
  }
  return env as NodeJS.ProcessEnv
}

function withSafeChildOptions(options: unknown, cwd: string): unknown {
  if (!options || typeof options === 'function') return { cwd, env: sanitizeProcessEnv() }
  if (typeof options !== 'object') return options
  const record = options as Record<string, unknown>
  return {
    ...record,
    cwd: typeof record.cwd === 'string' ? record.cwd : cwd,
    env: sanitizeProcessEnv(record.env as NodeJS.ProcessEnv | undefined),
  }
}

function createSafeChildProcess(cwd: string): typeof childProcess {
  const safeExec = ((command: string, optionsOrCallback?: unknown, callback?: unknown) => {
    if (typeof optionsOrCallback === 'function') {
      return (childProcess.exec as any)(command, withSafeChildOptions(undefined, cwd), optionsOrCallback)
    }
    return (childProcess.exec as any)(command, withSafeChildOptions(optionsOrCallback, cwd), callback)
  }) as typeof childProcess.exec
  ;(safeExec as any)[util.promisify.custom] = async (command: string, options?: unknown) => {
    const execAsync = util.promisify(childProcess.exec) as any
    return execAsync(command, withSafeChildOptions(options, cwd))
  }

  const safeExecFile = ((file: string, argsOrOptionsOrCallback?: unknown, optionsOrCallback?: unknown, callback?: unknown) => {
    if (Array.isArray(argsOrOptionsOrCallback)) {
      if (typeof optionsOrCallback === 'function') {
        return (childProcess.execFile as any)(file, argsOrOptionsOrCallback, withSafeChildOptions(undefined, cwd), optionsOrCallback)
      }
      return (childProcess.execFile as any)(file, argsOrOptionsOrCallback, withSafeChildOptions(optionsOrCallback, cwd), callback)
    }
    if (typeof argsOrOptionsOrCallback === 'function') {
      return (childProcess.execFile as any)(file, [], withSafeChildOptions(undefined, cwd), argsOrOptionsOrCallback)
    }
    return (childProcess.execFile as any)(file, [], withSafeChildOptions(argsOrOptionsOrCallback, cwd), optionsOrCallback)
  }) as typeof childProcess.execFile
  ;(safeExecFile as any)[util.promisify.custom] = async (
    file: string,
    argsOrOptions?: unknown,
    options?: unknown,
  ) => {
    const execFileAsync = util.promisify(childProcess.execFile) as any
    if (Array.isArray(argsOrOptions)) {
      return execFileAsync(file, argsOrOptions, withSafeChildOptions(options, cwd))
    }
    return execFileAsync(file, [], withSafeChildOptions(argsOrOptions, cwd))
  }

  return {
    ...childProcess,
    exec: safeExec,
    execFile: safeExecFile,
    spawn: ((command: string, argsOrOptions?: unknown, options?: unknown) => {
      if (Array.isArray(argsOrOptions)) {
        return childProcess.spawn(command, argsOrOptions, withSafeChildOptions(options, cwd) as childProcess.SpawnOptions)
      }
      return childProcess.spawn(command, [], withSafeChildOptions(argsOrOptions, cwd) as childProcess.SpawnOptions)
    }) as typeof childProcess.spawn,
    execSync: ((command: string, options?: unknown) => {
      return childProcess.execSync(command, withSafeChildOptions(options, cwd) as childProcess.ExecSyncOptions)
    }) as typeof childProcess.execSync,
    execFileSync: ((file: string, argsOrOptions?: unknown, options?: unknown) => {
      if (Array.isArray(argsOrOptions)) {
        return childProcess.execFileSync(file, argsOrOptions, withSafeChildOptions(options, cwd) as childProcess.ExecFileSyncOptions)
      }
      return childProcess.execFileSync(file, [], withSafeChildOptions(argsOrOptions, cwd) as childProcess.ExecFileSyncOptions)
    }) as typeof childProcess.execFileSync,
    spawnSync: ((command: string, argsOrOptions?: unknown, options?: unknown) => {
      if (Array.isArray(argsOrOptions)) {
        return childProcess.spawnSync(command, argsOrOptions, withSafeChildOptions(options, cwd) as childProcess.SpawnSyncOptions)
      }
      return childProcess.spawnSync(command, [], withSafeChildOptions(argsOrOptions, cwd) as childProcess.SpawnSyncOptions)
    }) as typeof childProcess.spawnSync,
  }
}

function createSafeProcess(cwd: string) {
  return {
    arch: process.arch,
    argv: ['node', path.join(cwd, 'agent-media-code.js')],
    cwd: () => cwd,
    env: sanitizeProcessEnv(),
    hrtime: process.hrtime.bind(process),
    memoryUsage: process.memoryUsage.bind(process),
    nextTick: process.nextTick.bind(process),
    pid: process.pid,
    platform: process.platform,
    release: process.release,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    title: 'makaron-media-runtime',
    uptime: process.uptime.bind(process),
    version: process.version,
    versions: process.versions,
    chdir: () => {
      throw new Error('process.chdir is not available in the Node media runtime. Use absolute paths from workDir/outputDir/inputFiles instead.')
    },
    exit: () => {
      throw new Error('process.exit is not available in the Node media runtime. Return a result object instead.')
    },
    kill: () => {
      throw new Error('process.kill is not available in the Node media runtime.')
    },
  }
}

function createNodeMediaRequire(cwd: string, safeProcess: ReturnType<typeof createSafeProcess>): NodeRequire {
  const builtins: Record<string, unknown> = {
    child_process: createSafeChildProcess(cwd),
    'node:child_process': createSafeChildProcess(cwd),
    fs,
    'node:fs': fs,
    'fs/promises': fsPromises,
    'node:fs/promises': fsPromises,
    path,
    'node:path': path,
    process: safeProcess,
    'node:process': safeProcess,
    util,
    'node:util': util,
    sharp,
  }

  return ((id: string) => {
    const normalized = normalizeModuleId(id)
    if (BLOCKED_NODE_MODULES.has(normalized)) {
      throw new Error(`Module "${id}" is not available in the Node media runtime for safety.`)
    }
    if (id in builtins) return builtins[id]
    const builtinLoader = NODE_BUILTIN_LOADERS[normalized]
    if (builtinLoader) return builtinLoader()
    const packageLoader = MEDIA_PACKAGE_LOADERS[id]
    if (packageLoader) return packageLoader()
    throw new Error(`Module "${id}" is not available in the Node media runtime. Node built-ins and media packages are available; arbitrary local files or npm packages are blocked for safety.`)
  }) as NodeRequire
}

function compileNodeMediaCode(code: string, codePath?: string): string {
  try {
    return sucraseTransform(code, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
      filePath: codePath || 'agent-media-code.tsx',
    }).code
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Node media compile failed${codePath ? ` for ${codePath}` : ''}: ${message}`)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function buildMediaItems(options: {
  snapshotImages: string[]
  projectId: string
  supabase?: SupabaseClient
}): Promise<MediaItem[]> {
  const fallback = options.snapshotImages.map((url, index) => ({
    index: index + 1,
    kind: /\.(mp4|mov|webm)(?:\?|$)/i.test(url || '') ? 'video' as const : 'image' as const,
    url,
  }))

  if (!options.supabase || !options.projectId) return fallback

  try {
    const { data } = await options.supabase
      .from('snapshots')
      .select('image_url, description, type, video_meta')
      .eq('project_id', options.projectId)
      .order('sort_order', { ascending: true })

    if (!data?.length) return fallback

    return data.map((snap: Record<string, unknown>, i: number) => {
      const videoMeta = snap.video_meta as Record<string, unknown> | null
      const isVideo = snap.type === 'video'
      const videoUrl = typeof videoMeta?.videoUrl === 'string' ? videoMeta.videoUrl : ''
      const videoPath = typeof videoMeta?.videoPath === 'string' ? videoMeta.videoPath : undefined
      const imageUrl = typeof snap.image_url === 'string' ? snap.image_url : fallback[i]?.url || ''
      return {
        index: i + 1,
        kind: isVideo ? 'video' : 'image',
        url: isVideo ? (videoUrl || imageUrl) : imageUrl,
        workspacePath: isVideo ? videoPath : undefined,
        posterUrl: isVideo ? imageUrl : undefined,
        description: typeof snap.description === 'string' ? snap.description : undefined,
        duration: typeof videoMeta?.duration === 'number' ? videoMeta.duration : undefined,
        width: typeof videoMeta?.width === 'number' ? videoMeta.width : undefined,
        height: typeof videoMeta?.height === 'number' ? videoMeta.height : undefined,
        status: typeof videoMeta?.status === 'string' ? videoMeta.status : undefined,
      }
    })
  } catch (e) {
    console.warn('[media-sandbox] failed to build DB media items:', e)
    return fallback
  }
}

export async function runNodeMediaCode(options: RunNodeMediaCodeOptions): Promise<MediaSandboxResult> {
  const ffmpegPath = await findFfmpeg()
  const ffprobePath = await findFfprobe().catch(() => '')
  const workDir = await mkdtemp(path.join(tmpdir(), 'makaron-media-'))
  const workspaceDir = workspace.getLocalWorkspaceRoot(options.userId)
  const inputDir = path.join(workDir, 'inputs')
  const outputDir = path.join(workDir, 'outputs')
  await mkdir(inputDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await mkdir(workspaceDir, { recursive: true })

  const selectedRefs = options.mediaRefs?.length
    ? options.mediaRefs
    : []
  const selectedWorkspacePaths = options.workspacePaths?.length ? options.workspacePaths : []
  const inputFiles: MediaInputFile[] = []

  try {
    const resolvedInputs = await mapWithConcurrency(selectedRefs, INPUT_DOWNLOAD_CONCURRENCY, async (ref) => {
      const item = options.mediaItems[ref - 1]
      if (!item?.url) throw new Error(`No media found at <<<media_${ref}>>>`)
      return resolveMediaInputFile({
        item,
        ref,
        projectId: options.projectId,
        userId: options.userId,
        supabase: options.supabase,
      })
    })
    inputFiles.push(...resolvedInputs)

    const resolvedWorkspaceInputs = await mapWithConcurrency(selectedWorkspacePaths, INPUT_DOWNLOAD_CONCURRENCY, async (workspacePath, index) => {
      return resolveWorkspaceInputFile({
        workspacePath,
        index: selectedRefs.length + index + 1,
        userId: options.userId,
        supabase: options.supabase,
      })
    })
    inputFiles.push(...resolvedWorkspaceInputs)

    const saveToWorkspace = async (workspacePath: string, content: string | Buffer, contentType?: string) => {
      if (!options.supabase || !options.userId) return { success: false, error: 'No Supabase connection' }
      const result = await workspace.writeFile(workspacePath, content, options.supabase, options.userId, contentType)
      return { ...result, storageUrl: result.storageUrl ? toPublicStorageUrl(result.storageUrl) : undefined }
    }

    const savedOutputsByLocalPath = new Map<string, {
      workspacePath: string;
      storageUrl?: string;
      contentType: string;
      size: number;
    }>()

    const saveOutput = async (localPath: string, workspacePath?: string, contentType?: string) => {
      const fullPath = normalizeLocalPath(localPath, outputDir)
      const body = await readFile(fullPath)
      const ct = contentType || guessContentType(fullPath)
      const outPath = workspacePath || `${options.projectId}/media/${Date.now()}-${path.basename(fullPath)}`
      const saved = await saveToWorkspace(outPath, body, ct)
      const output = { ...saved, workspacePath: outPath, contentType: ct, size: body.length }
      savedOutputsByLocalPath.set(path.resolve(fullPath), output)
      return output
    }

    const context = {
      projectId: options.projectId,
      userId: options.userId,
      description: options.description || '',
      media: options.mediaItems,
      mediaRefs: selectedRefs,
      workspacePaths: selectedWorkspacePaths,
      inputFiles,
      paths: { workDir, inputDir, outputDir, workspaceDir },
      workspaceDir,
      ffmpegPath,
      ffprobePath,
    }

    const safeProcess = createSafeProcess(workDir)
    const localRequire = createNodeMediaRequire(workDir, safeProcess)
    const compiledCode = compileNodeMediaCode(options.code, options.codePath)
    const mediaModule = { exports: {} as unknown }
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const runner = new AsyncFunction(
      'require',
      'process',
      'console',
      'fetch',
      'ctx',
      'context',
      'inputFiles',
      'outputDir',
      'inputDir',
      'workDir',
      'workspaceDir',
      'ffmpegPath',
      'ffprobePath',
      'downloadFile',
      'saveToWorkspace',
      'saveOutput',
      'probeVideo',
      '__filename',
      '__dirname',
      'module',
      'exports',
      compiledCode,
    )

    let result = await withTimeout(
      runner(
        localRequire,
        safeProcess,
        console,
        fetch,
        context,
        context,
        inputFiles,
        outputDir,
        inputDir,
        workDir,
        workspaceDir,
        ffmpegPath,
        ffprobePath,
        downloadFile,
        saveToWorkspace,
        saveOutput,
        probeVideoFile,
        path.join(workDir, options.codePath ? path.basename(options.codePath) : 'agent-media-code.js'),
        workDir,
        mediaModule,
        mediaModule.exports,
      ),
      options.timeoutMs || 180_000,
      'Node media runtime',
    )

    // Natural ESM/CommonJS files may export their program instead of using a
    // top-level return. Invoke the conventional exported function with the
    // same open runtime API, or accept an exported result object directly.
    if (result === undefined) {
      const exported = mediaModule.exports as any
      const entry = exported?.default ?? exported?.main ?? exported?.run ?? exported?.handler
      if (typeof entry === 'function') {
        result = await withTimeout(
          Promise.resolve(entry({
            require: localRequire,
            process: safeProcess,
            console,
            fetch,
            ctx: context,
            context,
            inputFiles,
            outputDir,
            inputDir,
            workDir,
            workspaceDir,
            ffmpegPath,
            ffprobePath,
            downloadFile,
            saveToWorkspace,
            saveOutput,
            probeVideo: probeVideoFile,
          })),
          options.timeoutMs || 180_000,
          'Node media exported entry',
        )
      } else if (entry !== undefined) {
        result = entry
      } else if (exported && (typeof exported !== 'object' || Object.keys(exported).length > 0)) {
        result = exported
      }
    }

    let outputs = normalizeOutputs(result, outputDir)
    if (outputs.length === 0) {
      const files = await listFilesRecursive(outputDir)
      outputs = files.map(file => ({ path: file, contentType: guessContentType(file) }))
    }

    for (const output of outputs) {
      const previouslySaved = output.path
        ? savedOutputsByLocalPath.get(path.resolve(output.path))
        : undefined
      if (previouslySaved && !output.storageUrl) {
        output.workspacePath = previouslySaved.workspacePath
        output.storageUrl = previouslySaved.storageUrl
        output.contentType = output.contentType || previouslySaved.contentType
      }

      if (!output.storageUrl && output.path && existsSync(output.path)) {
        const body = await readFile(output.path)
        const ct = output.contentType || guessContentType(output.path)
        const workspacePath = output.workspacePath || `${options.projectId}/media/${Date.now()}-${slugify(path.basename(output.path, path.extname(output.path)))}${path.extname(output.path)}`
        const saved = await saveToWorkspace(workspacePath, body, ct)
        output.workspacePath = workspacePath
        output.storageUrl = 'storageUrl' in saved && saved.storageUrl ? toPublicStorageUrl(saved.storageUrl) : undefined
        output.contentType = ct
      }

      if (output.path && output.contentType?.startsWith('video/')) {
        try {
          const probe = await probeVideoFile(output.path)
          output.probe = probe
          output.duration = output.duration ?? probe.duration
          output.width = output.width ?? probe.width
          output.height = output.height ?? probe.height
        } catch (e) {
          console.warn('[media-sandbox] ffprobe output failed:', e)
        }
      }
    }

    const primaryOutput = outputs.find(o => o.contentType?.startsWith('video/')) || outputs[0]
    const resultType = typeof result === 'object' && result && 'type' in result
      ? String((result as Record<string, unknown>).type)
      : undefined
    const explicitType = ['video', 'image', 'files', 'text'].includes(resultType || '')
      ? resultType
      : undefined
    const type = explicitType || (
      primaryOutput?.contentType?.startsWith('video/')
        ? 'video'
        : primaryOutput?.contentType?.startsWith('image/')
          ? 'image'
          : outputs.length > 0
            ? 'files'
            : 'text'
    )

    return {
      type: type as MediaSandboxResult['type'],
      content: typeof result === 'object' && result && 'content' in result ? String((result as Record<string, unknown>).content) : undefined,
      outputs,
      primaryOutput,
      workDir,
    }
  } catch (e) {
    return {
      type: 'error',
      content: e instanceof Error ? e.message : String(e),
      outputs: [],
      workDir,
    }
  } finally {
    // Keep temp files during local debugging if explicitly requested.
    if (process.env.KEEP_MEDIA_SANDBOX_TMP !== 'true') {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    } else {
      const size = existsSync(workDir) ? (await stat(workDir).catch(() => null))?.size : 0
      console.log(`[media-sandbox] kept temp dir ${workDir}${size ? ` (${size} bytes)` : ''}`)
    }
  }
}
