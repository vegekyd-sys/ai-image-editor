import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { RetakePlan } from './video-retake-contract'

export interface RetakeInspectionScope {
  userId: string
  projectId: string
  runId: string
  inputEpoch: number
  sourceUrl: string
  start: number
  end: number
  model: string
}

export interface RetakeInspectionClock {
  outputSelection: { start: number; end: number }
  generationDuration: number
}

function fingerprint(scope: RetakeInspectionScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex')
}

/** A receipt survives durable continuation, but cannot be reused for another source,
 * selection, model, owner, run, or newer instruction. It contains no credentials. */
export function signRetakeInspection(scope: RetakeInspectionScope, secret: string, clock?: RetakeInspectionClock): string {
  if (!secret) throw new Error('Retake inspection signing is unavailable.')
  const value = clock
    ? `retake-v2.${fingerprint(scope)}.${Buffer.from(JSON.stringify(clock)).toString('base64url')}`
    : `retake-v1.${fingerprint(scope)}`
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`
}

export function verifyRetakeInspection(receipt: string | undefined, scope: RetakeInspectionScope, secret: string): boolean {
  if (!receipt || !secret) return false
  if (receipt.startsWith('retake-v2.')) return !!readRetakeInspectionClock(receipt, scope, secret)
  const expected = Buffer.from(signRetakeInspection(scope, secret))
  const supplied = Buffer.from(receipt)
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

/** Verify the measured output clock before trusting any Agent-proposed shot times. */
export function readRetakeInspectionClock(receipt: string | undefined, scope: RetakeInspectionScope, secret: string): RetakeInspectionClock | null {
  if (!receipt || !secret) return null
  const parts = receipt.split('.')
  if (parts.length !== 4 || parts[0] !== 'retake-v2' || parts[1] !== fingerprint(scope)) return null
  const expected = Buffer.from(createHmac('sha256', secret).update(parts.slice(0, 3).join('.')).digest('base64url'))
  const supplied = Buffer.from(parts[3])
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const clock = JSON.parse(Buffer.from(parts[2], 'base64url').toString()) as RetakeInspectionClock
    const { start, end } = clock.outputSelection
    if (![start, end, clock.generationDuration].every(Number.isFinite) || start < 0 || end <= start || end > clock.generationDuration) return null
    return clock
  } catch { return null }
}

/** Include the selected action and both surrounding reference boundary states. */
export function retakeInspectionTimestamps(plan: RetakePlan, fps: number): number[] {
  if (!Number.isFinite(fps) || fps < 1) throw new Error('Retake inspection needs a measured frame rate.')
  const length = plan.end - plan.start
  const last = Math.max(plan.start, plan.end - 1 / fps)
  const selectedSamples = Math.min(6, Math.max(2, Math.floor(length * fps)))
  return [...new Set([
    Math.max(0, plan.start - 1 / fps),
    ...Array.from({ length: selectedSamples }, (_, index) => index === selectedSamples - 1
      ? last : plan.start + length * index / (selectedSamples - 1)),
    Math.min(plan.sourceDuration - 1 / fps, plan.end),
  ].map(value => Number(value.toFixed(3))))].sort((a, b) => a - b)
}

export function retakeOutputTime(plan: RetakePlan, sourceTime: number): number {
  const start = plan.outputMode === 'selection' ? plan.start : plan.contextStart
  const end = plan.outputMode === 'selection' ? plan.end : plan.contextEnd
  return (sourceTime - start) * plan.generationDuration / (end - start)
}

export function retakeInspectionScope(ctx: { userId?: string; projectId: string; execution?: { runId: string; inputEpoch: number }; agentRunId?: string }, sourceUrl: string, start: number, end: number, model: string): RetakeInspectionScope {
  return { userId: ctx.userId!, projectId: ctx.projectId, runId: ctx.execution?.runId || ctx.agentRunId || 'interactive',
    inputEpoch: ctx.execution?.inputEpoch || 0, sourceUrl, start, end, model };
}

/** Keep long signed receipts server-side; models pass a familiar short UUID ID.
 * The stored receipt still verifies owner/project/run/epoch/source/range/model. */
export async function resolveRetakeInspectionReceipt(id: string | undefined, ctx: {projectId:string;userId?:string;supabase?:any}): Promise<string | undefined> {
  if (!id?.startsWith('retake-evidence.')) return id
  const key = id.slice('retake-evidence.'.length)
  if (!ctx.userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) return undefined
  const {readFile} = await import('./workspace')
  const result = await readFile(`${ctx.projectId}/drafts/retake-inspection-${key}.json`,ctx.supabase,ctx.userId)
  try { return result ? JSON.parse(result.content).receipt : undefined } catch { return undefined }
}
