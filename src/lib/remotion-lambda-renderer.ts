import { randomUUID } from 'node:crypto'
import type { DesignPayload } from '@/types'
import { hasRemotionAudioSources } from '@/lib/remotion-audio'
import { resolveRemotionLambdaEncodingSettings } from '@/lib/remotion-encoding'
import { prepareRemotionCodeForSandbox } from '@/lib/remotion-server'
import { resolveRemotionFontManifestUrl } from '@/lib/remotion-font-manifest'
import {
  REMOTION_FONT_CATALOG_VERSION,
  REMOTION_FONT_RUNTIME_VERSION,
} from '@/remotion/font-catalog'

type RemotionLambdaClient = typeof import('@remotion/lambda-client')
type LambdaRenderProgress = Awaited<ReturnType<RemotionLambdaClient['getRenderProgress']>>
type LambdaRenderInput = Parameters<RemotionLambdaClient['renderMediaOnLambda']>[0]
type LambdaProgressInput = Parameters<RemotionLambdaClient['getRenderProgress']>[0]

export interface RemotionLambdaOutputDestination {
  bucketName: string
  key: string
  s3OutputProvider: NonNullable<LambdaRenderInput['outName']> extends infer OutName
    ? OutName extends { s3OutputProvider?: infer Provider }
      ? NonNullable<Provider>
      : never
    : never
  privacy?: LambdaRenderInput['privacy']
}

export interface RemotionLambdaTimingSummary {
  totalSeconds: number
  submitSeconds: number
  pollUntilDoneSeconds: number
  pollCount: number
  avgPollMs: number | null
  maxPollMs: number | null
  timeToRenderFramesMs?: number | null
  timeToEncodeMs?: number | null
  timeToFinishMs?: number | null
  framesRendered?: number | null
  chunks?: number | null
  lambdasInvoked?: number | null
  mostExpensiveFrameRanges?: unknown
  functionLaunchedAt?: number | null
  compositionValidatedAt?: number | null
  serveUrlOpenedAt?: number | null
  fontTelemetry?: RemotionLambdaFontTimingSummary
}

export interface RemotionLambdaFontTimingShard {
  initialFrame: number
  artifactBytes: number
  artifactUrl: string
  cacheHit: boolean
  totalMs: number
  manifestMs: number
  selectionMs: number
  fontFacesMs: number
  fontsReadyMs: number
  fontsCheckMs: number
  faceCount: number
  uniqueResourceCount: number
}

export interface RemotionLambdaFontTimingSummary {
  available: boolean
  telemetryId: string
  collectionMs: number
  artifactCount: number
  shardCount: number
  coldShardCount: number
  warmShardCount: number
  maxTotalMs: number | null
  avgTotalMs: number | null
  maxManifestMs: number | null
  avgManifestMs: number | null
  maxSelectionMs: number | null
  avgSelectionMs: number | null
  maxFontFacesMs: number | null
  avgFontFacesMs: number | null
  maxFontsReadyMs: number | null
  avgFontsReadyMs: number | null
  maxFontsCheckMs: number | null
  avgFontsCheckMs: number | null
  faceRequestCount: number
  uniqueResourceRequestCount: number
  observedTransferBytes: number
  errors: string[]
  shards: RemotionLambdaFontTimingShard[]
}

export interface RemotionLambdaUrlResult {
  url: string
  renderId: string
  bucketName: string
  functionName: string
  rendererFunctionName: string
  outputSizeInBytes?: number | null
  videoBitrate?: string | null
  audioBitrate?: string | null
  renderSeconds: number
  timings: RemotionLambdaTimingSummary
  progress: LambdaRenderProgress
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()
  return value || undefined
}

const runtimeMarkerCache = new Map<string, Promise<void>>()

async function assertPinnedRemotionRuntime(serveUrl: string): Promise<void> {
  const markerUrl = new URL('public/remotion-runtime.json', serveUrl).href
  let pending = runtimeMarkerCache.get(markerUrl)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(markerUrl, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(
          `Remotion render site is not font-pinned (${response.status}): ${serveUrl}. `
          + 'Deploy the current Remotion runtime and update REMOTION_LAMBDA_SERVE_URL.',
        )
      }
      const marker = await response.json() as Record<string, unknown>
      if (marker.runtimeVersion !== REMOTION_FONT_RUNTIME_VERSION
        || marker.fontCatalogVersion !== REMOTION_FONT_CATALOG_VERSION) {
        throw new Error(
          `Remotion render site version mismatch: ${serveUrl}. `
          + `Expected ${REMOTION_FONT_RUNTIME_VERSION}/${REMOTION_FONT_CATALOG_VERSION}.`,
        )
      }
    })()
    runtimeMarkerCache.set(markerUrl, pending)
  }
  try {
    await pending
  } catch (error) {
    runtimeMarkerCache.delete(markerUrl)
    throw error
  }
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  return Math.max(1, Math.round(readPositiveNumber(value, fallback)))
}

// Cross-composition benchmark default. Keep experiments behind the env override
// instead of retuning the product default from a single composition.
const DEFAULT_FRAMES_PER_LAMBDA = 20

function readBooleanEnv(name: string): boolean {
  const value = readEnv(name)
  return value === '1' || value === 'true'
}

function readX264Preset(): LambdaRenderInput['x264Preset'] {
  const value = readEnv('REMOTION_LAMBDA_X264_PRESET') || 'ultrafast'
  const allowed = new Set([
    'ultrafast',
    'superfast',
    'veryfast',
    'faster',
    'fast',
    'medium',
    'slow',
    'slower',
    'veryslow',
    'placebo',
  ])
  if (!allowed.has(value)) {
    throw new Error(`Unsupported REMOTION_LAMBDA_X264_PRESET: ${value}`)
  }
  return value as LambdaRenderInput['x264Preset']
}

function lambdaEnv(name: string): string {
  const value = readEnv(name)
  if (!value) throw new Error(`${name} is required when REMOTION_RENDERER=lambda`)
  return value
}

const REMOTION_AWS_ENV_NAMES = [
  'REMOTION_AWS_ACCESS_KEY_ID',
  'REMOTION_AWS_SECRET_ACCESS_KEY',
  'REMOTION_AWS_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const

/**
 * Remotion's Lambda client reads AWS credentials directly from process.env.
 * Normalize the values in place before it constructs an Authorization header;
 * Vercel env values written with `echo` may otherwise contain a trailing LF.
 */
export function sanitizeRemotionAwsEnvironment(): void {
  for (const name of REMOTION_AWS_ENV_NAMES) {
    const raw = process.env[name]
    if (raw === undefined) continue
    const clean = raw.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()
    if (clean) process.env[name] = clean
    else delete process.env[name]
  }
}

async function withRemotionAwsCredentials<T>(fn: () => Promise<T>): Promise<T> {
  // @remotion/lambda-client reads REMOTION_AWS_* before AWS_* by itself.
  // Do not temporarily overwrite global AWS_* in the Next.js process: concurrent
  // requests may initialize another AWS client with Remotion's IAM user.
  sanitizeRemotionAwsEnvironment()
  return fn()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryTransient<T>(
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === attempts) break
      await sleep(delayMs * attempt)
    }
  }
  throw lastError
}

function progressValue(progress: LambdaRenderProgress): number {
  if (typeof progress.overallProgress === 'number') return progress.overallProgress
  return progress.done ? 1 : 0
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function roundedMs(value: number): number {
  return Math.round(value * 100) / 100
}

function maxOrNull(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null
}

function averageOrNull(values: number[]): number | null {
  return values.length > 0
    ? roundedMs(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null
}

export function summarizeRemotionFontTiming(input: {
  telemetryId: string
  collectionMs: number
  artifactCount: number
  shards: RemotionLambdaFontTimingShard[]
  errors?: string[]
}): RemotionLambdaFontTimingSummary {
  const shards = [...input.shards].sort((a, b) => a.initialFrame - b.initialFrame)
  const totalMs = shards.map((shard) => shard.totalMs)
  const manifestMs = shards.map((shard) => shard.manifestMs)
  const selectionMs = shards.map((shard) => shard.selectionMs)
  const fontFacesMs = shards.map((shard) => shard.fontFacesMs)
  const fontsReadyMs = shards.map((shard) => shard.fontsReadyMs)
  const fontsCheckMs = shards.map((shard) => shard.fontsCheckMs)

  return {
    available: shards.length > 0,
    telemetryId: input.telemetryId,
    collectionMs: roundedMs(input.collectionMs),
    artifactCount: input.artifactCount,
    shardCount: shards.length,
    coldShardCount: shards.filter((shard) => !shard.cacheHit).length,
    warmShardCount: shards.filter((shard) => shard.cacheHit).length,
    maxTotalMs: maxOrNull(totalMs),
    avgTotalMs: averageOrNull(totalMs),
    maxManifestMs: maxOrNull(manifestMs),
    avgManifestMs: averageOrNull(manifestMs),
    maxSelectionMs: maxOrNull(selectionMs),
    avgSelectionMs: averageOrNull(selectionMs),
    maxFontFacesMs: maxOrNull(fontFacesMs),
    avgFontFacesMs: averageOrNull(fontFacesMs),
    maxFontsReadyMs: maxOrNull(fontsReadyMs),
    avgFontsReadyMs: averageOrNull(fontsReadyMs),
    maxFontsCheckMs: maxOrNull(fontsCheckMs),
    avgFontsCheckMs: averageOrNull(fontsCheckMs),
    faceRequestCount: shards.reduce((sum, shard) => sum + shard.faceCount, 0),
    uniqueResourceRequestCount: shards.reduce(
      (sum, shard) => sum + shard.uniqueResourceCount,
      0,
    ),
    observedTransferBytes: 0,
    errors: input.errors || [],
    shards,
  }
}

function collectFontTimingArtifacts(input: {
  progress: LambdaRenderProgress
  telemetryId: string
}): RemotionLambdaFontTimingSummary {
  const startedAt = Date.now()
  const prefix = `makaron-font-timing-${input.telemetryId}-`
  const artifacts = input.progress.artifacts.filter((artifact) =>
    artifact.filename.startsWith(prefix) && artifact.filename.endsWith('.json'))
  const uniqueArtifacts = [...new Map(artifacts.map((artifact) => [artifact.filename, artifact])).values()]
  const errors: string[] = []
  const shards: RemotionLambdaFontTimingShard[] = []
  const timingPattern = new RegExp(
    `^${input.telemetryId}-(\\d+)-[a-z0-9]+-t(\\d+)-m(\\d+)-s(\\d+)-f(\\d+)-r(\\d+)-c(\\d+)-n(\\d+)-u(\\d+)-w([01])\\.json$`,
  )
  for (const artifact of uniqueArtifacts) {
    const suffix = artifact.filename.slice('makaron-font-timing-'.length)
    const match = timingPattern.exec(suffix)
    if (!match) {
      errors.push(`${artifact.filename}: invalid font timing filename`)
      continue
    }
    const fromToken = (value: string) => Number(value) / 100
    shards.push({
      initialFrame: Number(match[1]),
      artifactBytes: artifact.sizeInBytes,
      artifactUrl: artifact.s3Url,
      totalMs: fromToken(match[2]),
      manifestMs: fromToken(match[3]),
      selectionMs: fromToken(match[4]),
      fontFacesMs: fromToken(match[5]),
      fontsReadyMs: fromToken(match[6]),
      fontsCheckMs: fromToken(match[7]),
      faceCount: Number(match[8]),
      uniqueResourceCount: Number(match[9]),
      cacheHit: match[10] === '1',
    })
  }
  if (uniqueArtifacts.length === 0) {
    errors.push('No font timing artifacts were returned by the Remotion runtime')
  }

  return summarizeRemotionFontTiming({
    telemetryId: input.telemetryId,
    collectionMs: roundedMs(Date.now() - startedAt),
    artifactCount: uniqueArtifacts.length,
    shards,
    errors,
  })
}

function readProgressTiming(progress: LambdaRenderProgress, key: string): number | null {
  return numberOrNull((progress as unknown as Record<string, unknown>)[key])
}

function buildTimingSummary(input: {
  startMs: number
  submitStartMs: number
  submitEndMs: number
  doneMs: number
  pollDurationsMs: number[]
  progress: LambdaRenderProgress
}): RemotionLambdaTimingSummary {
  const pollCount = input.pollDurationsMs.length
  const sumPollMs = input.pollDurationsMs.reduce((sum, value) => sum + value, 0)
  return {
    totalSeconds: (input.doneMs - input.startMs) / 1000,
    submitSeconds: (input.submitEndMs - input.submitStartMs) / 1000,
    pollUntilDoneSeconds: (input.doneMs - input.submitEndMs) / 1000,
    pollCount,
    avgPollMs: pollCount > 0 ? Math.round(sumPollMs / pollCount) : null,
    maxPollMs: pollCount > 0 ? Math.max(...input.pollDurationsMs) : null,
    timeToRenderFramesMs: readProgressTiming(input.progress, 'timeToRenderFrames'),
    timeToEncodeMs: readProgressTiming(input.progress, 'timeToEncode'),
    timeToFinishMs: readProgressTiming(input.progress, 'timeToFinish'),
    framesRendered: readProgressTiming(input.progress, 'framesRendered'),
    chunks: readProgressTiming(input.progress, 'chunks'),
    lambdasInvoked: readProgressTiming(input.progress, 'lambdasInvoked'),
    mostExpensiveFrameRanges: (input.progress as unknown as Record<string, unknown>).mostExpensiveFrameRanges,
    functionLaunchedAt: readProgressTiming(input.progress, 'functionLaunched'),
    compositionValidatedAt: readProgressTiming(input.progress, 'compositionValidated'),
    serveUrlOpenedAt: readProgressTiming(input.progress, 'serveUrlOpened'),
  }
}

async function downloadOutput(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Lambda output download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function renderDesignVideoLambdaToUrl(
  design: DesignPayload,
  options: {
    onProgress?: (progress: unknown) => void | Promise<void>
    scale?: number
    outputDestination?: RemotionLambdaOutputDestination
  } = {},
): Promise<RemotionLambdaUrlResult> {
  const region = readEnv('REMOTION_LAMBDA_REGION') || readEnv('AWS_REGION') || 'us-east-1'
  const functionName = lambdaEnv('REMOTION_LAMBDA_FUNCTION_NAME')
  const rendererFunctionName = readEnv('REMOTION_LAMBDA_RENDERER_FUNCTION_NAME')
  const serveUrl = lambdaEnv('REMOTION_LAMBDA_SERVE_URL')
  await assertPinnedRemotionRuntime(serveUrl)
  const fps = design.animation?.fps || 30
  const dur = design.animation?.durationInSeconds || 1 / fps
  const durationInFrames = Math.max(1, Math.round(fps * dur))
  const scale = Number.isFinite(options.scale) && options.scale && options.scale > 0 ? options.scale : 1
  const useLegacyConcurrency = readBooleanEnv('REMOTION_LAMBDA_USE_CONCURRENCY')
  const concurrency = useLegacyConcurrency && readEnv('REMOTION_LAMBDA_CONCURRENCY')
    ? readPositiveInteger(readEnv('REMOTION_LAMBDA_CONCURRENCY'), 10)
    : undefined
  const framesPerLambda = concurrency
    ? undefined
    : readPositiveInteger(readEnv('REMOTION_LAMBDA_FRAMES_PER_LAMBDA'), DEFAULT_FRAMES_PER_LAMBDA)
  const pollMs = readPositiveInteger(readEnv('REMOTION_LAMBDA_POLL_MS'), 1000)
  const x264Preset = readX264Preset()
  const jpegQuality = readPositiveInteger(readEnv('REMOTION_LAMBDA_JPEG_QUALITY'), 80)
  const deleteAfter = readEnv('REMOTION_LAMBDA_DELETE_AFTER') || null
  const useOffthreadVideo = readEnv('REMOTION_LAMBDA_USE_OFFTHREAD_VIDEO') === 'true'
  const logLevel = readEnv('REMOTION_LAMBDA_LOG_LEVEL') || 'warn'
  const timeoutInMilliseconds = readPositiveInteger(readEnv('REMOTION_LAMBDA_TIMEOUT_MS'), 120000)
  const progressRetryAttempts = readPositiveInteger(readEnv('REMOTION_LAMBDA_PROGRESS_RETRIES'), 3)
  const fontTelemetryId = randomUUID()
  const preparedCode = prepareRemotionCodeForSandbox(design.code)
  const fontManifestUrl = resolveRemotionFontManifestUrl(serveUrl)
  const hasAudioSources = hasRemotionAudioSources(design.code)
  const encoding = resolveRemotionLambdaEncodingSettings()
  const audioBitrate = hasAudioSources ? encoding.audioBitrate : null
  const crf = encoding.videoBitrate ? undefined : readPositiveNumber(readEnv('REMOTION_LAMBDA_CRF'), 23)
  const t0 = Date.now()
  const submitStartMs = Date.now()

  const started = await withRemotionAwsCredentials(async () => {
    const { renderMediaOnLambda } = await import('@remotion/lambda-client')
    return renderMediaOnLambda({
      region: region as LambdaRenderInput['region'],
      functionName,
      rendererFunctionName,
      serveUrl,
      composition: 'dynamic-design',
      inputProps: {
        code: preparedCode,
        designProps: design.props || {},
        fps,
        durationInFrames,
        width: design.width || 1080,
        height: design.height || 1920,
        fontManifestUrl,
        fontSubstitutions: design.fontSubstitutions || {},
        fontTelemetryId,
        useOffthreadVideo,
        useNativeVideo: true,
      },
      codec: 'h264',
      imageFormat: 'jpeg',
      scale,
      crf,
      videoBitrate: encoding.videoBitrate,
      audioBitrate,
      x264Preset,
      framesPerLambda,
      concurrency,
      concurrencyPerLambda: readPositiveInteger(readEnv('REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA'), 1),
      chromiumOptions: { disableWebSecurity: true, gl: null },
      muted: !hasAudioSources,
      audioCodec: hasAudioSources ? 'aac' : null,
      jpegQuality,
      maxRetries: readPositiveInteger(readEnv('REMOTION_LAMBDA_MAX_RETRIES'), 1),
      timeoutInMilliseconds,
      logLevel: logLevel as LambdaRenderInput['logLevel'],
      deleteAfter: deleteAfter as LambdaRenderInput['deleteAfter'],
      privacy: options.outputDestination?.privacy,
      outName: options.outputDestination ? {
        bucketName: options.outputDestination.bucketName,
        key: options.outputDestination.key,
        s3OutputProvider: options.outputDestination.s3OutputProvider,
      } : undefined,
      metadata: {
        renderer: 'makaron-remotion-lambda',
        rendererFunctionName: rendererFunctionName || functionName,
        x264Preset: String(x264Preset),
        crf: crf === undefined ? '' : String(crf),
        videoBitrate: encoding.videoBitrate || '',
        audioBitrate: audioBitrate || '',
        framesPerLambda: framesPerLambda ? String(framesPerLambda) : '',
        concurrency: concurrency ? String(concurrency) : '',
        chunkingMode: concurrency ? 'concurrency' : 'framesPerLambda',
      },
    })
  })
  const submitEndMs = Date.now()
  const pollDurationsMs: number[] = []

  await options.onProgress?.({
    progress: 0,
    renderId: started.renderId,
    bucketName: started.bucketName,
    renderer: 'lambda',
    phase: 'submitted',
    elapsedSeconds: (Date.now() - t0) / 1000,
    submitSeconds: (submitEndMs - submitStartMs) / 1000,
  })

  while (true) {
    const pollStartMs = Date.now()
    const progressInput: LambdaProgressInput = {
      region: region as LambdaProgressInput['region'],
      functionName,
      bucketName: started.bucketName,
      renderId: started.renderId,
      logLevel: logLevel as LambdaProgressInput['logLevel'],
    }
    if (options.outputDestination) {
      progressInput.s3OutputProvider = options.outputDestination.s3OutputProvider
      progressInput.forcePathStyle = options.outputDestination.s3OutputProvider.forcePathStyle
    }
    const progress = await retryTransient(
      () => withRemotionAwsCredentials(async () => {
        const { getRenderProgress } = await import('@remotion/lambda-client')
        return getRenderProgress({
          ...progressInput,
        })
      }),
      progressRetryAttempts,
      1000,
    )
    const pollEndMs = Date.now()
    pollDurationsMs.push(pollEndMs - pollStartMs)
    await options.onProgress?.({
      ...progress,
      progress: progressValue(progress),
      renderer: 'lambda',
      elapsedSeconds: (Date.now() - t0) / 1000,
      phase: progress.done ? 'completed' : 'polling',
      submitSeconds: (submitEndMs - submitStartMs) / 1000,
      pollCount: pollDurationsMs.length,
    })

    if (progress.fatalErrorEncountered || progress.errors.length > 0) {
      const messages = progress.errors.map((error) => error.message).join('; ')
      throw new Error(messages || 'Remotion Lambda render failed')
    }
    if (progress.done) {
      if (!progress.outputFile) throw new Error('Remotion Lambda completed without an outputFile')
      const doneMs = Date.now()
      const fontTelemetry = collectFontTimingArtifacts({
        progress,
        telemetryId: fontTelemetryId,
      })
      const timings = buildTimingSummary({
        startMs: t0,
        submitStartMs,
        submitEndMs,
        doneMs,
        pollDurationsMs,
        progress,
      })
      timings.fontTelemetry = fontTelemetry
      return {
        url: progress.outputFile,
        renderId: started.renderId,
        bucketName: started.bucketName,
        functionName,
        rendererFunctionName: rendererFunctionName || functionName,
        outputSizeInBytes: progress.outputSizeInBytes,
        videoBitrate: encoding.videoBitrate,
        audioBitrate,
        renderSeconds: timings.totalSeconds,
        timings,
        progress,
      }
    }
    await sleep(pollMs)
  }
}

export async function renderDesignVideoLambda(
  design: DesignPayload,
  options: {
    onProgress?: (progress: unknown) => void | Promise<void>
    scale?: number
  } = {},
): Promise<Buffer> {
  const rendered = await renderDesignVideoLambdaToUrl(design, options)
  return downloadOutput(rendered.url)
}
