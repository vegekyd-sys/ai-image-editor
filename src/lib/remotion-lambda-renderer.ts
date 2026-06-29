import { getRenderProgress, renderMediaOnLambda } from '@remotion/lambda-client'
import type { DesignPayload } from '@/types'
import { hasRemotionAudioSources } from '@/lib/remotion-audio'
import { resolveRemotionLambdaEncodingSettings } from '@/lib/remotion-encoding'
import { prepareRemotionCodeForSandbox } from '@/lib/remotion-server'

type LambdaRenderProgress = Awaited<ReturnType<typeof getRenderProgress>>
type LambdaRenderInput = Parameters<typeof renderMediaOnLambda>[0]
type LambdaProgressInput = Parameters<typeof getRenderProgress>[0]

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

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  return Math.max(1, Math.round(readPositiveNumber(value, fallback)))
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]
  return value === '1' || value === 'true'
}

function readX264Preset(): Parameters<typeof renderMediaOnLambda>[0]['x264Preset'] {
  const value = process.env.REMOTION_LAMBDA_X264_PRESET || 'ultrafast'
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
  return value as Parameters<typeof renderMediaOnLambda>[0]['x264Preset']
}

function lambdaEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required when REMOTION_RENDERER=lambda`)
  return value
}

function readRemotionAwsCredentials():
  | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | null {
  const accessKeyId = process.env.REMOTION_AWS_ACCESS_KEY_ID || process.env.REMOTION_AWS_ACCESS_KEY
  const secretAccessKey = process.env.REMOTION_AWS_SECRET_ACCESS_KEY || process.env.REMOTION_AWS_SECRET_KEY
  if (!accessKeyId || !secretAccessKey) return null
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.REMOTION_AWS_SESSION_TOKEN,
  }
}

async function withRemotionAwsCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const credentials = readRemotionAwsCredentials()
  if (!credentials) return fn()

  const previous = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
  }
  process.env.AWS_ACCESS_KEY_ID = credentials.accessKeyId
  process.env.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey
  if (credentials.sessionToken) {
    process.env.AWS_SESSION_TOKEN = credentials.sessionToken
  } else {
    delete process.env.AWS_SESSION_TOKEN
  }
  try {
    return await fn()
  } finally {
    if (previous.AWS_ACCESS_KEY_ID === undefined) delete process.env.AWS_ACCESS_KEY_ID
    else process.env.AWS_ACCESS_KEY_ID = previous.AWS_ACCESS_KEY_ID
    if (previous.AWS_SECRET_ACCESS_KEY === undefined) delete process.env.AWS_SECRET_ACCESS_KEY
    else process.env.AWS_SECRET_ACCESS_KEY = previous.AWS_SECRET_ACCESS_KEY
    if (previous.AWS_SESSION_TOKEN === undefined) delete process.env.AWS_SESSION_TOKEN
    else process.env.AWS_SESSION_TOKEN = previous.AWS_SESSION_TOKEN
  }
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
  const region = process.env.REMOTION_LAMBDA_REGION || process.env.AWS_REGION || 'us-east-1'
  const functionName = lambdaEnv('REMOTION_LAMBDA_FUNCTION_NAME')
  const rendererFunctionName = process.env.REMOTION_LAMBDA_RENDERER_FUNCTION_NAME || undefined
  const serveUrl = lambdaEnv('REMOTION_LAMBDA_SERVE_URL')
  const fps = design.animation?.fps || 30
  const dur = design.animation?.durationInSeconds || 1 / fps
  const durationInFrames = Math.max(1, Math.round(fps * dur))
  const scale = Number.isFinite(options.scale) && options.scale && options.scale > 0 ? options.scale : 1
  const useLegacyConcurrency = readBooleanEnv('REMOTION_LAMBDA_USE_CONCURRENCY')
  const concurrency = useLegacyConcurrency && process.env.REMOTION_LAMBDA_CONCURRENCY
    ? readPositiveInteger(process.env.REMOTION_LAMBDA_CONCURRENCY, 10)
    : undefined
  const framesPerLambda = concurrency
    ? undefined
    : readPositiveInteger(process.env.REMOTION_LAMBDA_FRAMES_PER_LAMBDA, 20)
  const pollMs = readPositiveInteger(process.env.REMOTION_LAMBDA_POLL_MS, 1000)
  const x264Preset = readX264Preset()
  const jpegQuality = readPositiveInteger(process.env.REMOTION_LAMBDA_JPEG_QUALITY, 80)
  const deleteAfter = process.env.REMOTION_LAMBDA_DELETE_AFTER || null
  const useOffthreadVideo = process.env.REMOTION_LAMBDA_USE_OFFTHREAD_VIDEO === 'true'
  const logLevel = process.env.REMOTION_LAMBDA_LOG_LEVEL || 'warn'
  const timeoutInMilliseconds = readPositiveInteger(process.env.REMOTION_LAMBDA_TIMEOUT_MS, 120000)
  const progressRetryAttempts = readPositiveInteger(process.env.REMOTION_LAMBDA_PROGRESS_RETRIES, 3)
  const preparedCode = prepareRemotionCodeForSandbox(design.code)
  const hasAudioSources = hasRemotionAudioSources(design.code)
  const encoding = resolveRemotionLambdaEncodingSettings()
  const audioBitrate = hasAudioSources ? encoding.audioBitrate : null
  const crf = encoding.videoBitrate ? undefined : readPositiveNumber(process.env.REMOTION_LAMBDA_CRF, 23)
  const t0 = Date.now()
  const submitStartMs = Date.now()

  const started = await withRemotionAwsCredentials(() => renderMediaOnLambda({
    region: region as Parameters<typeof renderMediaOnLambda>[0]['region'],
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
      skipFontLoading: true,
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
    concurrencyPerLambda: readPositiveInteger(process.env.REMOTION_LAMBDA_CONCURRENCY_PER_LAMBDA, 1),
    chromiumOptions: { disableWebSecurity: true, gl: null },
    muted: !hasAudioSources,
    audioCodec: hasAudioSources ? 'aac' : null,
    jpegQuality,
    maxRetries: readPositiveInteger(process.env.REMOTION_LAMBDA_MAX_RETRIES, 1),
    timeoutInMilliseconds,
    logLevel: logLevel as Parameters<typeof renderMediaOnLambda>[0]['logLevel'],
    deleteAfter: deleteAfter as Parameters<typeof renderMediaOnLambda>[0]['deleteAfter'],
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
  }))
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
      region: region as Parameters<typeof getRenderProgress>[0]['region'],
      functionName,
      bucketName: started.bucketName,
      renderId: started.renderId,
      logLevel: logLevel as Parameters<typeof getRenderProgress>[0]['logLevel'],
    }
    if (options.outputDestination) {
      progressInput.s3OutputProvider = options.outputDestination.s3OutputProvider
      progressInput.forcePathStyle = options.outputDestination.s3OutputProvider.forcePathStyle
    }
    const progress = await retryTransient(
      () => withRemotionAwsCredentials(() => getRenderProgress({
        ...progressInput,
      })),
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
      const timings = buildTimingSummary({
        startMs: t0,
        submitStartMs,
        submitEndMs,
        doneMs,
        pollDurationsMs,
        progress,
      })
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
