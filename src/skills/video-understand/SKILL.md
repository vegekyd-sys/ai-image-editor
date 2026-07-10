---
name: video-understand
description: >
  Makaron adapter with native support for OpenMontage's video-understand
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file analyze_video transcribe_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "⌁"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "video-understand"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "media"
    canonicalSkill: "source-video-studio"
    tags: [openmontage, agent-skill, media, native]
---

# Video Understand

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/source-video-studio/SKILL.md` and use it as the execution contract.

## Execution Contract

- Use the Node media runtime and FFmpeg/FFprobe for exact file operations. Probe once, transform once, publish existing workspace output instead of re-running work.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview three representative frames, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Deliver a real probed file with the requested duration, dimensions, streams, and timeline publication.
