import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { renderDesignVideo } from '@/lib/remotion-server'
import type { DesignPayload } from '@/types'

dotenv.config({ path: '.env.local' })
if (process.env.MAKARON_ENV_FILE && process.env.MAKARON_ENV_FILE !== '.env.local') {
  dotenv.config({ path: process.env.MAKARON_ENV_FILE })
}

const durationInSeconds = Number(process.env.BENCHMARK_DURATION || 5)
const fps = Number(process.env.BENCHMARK_FPS || 30)
const width = Number(process.env.BENCHMARK_WIDTH || 720)
const height = Number(process.env.BENCHMARK_HEIGHT || 1280)
const outputDir = process.env.BENCHMARK_OUTPUT_DIR || path.join(process.cwd(), 'outputs')
const rounds = Number(process.env.BENCHMARK_ROUNDS || 2)

const design: DesignPayload = {
  width,
  height,
  animation: { fps, durationInSeconds },
  props: {
    title: 'Makaron Export',
    subtitle: 'server-side Remotion worker',
  },
  code: `
function Composition(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const progress = frame / Math.max(1, durationInFrames - 1);
  const y = interpolate(progress, [0, 1], [80, -80]);
  const scale = 1 + Math.sin(progress * Math.PI * 2) * 0.04;
  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(135deg, #111827 0%, #155e75 52%, #f8fafc 100%)',
      color: 'white',
      fontFamily: 'Inter, Arial, sans-serif',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        inset: 40,
        border: '2px solid rgba(255,255,255,0.35)',
      }} />
      <div style={{
        position: 'absolute',
        left: 64,
        right: 64,
        top: 250 + y,
        transform: 'scale(' + scale + ')',
      }}>
        <div data-editable="title" style={{
          fontSize: 74,
          lineHeight: 1,
          fontWeight: 800,
          letterSpacing: 0,
        }}>
          {props.title}
        </div>
        <div data-editable="subtitle" style={{
          marginTop: 28,
          fontSize: 34,
          lineHeight: 1.2,
          color: 'rgba(255,255,255,0.82)',
        }}>
          {props.subtitle}
        </div>
      </div>
      <div style={{
        position: 'absolute',
        left: 64,
        bottom: 90,
        width: ${width - 128} * progress,
        height: 16,
        background: '#f97316',
      }} />
      <div style={{
        position: 'absolute',
        right: 64,
        bottom: 126,
        fontSize: 28,
        color: 'rgba(255,255,255,0.76)',
      }}>
        {Math.floor(frame / fps)}s / ${durationInSeconds}s
      </div>
    </AbsoluteFill>
  );
}
`,
}

mkdirSync(outputDir, { recursive: true })

const results: Array<{
  round: number
  renderSeconds: number
  ratio: number
  bytes: number
  outputPath: string
}> = []

async function main() {
  for (let i = 0; i < rounds; i++) {
    const started = Date.now()
    const buffer = await renderDesignVideo(design, {
      onProgress: (progress) => {
        const p = progress && typeof progress === 'object' && 'overallProgress' in progress
          ? Number((progress as { overallProgress?: number }).overallProgress)
          : NaN
        if (Number.isFinite(p)) process.stderr.write(`\rround ${i + 1}/${rounds}: ${(p * 100).toFixed(0)}%`)
      },
    })
    const renderSeconds = (Date.now() - started) / 1000
    const ratio = durationInSeconds / renderSeconds
    const outputPath = path.join(outputDir, `remotion-export-benchmark-r${i + 1}.mp4`)
    writeFileSync(outputPath, buffer)
    process.stderr.write('\n')
    results.push({ round: i + 1, renderSeconds, ratio, bytes: buffer.length, outputPath })
  }

  console.log(JSON.stringify({
    durationSeconds: durationInSeconds,
    fps,
    width,
    height,
    results,
    bestRatio: Math.max(...results.map(r => r.ratio)),
    warmRatio: results.at(-1)?.ratio,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
