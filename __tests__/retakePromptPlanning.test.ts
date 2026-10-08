// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planRetake } from '@/lib/video-retake-contract'
import { retakePromptPlanning } from '@/lib/video-retake-prompt-planning'

describe('inspection-to-prompt timing budget', () => {
  it('makes the three-second example readable with three distinct shot slots', () => {
    const budget = retakePromptPlanning(planRetake({ start: 18, end: 21 }, 30.048, 'fal-h3-max'))
    expect(budget.outputSelection).toEqual({ start: 1, end: 4 })
    expect(budget.multiCameraTimingBudget.suggestedOutputSlots).toEqual([
      { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 4 },
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
})
