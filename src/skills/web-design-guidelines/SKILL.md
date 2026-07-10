---
name: web-design-guidelines
description: >
  Makaron adapter with native support for OpenMontage's web-design-guidelines
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file analyze_image analyze_video generate_image run_code write_file preview_frame
metadata:
  makaron:
    icon: "✓"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "openmontage"
    sourceSkill: "web-design-guidelines"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "quality"
    canonicalSkill: "motion-design-video"
    tags: [openmontage, agent-skill, quality, native]
---

# Web Design Guidelines

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.

## Execution Contract

- Treat the source skill as a review and art-direction lens. Turn findings into concrete corrections for hierarchy, distinctness, readability, motion, accessibility, or performance.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview three representative frames, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Return prioritized findings or apply and verify the requested corrections.
