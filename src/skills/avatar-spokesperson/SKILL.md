---
name: avatar-spokesperson
description: >
  Makaron adapter with adapted support for OpenMontage's avatar-spokesperson
  production pipeline, using existing Makaron tools and durable project outputs.
allowed-tools: read_file studio_run prepare_visual_asset analyze_video analyze_image transcribe_audio generate_image generate_animation generate_audio generate_music list_voiceover_voices generate_voiceover run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "◫"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    sourceProject: "openmontage"
    sourceSkill: "avatar-spokesperson"
    sourceKind: "pipeline"
    supportLevel: "adapted"
    adapterFamily: "video-workflow"
    canonicalSkill: "avatar-spokesperson"
    studioRunRecipe: "avatar-spokesperson"
    studioRunProfile: "generated-presenter"
    sourceMediaRequired: false
    tags: [openmontage, pipeline, video-workflow, adapted, video, workflow, studio-run, remotion]
---

# Avatar Spokesperson

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/_shared/studio-production/production-contract.md` before starting substantial production.

## Execution Contract

- Run the full Studio Run contract for substantial work. Preserve source evidence, make production choices explicit, and use the canonical Makaron workflow for execution.
- Start recipe `avatar-spokesperson` and keep that recipe id through delivery.
- Use a supplied presenter image/video when available. Makaron can create presenter-led video, voiceover, captions, and compositing; do not promise exact phoneme lip sync unless the selected provider exposes it.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Complete all applicable stages with an editable source, reviewed MP4, and delivery artifact.


## Production Modes

- **source-presenter**: edit supplied presenter footage while keeping speech authoritative.
- **generated-presenter**: animate a supplied identity image with an approved voice/script.
- **voiceover-composite**: use presenter visuals plus timed voiceover and captions when exact lip sync is unavailable.

Lock identity, language, voice, framing, duration, and lip-sync expectation in the brief. Prove one representative line before a long or paid generation, then review face consistency, mouth behavior, captions, and audio timing.
