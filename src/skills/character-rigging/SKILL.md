---
name: character-rigging
description: >
  Makaron adapter with native support for OpenMontage's character-rigging
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file studio_run prepare_visual_asset analyze_image analyze_video generate_image generate_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "人"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "character-rigging"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "character"
    canonicalSkill: "character-animation"
    tags: [openmontage, agent-skill, character, native]
---

# Character Rigging

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/character-animation/SKILL.md` and use it as the execution contract.

## Execution Contract

- Lock the character spec, layer order, pivots, poses, expressions, and action beats before animation. Prefer frame-driven SVG, Canvas, or Remotion motion and inspect representative poses.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Deliver the reusable character source plus sampled frames and, when requested, the materialized MP4.
