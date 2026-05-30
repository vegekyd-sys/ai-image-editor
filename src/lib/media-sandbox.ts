import { createRequire } from 'module'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { findFfmpeg, findFfprobe, probeVideoFile, type VideoProbe } from './ffmpeg-runtime'
import * as workspace from './workspace'
import { toPublicStorageUrl } from '@/lib/supabase/storage'

type SupabaseClient = any

export interface MediaItem {
  index: number
  kind: 'image' | 'video'
  url: string
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
  description?: string
  mediaRefs?: number[]
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

async function downloadFile(url: string, filePath: string): Promise<{ filePath: string; contentType: string; size: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url.slice(0, 80)}: ${res.status}`)
  const contentType = res.headers.get('content-type') || guessContentType(url)
  const buffer = Buffer.from(await res.arrayBuffer())
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, buffer)
  return { filePath, contentType, size: buffer.length }
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
      const imageUrl = typeof snap.image_url === 'string' ? snap.image_url : fallback[i]?.url || ''
      return {
        index: i + 1,
        kind: isVideo ? 'video' : 'image',
        url: isVideo ? (videoUrl || imageUrl) : imageUrl,
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
  const ffprobePath = await findFfprobe()
  const workDir = await mkdtemp(path.join(tmpdir(), 'makaron-media-'))
  const inputDir = path.join(workDir, 'inputs')
  const outputDir = path.join(workDir, 'outputs')
  await mkdir(inputDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })

  const selectedRefs = options.mediaRefs?.length
    ? options.mediaRefs
    : []
  const inputFiles: MediaInputFile[] = []

  try {
    for (const ref of selectedRefs) {
      const item = options.mediaItems[ref - 1]
      if (!item?.url) throw new Error(`No media found at <<<media_${ref}>>>`)
      const cleanUrl = item.url.split('?')[0] || item.url
      const ext = path.extname(cleanUrl) || (item.kind === 'video' ? '.mp4' : '.jpg')
      const fileName = `media_${ref}${ext}`
      const targetPath = path.join(inputDir, fileName)
      const downloaded = await downloadFile(item.url, targetPath)
      inputFiles.push({
        ...item,
        inputPath: downloaded.filePath,
        fileName,
        contentType: downloaded.contentType || guessContentType(fileName),
      })
    }

    const saveToWorkspace = async (workspacePath: string, content: string | Buffer, contentType?: string) => {
      if (!options.supabase || !options.userId) return { success: false, error: 'No Supabase connection' }
      const result = await workspace.writeFile(workspacePath, content, options.supabase, options.userId, contentType)
      return { ...result, storageUrl: result.storageUrl ? toPublicStorageUrl(result.storageUrl) : undefined }
    }

    const saveOutput = async (localPath: string, workspacePath?: string, contentType?: string) => {
      const fullPath = normalizeLocalPath(localPath, outputDir)
      const body = await readFile(fullPath)
      const ct = contentType || guessContentType(fullPath)
      const outPath = workspacePath || `${options.projectId}/media/${Date.now()}-${path.basename(fullPath)}`
      const saved = await saveToWorkspace(outPath, body, ct)
      return { ...saved, workspacePath: outPath, contentType: ct, size: body.length }
    }

    const context = {
      projectId: options.projectId,
      userId: options.userId,
      description: options.description || '',
      media: options.mediaItems,
      mediaRefs: selectedRefs,
      inputFiles,
      paths: { workDir, inputDir, outputDir },
      ffmpegPath,
      ffprobePath,
    }

    const localRequire = createRequire(import.meta.url)
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const runner = new AsyncFunction(
      'require',
      'process',
      'console',
      'Buffer',
      'fetch',
      'ctx',
      'context',
      'inputFiles',
      'outputDir',
      'inputDir',
      'workDir',
      'ffmpegPath',
      'ffprobePath',
      'downloadFile',
      'saveToWorkspace',
      'saveOutput',
      'probeVideo',
      '__filename',
      '__dirname',
      options.code,
    )

    const result = await withTimeout(
      runner(
        localRequire,
        process,
        console,
        Buffer,
        fetch,
        context,
        context,
        inputFiles,
        outputDir,
        inputDir,
        workDir,
        ffmpegPath,
        ffprobePath,
        downloadFile,
        saveToWorkspace,
        saveOutput,
        probeVideoFile,
        pathToFileURL(path.join(workDir, 'agent-media-code.js')).toString(),
        workDir,
      ),
      options.timeoutMs || 180_000,
      'Node media runtime',
    )

    let outputs = normalizeOutputs(result, outputDir)
    if (outputs.length === 0) {
      const files = await listFilesRecursive(outputDir)
      outputs = files.map(file => ({ path: file, contentType: guessContentType(file) }))
    }

    for (const output of outputs) {
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
    const type = primaryOutput?.contentType?.startsWith('video/')
      ? 'video'
      : primaryOutput?.contentType?.startsWith('image/')
        ? 'image'
        : resultType === 'text'
          ? 'text'
          : outputs.length > 0
            ? 'files'
            : 'text'

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
