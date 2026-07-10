---
name: manimgl-best-practices
description: >
  Makaron adapter with adapted support for OpenMontage's manimgl-best-practices
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file studio_run analyze_image analyze_video generate_image generate_audio generate_music list_voiceover_voices generate_voiceover transcribe_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "✦"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "manimgl-best-practices"
    sourceKind: "agent-skill"
    supportLevel: "adapted"
    adapterFamily: "composition"
    canonicalSkill: "motion-design-video"
    tags: [openmontage, agent-skill, composition, adapted]
---

# Manimgl Best Practices

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/motion-design-video/SKILL.md` and use it as the execution contract.

## Execution Contract

- Translate the source craft into deterministic frame-driven Remotion. Use injected React, Remotion, and THREE primitives; external animation APIs are guidance unless Makaron explicitly exposes them.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview three representative frames, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Deliver an editable composition, preview the hook/body/ending, then materialize once.
