import type { RetakePlan } from './video-retake-contract'
import { retakeOutputTime } from './video-retake-inspection'

/** Guidance goes to the inspecting Agent, never appended to a provider prompt. */
export const RETAKE_SCENE_READING = `Read the actual frames in timestamp order. Labels give SOURCE and OUTPUT seconds; JOIN CONTEXT is outside the replacement.
Understand what is visible: subjects, environment, composition, motion, interactions, existing transitions, and the selected opening/closing states. Associate each frame with its own label and evidence group. A new shot in ADJACENT JOIN CONTEXT is not the selected closing state, even if it occurs only one frame later. Describe meaningful changes with supporting timestamps; summarize a static interval once instead of repeating identical frame descriptions. Track event order and physical relationships when relevant. Separate observed facts from uncertain or unseen details; never turn the requested change into a fact about the source.
Read audioEvidence alongside these frames. Attribute speech to its measured source time and distinguish selectedSpeech from adjacentSpeech. Use narration/dialogue to interpret the scene and its intended progression, but do not treat spoken descriptions as visible facts. Spoken names do not establish correct on-screen spelling; inspect displayed letters separately. No speech recognized does not mean no music or sound effects. If ASR is unavailable or untimed, state the limitation and do not invent dialogue, word timing, rhythm or lip-sync evidence.
Identify what the user wants changed and what must remain coherent. Read adjacent context to understand how this interval enters and exits the surrounding video. Only then plan the edit.`

export const RETAKE_PROMPT_WRITING = `Write a scene-informed edit instruction after viewing the source and any supplied images.
First decide the visible result the user is asking for. Expand only the details needed to make that result clear in this footage: placement, interaction, motion, appearance, duration or presentation. Use the actual source and user intent to choose the edit structure; there is no default shot count, camera sequence, transition or image-generation step. A single continuous instruction is sufficient when the change persists. Split into timed beats only when the requested change develops over time.
Keep the source camera and action where they support the request. Change framing, add a shot or use a transition only when requested or needed to express the intended result; do not turn ordinary content edits into multi-camera sequences. If new coverage is appropriate, choose views and pacing based on the actual scene and motion, not a standard template. Distinguish temporal phases from camera changes. For motion or interaction, carry the observed progression into the requested edit: each later beat must continue from the previous action state rather than reintroducing the opening pose. A new camera observes the next phase of the same event, not a second performance. Do not add a landing, impact or other contact unless observed or explicitly requested. Preserve the order of observed events unless the user asks to change them; avoid resets, duplicate events, invented contact or action from the untouched suffix.
Write the requested visible change first, its temporal development if needed next, and only relevant continuity constraints last. Keep the factual observation separate from the provider prompt. Use the measured outputSelection clock; choose all beats within that interval, with enough time to see the result. Do not prescribe cuts or a return-to-source shot merely to fill the time.
Honor the roles of supplied images: content reference, desired intermediate state or explicit final frame. If readable text or UI layout is part of the requested result, inspect and copy the supplied content accurately, keep the lettering stable during its readable display, and animate its placement or surrounding scene rather than morphing characters. When a supplied image is the approved complete replacement scene and the request requires its content/layout, prefer using that existing image as an H3 intermediate visual-state control at a meaningful interior beat, instead of only mentioning it as a loose style reference. An isolated product reference or an image requested only for its style stays a creative reference. This does not require generating an additional image. Choose the role from the image and user intent, not from a fixed workflow. Reuse suitable supplied images directly. A new image is optional support for a missing visual state, not a prerequisite of video editing or camera changes. Generate one only when it materially helps this particular edit and no suitable existing image is available; inspect it before use. If a control or generation capability is unsupported, choose a supported route and explain the relevant limitation.
Check continuity at the selected opening and closing using the adjacent source context. Preserve the original join when surrounding footage follows; an explicitly requested final image takes priority at the end of the whole video. Do not preserve an old state that contradicts the requested replacement. If the user explicitly selects an image as the final whole-video frame, pass end_frame_media_index with that existing image, including for Seedance; delivery preserves that asset in the closing beat, so plan a transition into its actual composition instead of a generated substitute. Choose boundary_mode from the requested change, not from a fixed workflow. Use exact when original boundary poses/compositions remain compatible. Use scene for a replacement shot whose framing, viewpoint, action or staging conflicts with the original boundaries: keep the requested result visible throughout the selection, and join adjacent shots through coherent identity, lighting, action direction and editing. Do not force a zoom-out, return to the old camera, or restoration of an old action merely to meet the join. Describe any genuine narrative discontinuity honestly rather than inventing a smooth physical match. In scene mode, H3 Image 1 and Image 2 are source identity/environment references only, NOT desired first/last compositions; expressly identify that role and the intended new framing/action. In exact mode, H3 Image 1 anchors the selected opening and Image 2 the closing (or supplied final image). An optional middle control is Image 3; when scene mode, camera_change, that control or an explicit final image is used, H3 receives the boundary images without a conflicting original-camera video reference. Otherwise Video 1 is source context, not a demand to copy every source action. Use supplied timeline markers for creative images so the tool binds them to the actual provider inputs.
For narrated footage, anchor relevant reveals, actions and transitions to measured selectedSpeech output/word times, so visual retiming and assembly restore them against the original source speech. Match meaning as well as timing: a spoken list is not a default sequence of unrelated visual objects or layers. Use a sentence-level idea when individual keywords do not describe the requested visual event; do not force false one-word/one-object correspondences merely to fill the interval. Use only the words actually overlapping the selection; surrounding sentence text is context, not permission to replay it. Preserve the original narration and dialogue; do not request newly generated speech, music or lip movement merely to illustrate narration. ASR alone cannot verify music beats, effects or lip synchronization. If the requested change contradicts retained dialogue or requires changing the audio, explain that scope conflict rather than claiming audiovisual synchronization. If ASR failed and speech understanding is essential to the request, obtain usable audio evidence before submission instead of guessing.
Before the one paid submission, check that the requested change will be perceptible, references and constraints agree, timing fits the measured interval, audiovisual meaning/timing agrees with the retained speech, and the opening/closing handoff follows the user's intent. A completed provider task alone does not establish a successful edit.`

export interface RetakeShotBeat { start: number; end: number; instruction: string }

/** A source/join timestamp describes inspected footage, not output timing. */
function sourceClockReference(prompt: string, index: number): boolean {
  const clause = prompt.slice(Math.max(0,index-100),index).split(/[;\n.!?]/).at(-1) || ''
  return /\b(?:source|original|adjacent|untouched)\b|原片|源片|原视频|原視頻/i.test(clause)
    && !/\boutput\b|输出|輸出|出力/i.test(clause)
}

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
    if (sourceClockReference(prompt,match.index!+match[0].search(/\d/))) continue
    const start = Number(match[1]), end = Number(match[2])
    if (start < selection.start - epsilon || end > selection.end + epsilon || end <= start) return 'Prompt shot times fall outside outputSelection. Do not reset the selected interval to zero.'
  }
  const points = /(?:\b(?:at|before|after|output(?:-local)?)\s*(?:output\s*)?|(?:输出|輸出|出力)\s*|(?:在|於|于|第)\s*(?:输出|輸出|出力)?\s*)(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds)?)?\b|秒)/gi
  for (const match of prompt.matchAll(points)) {
    if (sourceClockReference(prompt,match.index!+match[0].search(/\d/))) continue
    const time = Number(match[1])
    if (time < selection.start - epsilon || time > selection.end + epsilon) return 'Prompt cut time falls outside outputSelection. Do not reset the selected interval to zero.'
  }
  return null
}

export function retakePromptPlanning(plan: RetakePlan) {
  return {
    selectedSourceSeconds: { start: plan.start, end: plan.end },
    outputSelection: { start: retakeOutputTime(plan, plan.start), end: retakeOutputTime(plan, plan.end) },
    promptClock: `Output 0s corresponds to source ${plan.outputMode === 'selection' ? plan.start : plan.contextStart}s. The edit starts at output ${retakeOutputTime(plan, plan.start)}s and ends at output ${retakeOutputTime(plan, plan.end)}s. Do NOT reset this selection to zero. Copy these output times into shot_plan and the final prompt.`,

  }
}
