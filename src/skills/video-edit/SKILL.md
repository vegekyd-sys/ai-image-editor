---
name: video-edit
description: Edit, transform, or faithfully recreate a supplied video. Use for source-preserving trims, repairs, captions, audio, effects, and subject/background replacement, or when a reference video's timing, camera, action, transitions, and beat structure must be reproduced with new content. Distinguishes source-edit from replication internally; use direct generation for a new video with no source authority and reference-video-studio for loose inspiration.
allowed-tools: read_file list_files inspect_retake retake_video prepare_visual_asset analyze_video transcribe_audio analyze_image generate_image generate_animation generate_audio run_code write_code_file write_file preview_frame materialize_media studio_run
metadata:
  makaron:
    icon: "⌁"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: true
    sourceMediaRequired: true
    sourceProject: "openmontage"
    sourceSkill: "video-edit"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "media"
    tags: [video, edit, replication, source-led, reference-to-video, ffmpeg, remotion]
---

# Video Edit

## Scope before execution

Whole-video character/object/outfit/background replacement, persistent removal,
and restyling remain full-source video edits. "Only change the character"
restricts what changes, not the time range. Pass the complete source plus the
supplied replacement image to generate_animation through the source-edit
protocol, preserving all unnamed attributes. Do not find character appearance
windows and force retake_video, inherit old ranges/actions, or generate endpoint
images merely because the conversation previously used local editing. Existing
images are references, not mandatory new image-generation requests. When a new
request explicitly changes the source or scope, replace the prior edit plan.
Provider duration limits select a capable model or the long-video workflow;
15 seconds is the local selection limit, not the whole-product editing limit.

## Bounded visual edits

This is an addition to full-source editing, not a replacement for it. For a
requested interval/scene, follow the steps here and stop before the full-source
profiles below. The tool descriptions own model limits, parameters, frame/audio
interpretation and prompt-writing guidance; do not load multi-angle or generation
guides for a bounded edit, even when its brief asks for multiple views.

1. Resolve the requested range from explicit seconds/timecodes, first/last N
   seconds, source duration or a verified scene/action. Convert clip-relative
   time to original-source seconds using its source offset. GUI selection is
   optional. For a known range, go straight to inspection; do not analyze the
   whole video or locate a screenshot first. For an unknown scene, use
   `analyze_video` / `preview_frame` to locate it. Only an unknown screenshot
   location uses `skills/video-edit/references/frame-location.md`.
2. State the source range briefly. Choose the requested model, otherwise H3 Max;
   Seedance family requests default to Eco unless native/standard is explicit.
   Call `inspect_retake` for that exact source/range/model. Read its actual frame
   evidence and ASR together; do not retranscribe it. If visual inspection fails,
   report it instead of generating blindly. If essential speech evidence is
   unavailable, resolve it before submission.
3. From the user's actual demand, independently choose `edit_mode` and
   `audio_mode` using the tool contracts. Expand the demand using the observed
   footage and measured output clock. Pass supplied images in their intended
   roles; no compulsory image generation or standard camera sequence.
4. Call `retake_video` with the inspection receipt and final instruction. It owns
   contextual clipping, generation, selected audio handling and full-video
   assembly. Do not script another pipeline or ask for a second merge approval.
   Poll its root task; delivery retries must not create another paid generation.
5. Verify the delivered selection: requested change, correct modification or
   replacement policy, outer footage, joins and requested sound. Provider
   completion alone is not acceptance. Report actual seconds and limitations.

A model-only comparison reuses the last explicitly edited ORIGINAL source,
range and demand, then reinspects that source for the new model. Do not use the
failed/generated result or current GUI selection as a new base unless the user
explicitly asks to revise that result. For an authorized correction, inspect the
failed selection to identify the defect, then revise from the original source.
Never weaken modification continuity just to make a failed edit look different.

If the range or source exceeds tool capabilities, use a capable full-source or
long-video workflow without silently shrinking the request. Precise cuts,
subtitles, working editable layers, standalone audio and continuation retain
their own tools. Visual demonstrations of layers and natural image/logo
integration within a scene remain local visual edits.

Use one Skill for any request in which a supplied video controls the result.
"Edit" is a user intent, not a requirement to expose a provider's typed edit
mode. First decide what authority the source has; that decision changes the
analysis depth, execution plan, and acceptance gates.

## Choose One Profile

- **source-edit** — the supplied video's pixels remain the base. Change only the
  named range/layer and preserve every unspecified part. Read
  `skills/video-edit/references/editing-protocol.md`.
- **replication** — the supplied video is structural authority, while people,
  objects, setting, brand, or other content is regenerated/replaced. Preserve
  observable shot grammar: order, timing, framing, camera, choreography,
  transitions, captions, and audio/beat structure. Read
  `skills/video-edit/references/replication-protocol.md`, then its conditional
  references.

If the source is only mood/style inspiration with no measurable structure lock,
use `reference-video-studio`. If there is no source authority, return to direct
generation in `prompts/animate.md`.

## Shared Protocol

1. Resolve the exact source and replacement inputs. Record duration/aspect/FPS,
   requested sound, target output, rights, and a compact keep/change brief.
2. Inspect only to the required depth. A clear source edit does not need
   `analyze_video`; replication must understand the complete clip and lock
   uncertain boundaries before paid generation.

3. Choose the smallest capable path: deterministic FFmpeg, editable Remotion,
   reference-to-video synthesis, or a hybrid. Models decide semantic intent and
   visual labels; deterministic tools own measurements, timecodes, assembly,
   and decode checks.
4. For Seedance, keep the video in the reference set and express its authority
   in the prompt. Use reference-to-video semantics for both profiles; do not ask
   the user to choose an "edit mode" and do not set
   `video_operation: "edit"`. Extension remains a distinct operation.
5. Before paid work, state provider, current capability, billable duration/cost,
   and retry ceiling. A clear existing-video edit instruction authorizes that
   scoped edit without a GUI selection; ask only for genuinely missing source
   or scope, or when the user requested review first. New video generation
   retains its script confirmation gate.
6. Verify the real output, not task completion: decode, streams, duration,
   changed content, preserved layers, identity, continuity, structure, and audio
   sync. Retry only against one or two measured failures.

## Interrupt and Resume

Persist the source fingerprint, selected profile, change/preserve contract,
prompt or Blueprint, provider/task ID, budget, outputs, and QA status before an
async boundary. Reuse successful provider outputs and reconcile pending or
terminal tasks before any resubmission. Structured replication reuses the
existing Studio Run artifacts instead of inventing another state machine.

## Stop Conditions

Stop when the source is ambiguous or unreadable, rights are unclear, replacement
roles conflict, the plan violates the preserve contract, structural evidence is
too uncertain, provider capability/cost cannot be confirmed, a paid retry lacks
a measurable correction, the retry ceiling is reached, or the output cannot be
decoded.
