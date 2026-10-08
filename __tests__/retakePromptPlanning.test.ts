// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planRetake } from '@/lib/video-retake-contract'
import { retakePromptPlanning, retakeShotPlanError } from '@/lib/video-retake-prompt-planning'

describe('scene-neutral inspection timing', () => {
  it.each(['fal-h3-max', 'seedance-2.5'])('provides a measured clock without prescribing an edit structure (%s)', model => {
    for (const range of [{ start: 0, end: .1 }, { start: 17.48, end: 23 }, { start: 0, end: 15 }, { start: 29, end: 30.048 }]) {
      const plan = planRetake(range, 30.048, model)
      const timing = retakePromptPlanning(plan)
      expect(timing.selectedSourceSeconds).toEqual(range)
      expect(timing.outputSelection.end).toBeGreaterThan(timing.outputSelection.start)
      expect(timing.outputSelection.end).toBeLessThanOrEqual(plan.generationDuration)
      expect(timing).not.toHaveProperty('multiCameraTimingBudget')
      expect(retakeShotPlanError([{...timing.outputSelection,instruction:'Keep the requested change visible continuously'}],
        'Apply the scene-informed change throughout the selected interval.',timing.outputSelection)).toBeNull()
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
