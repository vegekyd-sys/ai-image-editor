// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { signRetakeInspection, verifyRetakeInspection, readRetakeInspectionClock, resolveRetakeInspectionReceipt, retakeInspectionTimestamps, retakeOutputTime, type RetakeInspectionScope } from '@/lib/video-retake-inspection'
import { planRetake } from '@/lib/video-retake-contract'

const readProof = vi.hoisted(()=>vi.fn());
vi.mock('@/lib/workspace',()=>({readFile:readProof}));
beforeEach(()=>readProof.mockReset());

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
  it('authenticates the measured output clock and rejects a changed selection or clock', () => {
    const clock = { outputSelection: { start: 1, end: 4 }, generationDuration: 5 }
    const receipt = signRetakeInspection(scope, secret, clock)
    expect(readRetakeInspectionClock(receipt, scope, secret)).toEqual(clock)
    expect(verifyRetakeInspection(receipt, scope, secret)).toBe(true)
    expect(readRetakeInspectionClock(receipt, { ...scope, start: 19 }, secret)).toBeNull()
    const parts = receipt.split('.')
    parts[2] = Buffer.from(JSON.stringify({ ...clock, outputSelection: { start: 0, end: 3 } })).toString('base64url')
    expect(readRetakeInspectionClock(parts.join('.'), scope, secret)).toBeNull()
    expect(readRetakeInspectionClock(signRetakeInspection(scope, secret), scope, secret)).toBeNull()
  })
  it('resolves a durable short ID while retaining all signed scope checks', async()=>{
    const id='retake-evidence.11111111-2222-4333-a444-555555555555';
    const receipt=signRetakeInspection(scope,secret,{outputSelection:{start:0,end:5},generationDuration:5});
    const ctx={userId:'owner',projectId:'project',supabase:{}};
    readProof.mockResolvedValue({content:JSON.stringify({receipt})});
    const resolved=await resolveRetakeInspectionReceipt(id,ctx);
    expect(readProof).toHaveBeenCalledWith('project/drafts/retake-inspection-11111111-2222-4333-a444-555555555555.json',ctx.supabase,'owner');
    expect(verifyRetakeInspection(resolved,scope,secret)).toBe(true);
    expect(verifyRetakeInspection(resolved,{...scope,runId:'other'},secret)).toBe(false);
  });
  it('rejects malformed, absent and damaged short-ID proofs without trusting the pointer', async()=>{
    const ctx={userId:'owner',projectId:'project',supabase:{}};
    expect(await resolveRetakeInspectionReceipt('retake-evidence.../other.json',ctx)).toBeUndefined();
    expect(readProof).not.toHaveBeenCalled();
    readProof.mockResolvedValue(null);
    expect(await resolveRetakeInspectionReceipt('retake-evidence.11111111-2222-4333-a444-555555555555',ctx)).toBeUndefined();
    readProof.mockResolvedValue({content:'not-json'});
    expect(await resolveRetakeInspectionReceipt('retake-evidence.11111111-2222-4333-a444-555555555555',ctx)).toBeUndefined();
  });
  it('covers the selected action and contextual boundaries in original time', () => {
    const plan = planRetake({ start: 18, end: 21 }, 30.048, 'fal-h3-max')
    expect(retakeInspectionTimestamps(plan, 24)).toEqual([17.958, 18, 18.6, 19.2, 19.8, 20.4, 20.958, 21])
    expect(retakeOutputTime(plan, 18)).toBe(0)
    expect(retakeOutputTime(plan, 21)).toBe(5)
    expect(retakeOutputTime({ ...plan, outputMode: undefined, patchOffset: 1 }, 17)).toBe(0)
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
