import dotenv from 'dotenv'
import {
  checkRemotionExportQueueReady,
  runNextRemotionExportJob,
} from '../src/lib/remotion-export'

dotenv.config({ path: '.env.local' })
if (process.env.MAKARON_ENV_FILE && process.env.MAKARON_ENV_FILE !== '.env.local') {
  dotenv.config({ path: process.env.MAKARON_ENV_FILE })
}
dotenv.config({ path: '.env' })

const pollMs = Number(process.env.REMOTION_EXPORT_WORKER_POLL_MS || 3000)
const concurrency = Math.max(1, Number(process.env.REMOTION_EXPORT_WORKER_CONCURRENCY || 1))
const once = process.argv.includes('--once') || process.env.REMOTION_EXPORT_WORKER_ONCE === 'true'
const checkOnly = process.argv.includes('--check') || process.env.REMOTION_EXPORT_WORKER_CHECK === 'true'

let stopping = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatRatio(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'n/a'
}

async function drainQueue() {
  let processed = 0
  const slots = Array.from({ length: concurrency }, async () => {
    while (!stopping) {
      const result = await runNextRemotionExportJob()
      if (!result) return
      processed += 1
      const job = result.job
      console.log(JSON.stringify({
        event: 'remotion_export_completed',
        jobId: job.id,
        projectId: job.project_id,
        url: job.storage_url,
        durationSeconds: job.duration_seconds,
        renderSeconds: job.render_seconds,
        realtimeRatio: job.realtime_ratio,
        ratio: `${formatRatio(job.realtime_ratio)}:1`,
      }))
    }
  })
  await Promise.all(slots)
  return processed
}

async function main() {
  process.on('SIGINT', () => { stopping = true })
  process.on('SIGTERM', () => { stopping = true })

  if (checkOnly) {
    const readiness = await checkRemotionExportQueueReady()
    console.log(JSON.stringify({
      event: readiness.ready ? 'remotion_export_worker_ready' : 'remotion_export_worker_not_ready',
      ready: readiness.ready,
      error: readiness.error,
    }))
    if (!readiness.ready) process.exit(1)
    return
  }

  console.log(JSON.stringify({
    event: 'remotion_export_worker_started',
    pollMs,
    concurrency,
    once,
    workerId: process.env.REMOTION_EXPORT_WORKER_ID || `pid-${process.pid}`,
  }))

  while (!stopping) {
    try {
      const processed = await drainQueue()
      if (once) break
      if (processed === 0) await sleep(pollMs)
    } catch (err) {
      console.error(JSON.stringify({
        event: 'remotion_export_worker_error',
        error: err instanceof Error ? err.message : String(err),
      }))
      if (once) throw err
      await sleep(pollMs)
    }
  }

  console.log(JSON.stringify({ event: 'remotion_export_worker_stopped' }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
