---
name: explainer-aesthetic-disney
description: Controlled explainer-video benchmark using only the character animation principles lens as the aesthetic variable.
allowed-tools: read_file studio_run prepare_visual_asset analyze_image analyze_video generate_image generate_audio generate_music list_voiceover_voices generate_voiceover transcribe_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "✦"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "explainer-video"
    studioRunProfile: "generated-explainer"
    sourceMediaRequired: true
    sourceProject: "github:dylantarre/animation-principles"
    sourceSkill: "creative-director+motion-designer+video-motion-graphics"
    sourceKind: "aesthetic-benchmark"
    supportLevel: "adapted"
    adapterFamily: "aesthetic-experiment"
    canonicalSkill: "explainer-video"
    tags: [video, explainer, studio-run, aesthetic, character, experiment]
---

# Explainer + Character Motion

1. Read `skills/explainer-video/SKILL.md`; it remains the complete workflow.
2. Read `skills/_shared/aesthetic-lens-contract.md`.
3. Read `skills/aesthetic-disney-character-motion/SKILL.md`.
4. Execute the normal `explainer-video` Studio Run. The character-motion lens is
   the only replacement for aesthetic direction. Do not reveal the benchmark
   or lens name inside the video.
