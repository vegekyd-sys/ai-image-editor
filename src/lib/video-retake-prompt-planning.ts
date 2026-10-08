import type { RetakePlan } from './video-retake-contract'
import { retakeOutputTime } from './video-retake-inspection'

/** Guidance goes to the inspecting Agent, never appended to a provider prompt. */
export const RETAKE_SCENE_READING = `Read these actual frames in timestamp order. Labels are #frame SOURCE seconds : OUTPUT seconds; rows are chronological, left to right then top to bottom.
Report visible subject identity, scene, and existing shot sizes/view directions. Track action at selected opening, middle, and closing: pose, airborne/grounded state, board contact, travel direction, occlusion, and existing cuts. Distinguish the selected interval from surrounding context; do not infer a landing, takeoff, or unseen camera angle from the user's request. State uncertainty when sampled frames do not establish motion.
Separate (1) observed facts, (2) the requested visual change, and (3) the identity/action facts to retain. Do not write the replacement script until the facts have been read.`

export const RETAKE_PROMPT_WRITING = `Expand the user's brief into a concise, concrete final generation prompt AFTER viewing the evidence.
Lead with the requested visible change; then give the output-time beats, then only the essential identity/action constraints. Keep the long source observation in source_observation, not in the generation prompt. Use output-local seconds only; do not put the source video's absolute timestamps in the provider prompt.
For a camera-change request, explicitly authorize NEW shot coverage: the reference supplies subject identity, environment and action phase, not its camera framing or continuous shot. Describe camera position/view direction AND shot size for each setup, with an explicit HARD CUT and time at each transition. A zoom, crop, pan or small camera drift within the original shot does not fulfill multi-camera editing. Choose a few substantially distinct views with enough screen time to read them; the suggested slots are a timing budget, not a forced template. Keep the same action progressing across cuts. Do not restart takeoff or invent a landing unless observed or requested. A brief bridge to surrounding footage must not lock the interior camera.
For content changes, specify the new content's placement, scale, interaction and persistence across the selected interval; keep the source camera unless the user requests a camera change. Never add cuts to a simple object/outfit/color edit.
For H3, refer to Video 1 for identity/environment/action timing and Image 1 / Image 2 only for context boundary states. Boundary images are reference assets, not exact-frame camera locks. For Seedance, describe the requested edit to the supplied clip without inventing H3 image references.
Before submitting, check that the change is visible, beats fit outputSelection, camera and preservation instructions do not conflict, and the closing action matches the evidence. Revise a vague or contradictory prompt before the one paid submission. Do not promise that a completed provider task proves the change succeeded.`

export function retakePromptPlanning(plan: RetakePlan) {
  const duration = plan.end - plan.start
  const shotCount = Math.min(5, Math.max(1, Math.floor(duration / .85)))
  const rounded = (value: number) => Number(value.toFixed(3))
  return {
    selectedSourceSeconds: { start: plan.start, end: plan.end },
    outputSelection: { start: retakeOutputTime(plan, plan.start), end: retakeOutputTime(plan, plan.end) },
    multiCameraTimingBudget: {
      suggestedShots: shotCount,
      suggestedOutputSlots: Array.from({ length: shotCount }, (_, index) => ({
        start: rounded(retakeOutputTime(plan, plan.start + duration * index / shotCount)),
        end: rounded(retakeOutputTime(plan, plan.start + duration * (index + 1) / shotCount)),
      })),
    },
  }
}
