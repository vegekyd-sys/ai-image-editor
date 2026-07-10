---
name: content-repurpose
description: >
  Convert a long video, interview, webinar, livestream, or podcast into ranked
  short clips, audiograms, quote-led videos, and a coherent batch package.
allowed-tools: read_file studio_run analyze_video transcribe_audio analyze_image generate_image generate_audio generate_music run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "✂"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    defaultAspectRatio: "9:16"
    studioRunRecipe: "content-repurpose"
    studioRunProfile: "batch-source-led"
    sourceMediaRequired: true
    tags: [video, workflow, studio-run, clips, podcast, social, captions, remotion]
---

# Content Repurpose

Use for clip factories, podcast derivatives, webinar highlights, interview
cutdowns, and social packages. Source speech remains authoritative.

## Modes

- `clip-batch`: multiple ranked cuts from long-form video.
- `podcast-video`: audiogram, quote clip, caption-led video, or chapter companion.
- `campaign-pack`: several platform variants sharing one visual system.

## Workflow

1. Read `skills/_shared/studio-production/production-contract.md`, the shared
   audio, taste, and review contracts.
2. Start recipe `content-repurpose`; lock target platforms, clip count, aspect
   ratios, target lengths, and whether delivery is one proof or a batch.
3. Analyze and transcribe the source. Rank candidates by immediate hook,
   standalone context, useful/emotional payoff, speaker energy, and platform fit.
4. The proposal presents at least two packaging systems and an honest batch
   plan. The script artifact stores the selected timestamped segments.
5. Storyboard each deliverable with in/out points, crop, hook/title, caption
   behavior, speaker identity, and ending. Never begin or end accidentally in
   the middle of a sentence.
6. Keep typography and caption logic consistent across the batch while allowing
   content-specific hooks and accent treatments.
7. Build representative deliverables in Remotion. For a large batch, prove the
   shared system on the strongest clip before repeating it.
8. Review mobile readability, face/UI avoidance, source audio, clean boundaries,
   batch consistency, and target platform dimensions.

## Quality Bar

Every clip must make sense without the original episode and must preserve what
the speaker actually meant.
