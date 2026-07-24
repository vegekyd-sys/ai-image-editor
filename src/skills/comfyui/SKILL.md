---
name: comfyui
description: >
  Makaron adapter with native support for OpenMontage's comfyui
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file analyze_image generate_image transcribe_audio generate_audio run_code write_file
metadata:
  makaron:
    icon: "▧"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "comfyui"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "image"
    canonicalSkill: "sticker-maker"
    tags: [openmontage, agent-skill, image, native]
---

# Comfyui

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.

## Execution Contract

- Apply the source prompting and reference discipline through Makaron image models. Respect the selected model; if the named external provider is unavailable, state the native replacement before generation.
- Route Qwen, Pony, and WAI requests through Makaron's existing ComfyUI-backed image models. Arbitrary custom graph upload and unregistered nodes are outside this adapter.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Deliver the generated or edited image with reference intent preserved and no false provider claim.
