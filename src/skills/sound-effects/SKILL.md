---
name: sound-effects
description: >
  Makaron adapter with native support for OpenMontage's sound-effects
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file analyze_image generate_image list_voiceover_voices generate_voiceover transcribe_audio generate_audio generate_music run_code write_file
metadata:
  makaron:
    icon: "♪"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "sound-effects"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "audio"
    canonicalSkill: "explainer-video"
    tags: [openmontage, agent-skill, audio, native]
---

# Sound Effects

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.

## Execution Contract

- Preserve timing, language, performance, loudness, and edit intent. Use Makaron voice, music, sound, transcription, and FFmpeg primitives; never claim an unavailable external provider was used.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview three representative frames, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Return a durable audio asset or a composition that uses it, with timing and source recorded.
