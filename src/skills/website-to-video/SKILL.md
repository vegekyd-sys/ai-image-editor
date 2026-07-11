---
name: website-to-video
description: >
  Makaron adapter with adapted support for OpenMontage's website-to-video
  craft skill, using existing Makaron tools and durable project outputs.
allowed-tools: read_file studio_run analyze_video analyze_image transcribe_audio generate_image generate_animation generate_audio generate_music list_voiceover_voices generate_voiceover run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "◫"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    sourceProject: "openmontage"
    sourceSkill: "website-to-video"
    sourceKind: "agent-skill"
    supportLevel: "adapted"
    adapterFamily: "video-workflow"
    canonicalSkill: "screen-demo"
    studioRunRecipe: "website-to-video"
    studioRunProfile: "site-led-remotion"
    sourceMediaRequired: false
    tags: [openmontage, agent-skill, video-workflow, adapted, video, workflow, studio-run, remotion]
---

# Website To Video

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Required Reading

1. Follow this adapter before using tools.
2. Read `skills/screen-demo/SKILL.md` and use it as the execution contract.
3. Read `skills/_shared/studio-production/production-contract.md` before starting substantial production.

## Execution Contract

- Run the full Studio Run contract for substantial work. Preserve source evidence, make production choices explicit, and use the canonical Makaron workflow for execution.
- Start recipe `website-to-video` and keep that recipe id through delivery.
- Treat the website as source evidence. Use supplied screen recording/screenshots and brand assets; when only a URL is present and capture is unavailable, request one capture rather than inventing the interface.
- Keep provider and runtime claims honest. An adapted skill preserves the goal,
  not an unavailable vendor implementation.
- Use project timeline media and workspace files as the source of truth.
- For auto-approved Studio Runs, batch adjacent text stages when possible,
  preview hook/body/end in one contact sheet, publish once, and materialize once.
- If the exact capability is unavailable, stop with the concrete gap instead of
  silently producing a different class of result.

## Completion

Complete all applicable stages with an editable source, reviewed MP4, and delivery artifact.


## Site-Led Workflow

Choose **real-capture**, **screenshot-led**, or clearly labeled **synthetic-ui** mode. Put the user outcome in the opening three seconds, preserve the site's actual brand and interface, and storyboard actions rather than feature claims. Never imply synthetic UI is a real capture. Keep source text readable at delivery size and review every crop, zoom, callout, and final CTA.
