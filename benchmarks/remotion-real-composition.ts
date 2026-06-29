import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { DesignPayload } from '@/types'
import { prepareRemotionCodeForSandbox } from '@/lib/remotion-server'

dotenv.config({ path: '.env.local' })
if (process.env.MAKARON_ENV_FILE && process.env.MAKARON_ENV_FILE !== '.env.local') {
  dotenv.config({ path: process.env.MAKARON_ENV_FILE })
}

const DEFAULT_DESIGN_URL =
  'https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/code/9d456588-1c2c-4fcd-9021-5dd7f1c38397.json'

const designUrl = process.env.REMOTION_BENCHMARK_DESIGN_URL || DEFAULT_DESIGN_URL
const outputDir = process.env.BENCHMARK_OUTPUT_DIR || path.join(process.cwd(), 'outputs')
const scale = Number(process.env.REMOTION_BENCHMARK_SCALE || 0.75)
const concurrencyValue = process.env.REMOTION_BENCHMARK_CONCURRENCY || '100%'
const concurrency = /^\d+$/.test(concurrencyValue) ? Number(concurrencyValue) : concurrencyValue
const variant = process.env.REMOTION_BENCHMARK_VARIANT || 'original'
const skipFontLoading = process.env.REMOTION_BENCHMARK_SKIP_FONTS === '1'
const localLeft = process.env.REMOTION_BENCHMARK_LOCAL_LEFT
const localRight = process.env.REMOTION_BENCHMARK_LOCAL_RIGHT

function applyVariant(design: DesignPayload): DesignPayload {
  if (variant === 'muted-objectfit') {
    return {
      ...design,
      code: design.code
        .replace(/<Video(\s+)/g, '<Video muted objectFit="cover"$1')
        .replace(/,\s*objectFit:\s*['"]cover['"]/g, ''),
    }
  }

  if (variant === 'local-files') {
    if (!localLeft || !localRight) {
      throw new Error('local-files variant requires REMOTION_BENCHMARK_LOCAL_LEFT and REMOTION_BENCHMARK_LOCAL_RIGHT')
    }
    const urls = Array.from(design.code.matchAll(/src=["']([^"']+)["']/g)).map((m) => m[1])
    if (urls.length < 2) throw new Error('Expected at least two video src URLs in design code')
    const leftSrc = /^https?:\/\//.test(localLeft) ? localLeft : `file://${localLeft}`
    const rightSrc = /^https?:\/\//.test(localRight) ? localRight : `file://${localRight}`
    return {
      ...design,
      code: design.code
        .replace(urls[0], leftSrc)
        .replace(urls[1], rightSrc),
    }
  }

  return design
}

async function loadDesign(): Promise<DesignPayload> {
  const res = await fetch(designUrl)
  if (!res.ok) throw new Error(`Failed to fetch design ${designUrl}: ${res.status}`)
  return applyVariant(await res.json() as DesignPayload)
}

async function main() {
  mkdirSync(outputDir, { recursive: true })
  const design = await loadDesign()
  const fps = design.animation?.fps || 30
  const durationInSeconds = design.animation?.durationInSeconds || 1 / fps
  const durationInFrames = Math.max(1, Math.round(durationInSeconds * fps))
  const width = design.width || 1080
  const height = design.height || 1920
  const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx')
  const outName = `remotion-real-${variant}-c${String(concurrency).replace(/[^a-z0-9]/gi, '')}-${Date.now()}.mp4`
  const outputLocation = path.join(outputDir, outName)

  console.log(JSON.stringify({
    phase: 'start',
    variant,
    durationInSeconds,
    durationInFrames,
    fps,
    width,
    height,
    outputWidth: Math.round(width * scale),
    outputHeight: Math.round(height * scale),
    concurrency,
    skipFontLoading,
    designUrl,
  }, null, 2))

  const bundleStarted = Date.now()
  const serveUrl = await bundle({
    entryPoint,
    onProgress: () => {},
  })
  const bundleSeconds = (Date.now() - bundleStarted) / 1000

  const inputProps = {
    code: prepareRemotionCodeForSandbox(design.code),
    designProps: design.props,
    fps,
    durationInFrames,
    width,
    height,
    skipFontLoading,
  }

  const composition = await selectComposition({
    serveUrl,
    id: 'dynamic-design',
    inputProps,
  })

  const renderStarted = Date.now()
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    imageFormat: 'jpeg',
    scale,
    crf: 23,
    x264Preset: 'veryfast',
    concurrency,
    muted: true,
    enforceAudioTrack: false,
    onProgress: ({ progress }) => {
      process.stderr.write(`\rrender ${(progress * 100).toFixed(0)}%`)
    },
  })
  process.stderr.write('\n')
  const renderSeconds = (Date.now() - renderStarted) / 1000

  writeFileSync(
    path.join(outputDir, `remotion-real-${variant}-latest.json`),
    JSON.stringify({
      variant,
      durationInSeconds,
      durationInFrames,
      fps,
      width,
      height,
      scale,
      outputWidth: Math.round(width * scale),
      outputHeight: Math.round(height * scale),
      concurrency,
      skipFontLoading,
      bundleSeconds,
      renderSeconds,
      totalSeconds: bundleSeconds + renderSeconds,
      ratio: durationInSeconds / renderSeconds,
      outputLocation,
    }, null, 2),
  )

  console.log(JSON.stringify({
    phase: 'done',
    variant,
    bundleSeconds,
    renderSeconds,
    totalSeconds: bundleSeconds + renderSeconds,
    ratio: durationInSeconds / renderSeconds,
    outputLocation,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
