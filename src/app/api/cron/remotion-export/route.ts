import { NextRequest, NextResponse } from 'next/server'
import { drainRemotionExportQueue } from '@/lib/remotion-export'

export const maxDuration = 1800

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : fallback
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lanes = positiveInteger(process.env.REMOTION_EXPORT_CRON_LANES, 6)
  const summaries = await Promise.all(
    Array.from({ length: lanes }, (_, index) => drainRemotionExportQueue({
      source: `cron/remotion-export:${index + 1}`,
    })),
  )

  return NextResponse.json({
    lanes,
    processed: summaries.reduce((total, summary) => total + summary.processed, 0),
    completed: summaries.reduce((total, summary) => total + summary.completed, 0),
    failed: summaries.reduce((total, summary) => total + summary.failed, 0),
    errors: summaries.flatMap((summary) => summary.errors),
  })
}
