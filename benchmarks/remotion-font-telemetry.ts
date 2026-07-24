import path from 'node:path'

import { config as loadEnv } from 'dotenv'

import { renderDesignVideoLambdaToUrl } from '@/lib/remotion-lambda-renderer'
import type { DesignPayload } from '@/types'

loadEnv({ path: path.resolve(process.cwd(), '.env.local'), quiet: true })

const syntheticDesign: DesignPayload = {
  width: 720,
  height: 720,
  animation: { fps: 30, durationInSeconds: 1 },
  props: {},
  code: `
function Composition() {
  return (
    <AbsoluteFill style={{backgroundColor: '#10251f', color: '#fff', padding: 64}}>
      <div style={{fontFamily: 'ZCOOL KuaiLe', fontSize: 84}}>中文字体计时</div>
      <div style={{fontFamily: 'Inter', fontSize: 52, fontWeight: 900, marginTop: 36}}>
        FONT TELEMETRY
      </div>
      <div style={{fontFamily: 'Noto Sans SC', fontSize: 34, fontWeight: 700, marginTop: 28}}>
        Manifest · WOFF2 · fonts.ready
      </div>
    </AbsoluteFill>
  );
}
`,
}

async function loadDesign(): Promise<{ design: DesignPayload; source: string }> {
  const designUrl = process.env.REMOTION_FONT_BENCHMARK_DESIGN_URL
  if (!designUrl) return { design: syntheticDesign, source: 'synthetic' }
  const response = await fetch(designUrl)
  if (!response.ok) throw new Error(`Failed to load benchmark design: ${response.status}`)
  return { design: await response.json() as DesignPayload, source: designUrl }
}

async function main() {
  const { design, source } = await loadDesign()
  const result = await renderDesignVideoLambdaToUrl(design)
  console.log(JSON.stringify({
    source,
    durationInSeconds: design.animation?.durationInSeconds || null,
    width: design.width,
    height: design.height,
    renderId: result.renderId,
    outputUrl: result.url,
    renderSeconds: result.renderSeconds,
    lambda: {
      totalSeconds: result.timings.totalSeconds,
      submitSeconds: result.timings.submitSeconds,
      timeToRenderFramesMs: result.timings.timeToRenderFramesMs,
      timeToEncodeMs: result.timings.timeToEncodeMs,
      fontTelemetry: result.timings.fontTelemetry,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
