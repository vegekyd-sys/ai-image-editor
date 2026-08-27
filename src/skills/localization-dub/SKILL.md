---
name: localization-dub
description: >
  Produce multi-locale subtitle, dub, or subtitle-plus-dub variants from one
  accepted source; use video-translate for the single-video translation route.
allowed-tools: read_file studio_run prepare_visual_asset analyze_video transcribe_audio generate_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "文"
    color: "#f0abfc"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "localization-dub"
    studioRunProfile: "source-led-variant"
    sourceMediaRequired: true
    sourceProject: "openmontage"
    sourceSkill: "localization-dub"
    sourceKind: "pipeline"
    supportLevel: "native"
    adapterFamily: "video-workflow"
    canonicalSkill: "localization-dub"
    tags: [video, workflow, studio-run, localization, subtitles, dubbing, remotion]
---

# Localization Dub

Use for campaign-style locale variants, subtitle-only variants, or multiple
language deliverables from one accepted source. For one translated video,
including Talking Head or VO replacement, read and follow
`skills/video-translate/SKILL.md` as the provider and timing contract.

## Workflow

1. Read `skills/_shared/studio-production/production-contract.md`, the shared
   audio and review contracts, then `skills/video-translate/SKILL.md`.
2. Start recipe `localization-dub`; lock source language, target locale(s),
   subtitle/dub mode, voice expectation, and source runtime.
3. Analyze and transcribe the source. The brief lists protected product names,
   people, numbers, prices, legal text, and calls to action.
4. Proposal concepts may vary voice, subtitle design, and localization tone, but
   must preserve claims and source structure.
5. The script artifact contains timed translated cues. Favor natural spoken
   language over literal syntax without changing meaning.
6. Follow `video-translate` independently for each locale: off-screen VO uses
   Seed Audio, while a visible talking head uses SeeDance 2.0 after the source
   edit. Fit phrasing to source timing; rewrite cues that drift more than 10%
   instead of extending the video.
7. Storyboard dense subtitle frames and final legal/CTA frames. Account for
   longer target-language lines and safe areas.
8. Compose locale variants in Remotion, preview dense text and closing copy,
   materialize, and review timing, protected terms, readability, and audio sync.

## Quality Bar

The localized version should feel written for the target audience while making
the same promises as the source. Dubbed audio is not described as lip-synced.
