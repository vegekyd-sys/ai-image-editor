---
name: character-animation
description: >
  Build a reusable local character animation proof with a consistent character
  spec, pose system, action beats, and frame-driven SVG, Canvas, or Remotion
  motion.
allowed-tools: read_file studio_run analyze_image analyze_video generate_image list_voiceover_voices generate_voiceover transcribe_audio generate_audio generate_music run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "人"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "character-animation"
    studioRunProfile: "local-character-animation"
    sourceMediaRequired: false
    sourceProject: "openmontage"
    sourceSkill: "character-animation"
    sourceKind: "pipeline"
    supportLevel: "native"
    adapterFamily: "character"
    canonicalSkill: "character-animation"
    tags: [video, workflow, studio-run, character, rig, pose, remotion]
---

# Character Animation

Use for reusable mascots, cartoon acting, consistent characters, and local
rigged animation. This is not photoreal provider video and must not silently
downgrade to still-image parallax.

## Workflow

1. Read `skills/_shared/studio-production/production-contract.md`, the shared
   taste, audio, review, and Remotion director contracts.
2. Start recipe `character-animation`; default to a 10-15 second proof for a new
   character unless the user explicitly requests a larger run.
3. Brief the character role, silhouette, emotional range, required actions,
   reuse strategy, and honest runtime limits.
4. Proposals must differ in character construction and acting mechanism, not
   only costume or palette. Lock character count and complexity early.
5. Use reference art when supplied. Otherwise generate a compact asset-like
   character sheet with complete parts, clean edges, and no embedded text.
6. In the script use action beats: idle, anticipation, action, reaction, hold,
   and settle. The storyboard maps each beat to pose, pivot, framing, and sound.
7. Build reusable part/pose data and frame-driven SVG or Canvas animation in
   Remotion. Character differences belong in data, not duplicated scene code.
8. Preview pose readability, action midpoint, layer integrity, and ending. The
   review must reject broken pivots, popping parts, or a still-image substitute.

## Quality Bar

The same character must remain identifiable across multiple poses, and the
motion must include anticipation, follow-through, and intentional holds.
