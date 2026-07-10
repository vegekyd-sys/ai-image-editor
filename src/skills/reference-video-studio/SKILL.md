---
name: reference-video-studio
description: >
  Analyze a reference video, extract its transferable structure and pacing,
  propose original directions, and produce a new editable video without copying
  the reference's surface design.
allowed-tools: read_file studio_run analyze_video transcribe_audio run_code write_file preview_frame materialize_media list_voiceover_voices generate_voiceover generate_audio generate_music generate_image generate_animation analyze_image
metadata:
  makaron:
    icon: "🎬"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    defaultAspectRatio: "16:9"
    studioRunRecipe: "reference-video-studio"
    studioRunProfile: "reference-led"
    sourceMediaRequired: true
    tags: [video, workflow, studio-run, reference, remix, analysis, remotion]
---

# Reference Video Studio

Use when the user says "make something like this" and supplies a video, URL,
or existing project clip as inspiration. This is distinct from editing that
exact footage.

## Required Directors

Read these before production:

1. `skills/_shared/studio-production/production-contract.md`
2. `skills/_shared/studio-production/reference-analysis.md`
3. `skills/_shared/studio-production/taste-direction.md`
4. `skills/_shared/studio-production/audio-direction.md` when audio is used
5. `skills/_shared/studio-production/review-contract.md`
6. `skills/_shared/remotion-director-contract.md`

## Workflow

1. Start recipe `reference-video-studio` with guided approval unless the user
   explicitly preauthorized the whole run.
2. Analyze and, when relevant, transcribe the reference. Put the five-part
   analysis and the `keep/change` split into the brief.
3. Propose at least two original concepts with different hooks, structures,
   scene systems, and motion languages. State any capability gap honestly.
4. Lock whether the new piece is generated, source-led, or hybrid. Do not switch
   that choice later without invalidating the proposal.
5. Build the timed script and storyboard from observable reference principles,
   not copied shots or words.
6. For expensive work, make a representative sample before the full asset pass.
7. Build an editable Remotion composition, inspect the hook, representative
   body beat, and ending, then materialize and review the MP4.

## Completion

The run is complete only when the new video is recognizably inspired by the
reference's craft, clearly original in content and art direction, and delivered
with its editable source.
