// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { signRetakeInspection, verifyRetakeInspection, retakeInspectionTimestamps, retakeOutputTime, type RetakeInspectionScope } from '@/lib/video-retake-inspection'
import { planRetake } from '@/lib/video-retake-contract'

const scope: RetakeInspectionScope = { userId: 'owner', projectId: 'project', runId: 'run', inputEpoch: 2,
  sourceUrl: 'https://example.com/original.mp4', start: 18, end: 21, model: 'fal-h3-max' }
const secret = 'test-server-secret'

describe('Retake inspection evidence', () => {
  it('accepts the exact inspected selection across durable attempts', () => {
    const receipt = signRetakeInspection(scope, secret)
    expect(verifyRetakeInspection(receipt, { ...scope }, secret)).toBe(true)
    expect(receipt).not.toContain(secret)
    expect(receipt).not.toContain(scope.sourceUrl)
  })
  it.each([
    { userId: 'other' }, { projectId: 'other' }, { runId: 'other' }, { inputEpoch: 3 },
    { sourceUrl: 'https://example.com/changed.mp4' }, { start: 19 }, { end: 22 }, { model: 'seedance-2.5' },
  ])('rejects evidence reused with different scope %j', change => {
    expect(verifyRetakeInspection(signRetakeInspection(scope, secret), { ...scope, ...change }, secret)).toBe(false)
  })
  it('rejects missing, fabricated and damaged receipts', () => {
    expect(verifyRetakeInspection(undefined, scope, secret)).toBe(false)
    expect(verifyRetakeInspection('I looked at the frames', scope, secret)).toBe(false)
    const receipt = signRetakeInspection(scope, secret)
    expect(verifyRetakeInspection(receipt.slice(0, -1) + '!', scope, secret)).toBe(false)
    expect(verifyRetakeInspection(receipt, scope, '')).toBe(false)
    expect(() => signRetakeInspection(scope, '')).toThrow(/unavailable/)
  })
  it('covers the selected action and contextual boundaries in original time', () => {
    const plan = planRetake({ start: 18, end: 21 }, 30.048, 'fal-h3-max')
    expect(retakeInspectionTimestamps(plan, 24)).toEqual([17, 18, 19, 20, 20.958, 21.958])
    expect(retakeOutputTime(plan, 18)).toBe(1)
    expect(retakeOutputTime(plan, 21)).toBe(4)
    expect(retakeOutputTime(plan, 17)).toBe(0)
  })
  it('handles minimum selections and scaled output without seeking past video end', () => {
    const plan = planRetake({ start: 9.9, end: 10 }, 10, 'fal-h3-max')
    const times = retakeInspectionTimestamps(plan, 24)
    expect(times).toContain(9.9)
    expect(times.every(t => t >= 0 && t < 10)).toBe(true)
    const scaled = planRetake({ start: 17.48, end: 23 }, 30.048, 'fal-h3-max')
    expect(retakeOutputTime(scaled, 23)).toBeCloseTo(6)
  })
})
