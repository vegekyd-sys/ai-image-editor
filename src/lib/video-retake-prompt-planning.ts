import type { RetakePlan } from './video-retake-contract'
import { retakeOutputTime } from './video-retake-inspection'

/** Guidance goes to the inspecting Agent, never appended to a provider prompt. */
export const RETAKE_SCENE_READING = `Read these actual frames in timestamp order. Labels are #frame SOURCE seconds : OUTPUT seconds (JOIN CONTEXT is outside the edit); rows are chronological, left to right then top to bottom.
Report visible subject identity, scene, and existing shot sizes/view directions. Track action at selected opening, middle, and closing: pose, airborne/grounded state, board contact, travel direction, occlusion, and existing cuts. Distinguish the selected interval from surrounding context; do not infer a landing, takeoff, or unseen camera angle from the user's request. State uncertainty when sampled frames do not establish motion.
Separate (1) observed facts, (2) the requested visual change, and (3) the identity/action facts to retain. Do not write the replacement script until the facts have been read.`

export const RETAKE_PROMPT_WRITING = `Expand the user's brief into a concise, concrete final generation prompt AFTER viewing the evidence.
Lead with the requested visible change; then give the output-time beats, then only the essential identity/action constraints. Keep the long source observation in source_observation, not in the generation prompt. Use output-local seconds only; do not put the source video's absolute timestamps in the provider prompt.
For a camera-change request, explicitly authorize NEW shot coverage: the reference supplies subject identity, environment and action phase, not its camera framing or continuous shot. Describe camera position/view direction AND shot size for each setup, with an explicit HARD CUT and time at each transition. A zoom, crop, pan or small camera drift within the original shot does not fulfill multi-camera editing. Choose a few substantially distinct views with enough screen time to read them; the suggested slots are a timing budget, not a forced template. Keep the same action progressing across cuts. For EVERY beat, map its output times back to the sampled source interval and state the supported action phase in the shot instruction. Never show ground contact in a close-up and then cut back to airborne motion from the SAME jump. If ground contact is unconfirmed, explicitly keep a visible air gap between wheels and ramp and the feet on the board; a wheel-level camera does not mean grounded wheels. Place any descent/contact only in the later beat where source evidence supports it. Do not restart takeoff or invent a landing unless observed or requested. Match the boundary action/pose, not necessarily the original camera: the last NEW setup can hand off directly. Do not squeeze in an additional return-to-source shot beyond the timing budget. Read the adjacent JOIN CONTEXT frames to check handoff. Never preplay the action AFTER the selected last frame; it will play once in the untouched suffix.
For content changes, specify the new content's placement, scale, interaction and persistence across the selected interval; keep the source camera unless the user requests a camera change. Never add cuts to a simple object/outfit/color edit.
For H3, the whole generated clip represents ONLY the selected source action, stretched to outputSelection. Video 1 includes surrounding context for identity/environment; its before/after actions are NOT output targets. Image 1 and Image 2 are exact selected first/last-frame anchors, also supplied as native endpoint constraints. Start and finish at these actual poses, positions and framing; make the requested new camera coverage inside these anchors. The ending must not advance into the suffix or replay the action. For Seedance, describe the requested edit to the supplied clip without inventing H3 image references.
Before submitting, check that the change is visible, beats fit outputSelection, camera and preservation instructions do not conflict, and the closing action matches the evidence. Revise a vague or contradictory prompt before the one paid submission. Do not promise that a completed provider task proves the change succeeded.`

export interface RetakeShotBeat { start: number; end: number; instruction: string }

/** Reject an edit planned in selected-relative time before it can be charged. */
export function retakeShotPlanError(shots: RetakeShotBeat[] | undefined, prompt: string, selection: { start: number; end: number }): string | null {
  const epsilon = .01
  if (!shots?.length || shots.length > 8) return 'Provide shot_plan with 1–8 output-time beats (one persistent beat for a simple content edit).'
  let cursor = selection.start
  for (const shot of shots) {
    if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.end <= shot.start
      || Math.abs(shot.start - cursor) > epsilon || shot.start < selection.start - epsilon || shot.end > selection.end + epsilon
      || !shot.instruction?.trim()) return 'shot_plan must continuously cover outputSelection, with no gaps, overlaps or out-of-range beats.'
    cursor = shot.end
  }
  if (Math.abs(cursor - selection.end) > epsilon) return 'shot_plan must end at outputSelection.end.'
  // Only explicit second-based beats are interpreted. Camera dimensions,
  // subjects and other numbers in ordinary prose are not timestamps.
  const ranges = /\b(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds)?)?\b|秒)/gi
  for (const match of prompt.matchAll(ranges)) {
    const start = Number(match[1]), end = Number(match[2])
    if (start < selection.start - epsilon || end > selection.end + epsilon || end <= start) return 'Prompt shot times fall outside outputSelection. Do not reset the selected interval to zero.'
  }
  const points = /(?:\b(?:at|before|after|output(?:-local)?)\s*(?:output\s*)?|(?:输出|輸出|出力)\s*|(?:在|於|于|第)\s*(?:输出|輸出|出力)?\s*)(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds)?)?\b|秒)/gi
  for (const match of prompt.matchAll(points)) {
    const time = Number(match[1])
    if (time < selection.start - epsilon || time > selection.end + epsilon) return 'Prompt cut time falls outside outputSelection. Do not reset the selected interval to zero.'
  }
  return null
}

export function retakePromptPlanning(plan: RetakePlan) {
  const duration = plan.end - plan.start
  const shotCount = Math.min(5, Math.max(1, Math.floor(duration / .85)))
  const rounded = (value: number) => Number(value.toFixed(3))
  return {
    selectedSourceSeconds: { start: plan.start, end: plan.end },
    outputSelection: { start: retakeOutputTime(plan, plan.start), end: retakeOutputTime(plan, plan.end) },
    promptClock: `Output 0s corresponds to source ${plan.outputMode === 'selection' ? plan.start : plan.contextStart}s. The edit starts at output ${retakeOutputTime(plan, plan.start)}s and ends at output ${retakeOutputTime(plan, plan.end)}s. Do NOT reset this selection to zero. Copy these output times into shot_plan and the final prompt.`,
    multiCameraTimingBudget: {
      suggestedShots: shotCount,
      suggestedOutputSlots: Array.from({ length: shotCount }, (_, index) => ({
        start: rounded(retakeOutputTime(plan, plan.start + duration * index / shotCount)),
        end: rounded(retakeOutputTime(plan, plan.start + duration * (index + 1) / shotCount)),
      })),
    },
  }
}
