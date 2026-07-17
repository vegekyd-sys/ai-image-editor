---
name: grok-media
description: >
  Makaron adapter with native support for OpenMontage's grok-media
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file analyze_image analyze_video generate_image generate_animation transcribe_audio run_code write_file
metadata:
  makaron:
    icon: "▶"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "grok-media"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "video-generation"
    canonicalSkill: "photo-to-video"
    tags: [openmontage, agent-skill, video-generation, native]
---

# Grok Media

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.

## Execution Contract

- Use Makaron video models and their real reference limits. With no source, call generate_animation as native text-to-video; with images, use image/reference-to-video; with a video, use the supported video-edit route. Submit once. Preserve the requested provider when supported; otherwise disclose the mapped native model and do not silently substitute.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Return a submitted or completed video with the selected model, duration, references, and next action made explicit.
