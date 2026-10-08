// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planRetake } from '@/lib/video-retake-contract'
import { retakePromptPlanning, retakeShotPlanError } from '@/lib/video-retake-prompt-planning'

describe('inspection-to-prompt timing budget', () => {
  it('makes the three-second example readable with three distinct shot slots', () => {
    const budget = retakePromptPlanning(planRetake({ start: 18, end: 21 }, 30.048, 'fal-h3-max'))
    expect(budget.outputSelection).toEqual({ start: 0, end: 5 })
    expect(budget.multiCameraTimingBudget.suggestedOutputSlots).toEqual([
      { start: 0, end: 1.667 }, { start: 1.667, end: 3.333 }, { start: 3.333, end: 5 },
    ])
  })
  it.each(['fal-h3-max', 'seedance-2.5'])('budgets only the selected output, with no gaps or out-of-range cuts (%s)', model => {
    for (const range of [{ start: 0, end: .1 }, { start: 17.48, end: 23 }, { start: 0, end: 15 }, { start: 29, end: 30.048 }]) {
      const budget = retakePromptPlanning(planRetake(range, 30.048, model))
      const slots = budget.multiCameraTimingBudget.suggestedOutputSlots
      expect(slots.length).toBeGreaterThanOrEqual(1)
      expect(slots.length).toBeLessThanOrEqual(5)
      expect(slots[0].start).toBeCloseTo(budget.outputSelection.start, 3)
      expect(slots.at(-1)!.end).toBeCloseTo(budget.outputSelection.end, 3)
      slots.forEach((slot, index) => {
        expect(slot.end).toBeGreaterThan(slot.start)
        if (index) expect(slot.start).toBe(slots[index - 1].end)
      })
    }
  })
  it('allows persistent content edits and ordinary numbers that are not shot times', () => {
    expect(retakeShotPlanError([{ start: 1, end: 4, instruction: 'add a small character beside the board throughout' }],
      'Add one small character, 3D animation, a high three-quarter angle. From 1–4s keep it visible.', { start: 1, end: 4 })).toBeNull()
  })
  it('accepts valid Chinese output-time beats', () => {
    const slots = [{ start: 1, end: 2, instruction: '近景' }, { start: 2, end: 4, instruction: '俯拍' }]
    expect(retakeShotPlanError(slots, '输出1–2秒：近景；输出2秒处硬切，输出2–4秒：俯拍。', { start: 1, end: 4 })).toBeNull()
  })
})
