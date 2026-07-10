---
name: hybrid
description: >
  Makaron adapter with adapted support for OpenMontage's hybrid
  production pipeline, using existing Makaron tools and durable project outputs.
allowed-tools: read_file studio_run analyze_video analyze_image transcribe_audio generate_image generate_animation generate_audio generate_music list_voiceover_voices generate_voiceover run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "◫"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "hybrid"
    sourceKind: "pipeline"
    supportLevel: "adapted"
    adapterFamily: "video-workflow"
    canonicalSkill: "source-video-studio"
    studioRunRecipe: "hybrid"
    studioRunProfile: "source-led"
    sourceMediaRequired: true
    tags: [openmontage, pipeline, video-workflow, adapted, video, workflow, studio-run, remotion]
---

# Hybrid

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/source-video-studio/SKILL.md` and use it as the execution contract.
3. Read `skills/_shared/studio-production/production-contract.md` before starting substantial production.

## Execution Contract

- Run the full Studio Run contract for substantial work. Preserve source evidence, make production choices explicit, and use the canonical Makaron workflow for execution.
- Start recipe `hybrid` and keep that recipe id through delivery.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview three representative frames, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Complete all applicable stages with an editable source, reviewed MP4, and delivery artifact.
