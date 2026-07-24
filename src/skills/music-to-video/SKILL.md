---
name: music-to-video
description: >
  Makaron adapter with native support for OpenMontage's music-to-video
  craft skill, using existing Makaron tools and durable project outputs.
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
    sourceSkill: "music-to-video"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "video-workflow"
    canonicalSkill: "music-to-video"
    studioRunRecipe: "music-to-video"
    studioRunProfile: "audio-led-local-animation"
    sourceMediaRequired: false
    tags: [openmontage, agent-skill, video-workflow, native, video, workflow, studio-run, remotion]
---

# Music To Video

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/_shared/studio-production/production-contract.md` before starting substantial production.

## Execution Contract

- Run the full Studio Run contract for substantial work. Preserve source evidence, make production choices explicit, and use the canonical Makaron workflow for execution.
- Start recipe `music-to-video` and keep that recipe id through delivery.
- Require an Audio Index item or uploaded track. Analyze duration and beats once, build the visual timeline from that grid, and keep the original track authoritative.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Complete all applicable stages with an editable source, reviewed MP4, and delivery artifact.


## Audio-Led Workflow

Probe the track once and record duration, sections, major beats, energy changes, and any lyric cues. Build the script and storyboard on that timing grid. Use Remotion `Audio` with the original track, drive motion from `useCurrentFrame`, and keep cuts and kinetic type subordinate to the music. Review three representative frames covering the opening, strongest contrast, and ending before materialization.
