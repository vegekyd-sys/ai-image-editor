---
name: avatar-spokesperson
description: >
  Create presenter-led videos from a supplied identity image, presenter footage,
  script, or voiceover, with native speech, sound and captions; add editable
  layers only when requested. Use when an avatar
  or on-screen spokesperson should deliver the message; do not promise exact lip
  sync unless the selected provider supports it.
allowed-tools: read_file studio_run prepare_visual_asset analyze_video analyze_image transcribe_audio generate_image generate_animation generate_audio run_code write_file preview_frame materialize_media
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
    inputHint: "A presenter image or footage, plus a script or voice track"
    tags: [openmontage, pipeline, video-workflow, adapted, video, workflow, studio-run, remotion]
---

# Avatar Spokesperson

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow `skills/_shared/native-audiovisual.md` before selecting production tools.
2. Read `prompts/animate.md` for generated presenter footage. Within the model's
   limit, generate the supplied identity, all dialogue, music and requested
   native subtitles together. Do not create a voice master and silent plate.
3. Read `skills/_shared/studio-production/production-contract.md` only when
   source-led assembly or explicitly editable overlays require composition.

## Execution Contract

- For the composition route, run the Studio Run contract. Preserve source evidence and use generated audiovisual footage as the audible source.
- When Studio is needed, start recipe `avatar-spokesperson` and keep that recipe id through delivery.
- Use a supplied presenter image/video when available. Makaron can create presenter-led video, voiceover, captions, and compositing; do not promise exact phoneme lip sync unless the selected provider exposes it.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Direct generation delivers the reviewed audiovisual MP4. The composition route
also completes all applicable stages with the requested editable source and
delivery artifact; a generated plate is not that delivery.


## Production Modes

- **source-presenter**: edit supplied presenter footage while keeping speech authoritative.
- **generated-presenter**: generate the supplied identity, approved dialogue and supporting sound together; preserve native audio.
- **voiceover-composite**: use presenter visuals plus timed voiceover and captions when exact lip sync is unavailable.

Lock identity, language, voice, framing, duration, and lip-sync expectation in the
script. Review face consistency, mouth behavior, captions and audio timing in
the generated MP4. Do not add a paid voice sample or separate lip-sync job by
default; use one only when explicitly required by the requested treatment.
