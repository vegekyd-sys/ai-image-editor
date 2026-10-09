// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planRetake } from '@/lib/video-retake-contract'
import { bindRetakeReferences } from '@/lib/video-retake-references'
import { retakePromptPlanning, retakeShotPlanError } from '@/lib/video-retake-prompt-planning'

describe('scene-neutral inspection timing', () => {
  it('does not let a timed plan disappear from the actual provider instruction',()=>{
    const beats=[{start:.2,end:1.2,instruction:'Turn toward camera'},{start:1.2,end:4,instruction:'Speak after turning'}];
    const selection={start:.2,end:4};
    expect(retakeShotPlanError(beats,'Turn toward camera, then speak. Output .2–4 seconds.',selection)).toContain('provider receives prompt');
    expect(retakeShotPlanError(beats,'Output 0.2–1.2 seconds: turn toward camera. Output 1.2–4 seconds: speak after turning.',selection)).toBeNull();
    expect(retakeShotPlanError(beats,'Source 0.2–1.2 seconds: profile. Output 1.2–4 seconds: speak.',selection)).toContain('provider receives prompt');
  });
  it('distinguishes inspected source joins from output beats before billing',()=>{
    const beats=[{start:0,end:5,instruction:'A new medium shot throughout'}];
    expect(retakeShotPlanError(beats,'Keep medium framing; cut naturally to the following source shot at 6.0s.',{start:0,end:5})).toBeNull();
    expect(retakeShotPlanError(beats,"Match the adjacent source's side-profile shot at 6 seconds.",{start:0,end:5})).toBeNull();
    expect(retakeShotPlanError(beats,'Source 3–6s is an overhead shot. Output 0–5s is a medium shot.',{start:0,end:5})).toBeNull();
    expect(retakeShotPlanError(beats,'After viewing the original, cut at output 6s.',{start:0,end:5})).not.toBeNull();
    expect(retakeShotPlanError(beats,'At 6s change to a new view.',{start:0,end:5})).not.toBeNull();
  });
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

it('binds the cropped source motion beside a content control, not beside a changed camera',()=>{
  const input={prompt:'Continue <<<media_1>>> while showing <<<media_3>>> at the middle.',model:'fal-h3-max' as const,sourceIndex:1,referenceIndices:[],middleIndex:3};
  expect(bindRetakeReferences(input)).toBe('Continue Video 1 while showing Image 3 at the middle.');
  expect(bindRetakeReferences({...input,cameraChange:true})).toContain('inspected original scene');
});
