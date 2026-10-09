---
name: video-edit
description: Edit, transform, or faithfully recreate a supplied video. Use for source-preserving trims, repairs, captions, audio, effects, and subject/background replacement, or when a reference video's timing, camera, action, transitions, and beat structure must be reproduced with new content. Distinguishes source-edit from replication internally; use direct generation for a new video with no source authority and reference-video-studio for loose inspiration.
allowed-tools: read_file list_files prepare_visual_asset analyze_video transcribe_audio analyze_image generate_image generate_animation generate_audio run_code write_code_file write_file preview_frame materialize_media studio_run
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
   and retry ceiling. Show the final script and respect the normal confirmation
   gate unless the request explicitly authorizes submission.
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
