---
name: video-replication
description: >
  Orchestrate supervised recreation of a supplied reference video's shot
  grammar with replacement subjects or assets: shot count, order, timing,
  framing, camera motion, transitions, captions, and audio-beat structure. Use
  for measurable shot-by-shot matching; use reference-video-studio for loose
  inspiration and source-video-studio when the original footage itself is the
  edit.
allowed-tools: read_file list_files studio_run prepare_visual_asset analyze_video transcribe_audio analyze_image generate_image generate_animation generate_audio run_code write_code_file write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "🎞️"
    color: "#fb7185"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    supportLevel: "experimental"
    studioRunRecipe: "reference-video-studio"
    studioRunProfile: "reference-led"
    sourceMediaRequired: true
    tags: [video, workflow, studio-run, reference, replication, shot-grammar, analysis, remotion]
---

# Video Replication

Replicate the reference's observable directing and editing structure while
replacing the protected or user-designated content layer. Never promise
pixel-perfect copying, hidden production intent, or provider-deterministic
motion.

## Read Before Acting

1. `skills/video-replication/references/shot-blueprint.md`
2. `skills/video-replication/references/similarity-qa.md`
3. `skills/_shared/studio-production/production-contract.md`
4. `skills/_shared/studio-production/audio-direction.md` when audio is used
5. `skills/_shared/studio-production/review-contract.md`
6. `skills/_shared/remotion-director-contract.md`
7. `skills/video-ffmpeg-lab/SKILL.md` for deterministic media inspection and
   file operations

## Protocol

1. **Input, rights, and processing gate.** Identify the exact reference, all
   replacement subjects/assets, preserve/change scope, target aspect ratio,
   duration, resolution, FPS, language, caption/audio requirements, and
   acceptance priorities. Record what may be retained (abstract shot
   grammar) and what must change (identity, brand, dialogue, copyrighted surface
   design, or music). Get separate permission before sending any reference data
   to third-party analysis, ASR, or generation services. Without that permission,
   use local FFmpeg/FFprobe only. Probe the exact source and stop on an unreadable
   source, ambiguous reference choice, or missing rights.
2. **Start the durable run.** After probe and input confirmation, lock the
   delivery promise and start recipe `reference-video-studio`. Use the existing
   eight Studio Run stages and `${projectId}/studio-runs/${studioRunId}/run.json`
   as the only resume state; do not invent another stage machine.
3. **Extract evidence.** Use deterministic FFmpeg/FFprobe work for file truth,
   candidate boundaries, frames, audio envelope, and decodability. Use
   `transcribe_audio` for word timing when speech matters. Use multimodal models
   only to label composition, action, camera intent, text/style, and uncertain
   boundaries. Never invent a measurement from prose analysis.
4. **Lock the Blueprint.** Write the supplemental analysis file at
   `${projectId}/studio-runs/${studioRunId}/analysis/shot-blueprint.json` using
   the reference contract, link it from Brief, and project approved shots into
   Storyboard. Every shot has a source range, confidence, evidence, and explicit
   preserve/replace fields. Resolve low-confidence boundaries before paid work.
5. **Choose exactly one route.** A = deterministic re-edit of supplied media;
   B = per-shot generation only when replacement footage is missing; C = hybrid,
   with A for all covered shots and B only for gaps. Prefer A, then C, then B.
   Single-person continuous action may use Kling Motion Control; it is not a
   multi-shot replication route.
6. **Cost gate.** Before any paid call, write the provider route, current
   capability contract, estimated billable seconds/cost, and retry ceiling into
   Proposal. Put submitted task IDs and results in Assets. Make one representative
   4-5 second shot at the cheapest useful resolution before a batch. One initial
   attempt plus one evidence-driven correction is the default ceiling; a third
   attempt or a full batch requires user approval.
7. **Build deterministically.** Map or generate shot assets, then implement the
   locked timing, cuts, transitions, captions, beat hits, and final audio in one
   editable Remotion composition. Generation output supplies pixels, not the
   master edit clock.
8. **Measure and repair before export.** Run every currently available
   structural QA check against the locked Blueprint and Composition, and save
   evidence in the Composition artifact. Repair the smallest failing layer:
   timeline/layout/audio in Remotion; source selection in the map; generated
   pixels only when the mismatch is genuinely visual. A completed provider task
   is not acceptance.
9. **Finish through the existing boundary.** Inspect representative frames,
   publish the gated draft, and call `materialize_media` once. It returns
   asynchronously; follow the shared review contract and do not start a new
   review/render loop after queue success. Until a post-export structure verifier
   is integrated into the durable worker, report final encoded-MP4 similarity QA
   as unverified rather than claiming automatic acceptance.

## Interrupt and Resume

Resume the existing Studio Run and inspect its Brief/Proposal/Storyboard/Assets/
Composition artifacts plus the supplemental Blueprint. Proposal owns route and
budget; Assets own the asset map and provider task IDs; Composition owns pre-
materialization QA deltas. Reconcile each existing task: poll pending/running,
download successful, and record terminal failure plus billing state before a new
attempt. Never resubmit merely because a callback or Agent turn was interrupted.

## Stop Conditions

Stop rather than improvise when rights are unclear, source metadata is invalid,
the Blueprint remains structurally uncertain, provider capability or price
cannot be confirmed, the representative shot misses the agreed threshold, the
retry ceiling is reached, or the final MP4 cannot be decoded.
