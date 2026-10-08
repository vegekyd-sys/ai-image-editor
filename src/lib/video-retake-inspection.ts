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

function fingerprint(scope: RetakeInspectionScope): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex')
}

/** A receipt survives durable continuation, but cannot be reused for another source,
 * selection, model, owner, run, or newer instruction. It contains no credentials. */
export function signRetakeInspection(scope: RetakeInspectionScope, secret: string): string {
  if (!secret) throw new Error('Retake inspection signing is unavailable.')
  const value = `retake-v1.${fingerprint(scope)}`
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`
}

export function verifyRetakeInspection(receipt: string | undefined, scope: RetakeInspectionScope, secret: string): boolean {
  if (!receipt || !secret) return false
  const expected = Buffer.from(signRetakeInspection(scope, secret))
  const supplied = Buffer.from(receipt)
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

/** Include the selected action and both surrounding reference boundary states. */
export function retakeInspectionTimestamps(plan: RetakePlan, fps: number): number[] {
  if (!Number.isFinite(fps) || fps < 1) throw new Error('Retake inspection needs a measured frame rate.')
  const length = plan.end - plan.start
  const last = Math.max(plan.start, plan.end - 1 / fps)
  return [...new Set([
    plan.contextStart, plan.start, plan.start + length / 3,
    plan.start + length * 2 / 3, last, Math.max(plan.contextStart, plan.contextEnd - 1 / fps),
  ].map(value => Number(value.toFixed(3))))].sort((a, b) => a - b)
}

export function retakeOutputTime(plan: RetakePlan, sourceTime: number): number {
  return (sourceTime - plan.contextStart) * plan.generationDuration / (plan.contextEnd - plan.contextStart)
}

export function retakeInspectionScope(ctx: { userId?: string; projectId: string; execution?: { runId: string; inputEpoch: number }; agentRunId?: string }, sourceUrl: string, start: number, end: number, model: string): RetakeInspectionScope {
  return { userId: ctx.userId!, projectId: ctx.projectId, runId: ctx.execution?.runId || ctx.agentRunId || 'interactive',
    inputEpoch: ctx.execution?.inputEpoch || 0, sourceUrl, start, end, model };
}

