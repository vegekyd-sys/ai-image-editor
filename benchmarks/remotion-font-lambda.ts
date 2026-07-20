import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { config as loadEnv } from 'dotenv'

import { FONT_PARITY_DESIGN } from './remotion-font-fixture'
import { renderDesignVideoLambdaToUrl } from '@/lib/remotion-lambda-renderer'

loadEnv({ path: path.resolve(process.cwd(), '.env.local'), quiet: true })

async function main(): Promise<void> {
  const outputBase = process.env.REMOTION_FONT_LAMBDA_OUTPUT || '/tmp/remotion-font-lambda.mp4'
  const skipFontLoading = process.env.REMOTION_FONT_LAMBDA_SKIP_FONTS === '1'
  const runs = Math.max(1, Number(process.env.REMOTION_FONT_LAMBDA_RUNS || 1))

  for (let run = 1; run <= runs; run++) {
    const output = runs === 1
      ? outputBase
      : outputBase.replace(/(\.[^.]+)$/, `-run${run}$1`)
    let lastPercent = -10
    const result = await renderDesignVideoLambdaToUrl(FONT_PARITY_DESIGN, {
      scale: 1,
      skipFontLoading,
      onProgress: (progress) => {
        const value = typeof progress === 'object' && progress !== null && 'progress' in progress
          ? Number((progress as { progress?: number }).progress || 0)
          : 0
        const percent = Math.floor(value * 10) * 10
        if (percent > lastPercent) {
          lastPercent = percent
          console.log(`[remotion-font-lambda] run ${run} ${percent}%`)
        }
      },
    })

    const response = await fetch(result.url)
    if (!response.ok) throw new Error(`Lambda output download failed: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(output, buffer)

    console.log(JSON.stringify({
      run,
      output,
      bytes: buffer.length,
      renderId: result.renderId,
      skipFontLoading,
      renderSeconds: result.renderSeconds,
      timings: result.timings,
    }, null, 2))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
