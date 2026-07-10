---
name: source-video-studio
description: >
  Turn real uploaded footage into a polished talking-head edit, hybrid story,
  documentary montage, or source-led feature while preserving the footage as
  the primary evidence.
allowed-tools: read_file studio_run analyze_video transcribe_audio analyze_image generate_image generate_animation generate_audio generate_music run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "◉"
    color: "#f0abfc"
    tipsEnabled: false
    builtIn: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "source-video-studio"
    studioRunProfile: "source-led"
    sourceMediaRequired: true
    tags: [video, workflow, studio-run, footage, talking-head, hybrid, documentary, remotion]
---

# Source Video Studio

The uploaded footage is the subject. Generated media may clarify or bridge, but
must not silently replace the evidence the user supplied.

## Modes

- `talking-head`: tighten speech, remove dead air, improve framing, captions,
  chaptering, and supporting B-roll.
- `hybrid`: combine source footage with generated diagrams, images, or short
  inserts where the source cannot show the idea.
- `documentary-montage`: build a thematic, music-led sequence from real clips.

## Workflow

1. Read `skills/_shared/studio-production/production-contract.md`, the shared
   audio, taste, and review contracts.
2. Start recipe `source-video-studio`; do not proceed without usable footage.
3. Analyze every source and transcribe speech when present. The brief records
   source roles, strengths, defects, permissions/provenance notes, and mode.
4. Proposal concepts must describe selection logic, crop/reframe plan, B-roll
   strategy, caption system, audio treatment, and what will remain untouched.
5. The script artifact becomes the timed content spine: selected transcript
   ranges, thematic beats, or montage order. Keep source timestamps visible.
6. Storyboard every crop, callout, support visual, and transition. Do not cover
   faces, UI, captions, or important source detail.
7. Use Remotion for trims, framing, subtitles, overlays, color treatment, and
   generated support. Preserve sentence boundaries and natural reactions.
8. Review source fidelity, crop quality, caption readability, audio continuity,
   and whether generated inserts became distracting.

## Quality Bar

The finished piece should feel edited from real material, not like a generated
video that occasionally remembers the source exists.
