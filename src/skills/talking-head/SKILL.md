---
name: talking-head
description: >
  Edit talking-head footage with transcript-led cuts, synced captions, B-roll,
  and highlights.
allowed-tools: read_file analyze_video transcribe_audio studio_run run_code write_file publish_draft preview_frame materialize_media generate_image generate_animation
metadata:
  makaron:
    icon: "✂"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: true
    sourceProject: "openmontage"
    sourceSkill: "talking-head"
    sourceKind: "pipeline"
    supportLevel: "adapted"
    adapterFamily: "video-workflow"
    canonicalSkill: "source-video-studio"
    studioRunRecipe: "talking-head"
    studioRunProfile: "source-led"
    defaultAspectRatio: "16:9"
    sourceMediaRequired: true
    inputHint: "A talking-head video with clear, audible speech"
    tags: [video, talking-head, transcript, asr, b-roll, highlights, remotion]
---

# Talking Head Editing

Deliver the finished video in the current project. Use your editorial judgment;
the goal is a confident, natural piece, not the maximum number of cuts, captions,
or effects. A direct composition and Studio Run are both valid. Pick one path and
stay with it unless it actually fails.

Before editing, read `skills/_shared/speech-clock.md` and
`skills/_shared/spoken-caption.md`. Follow the source-speech route and shared
caption contract. This Skill owns only the talking-head editorial decisions.

## Find the story, then cut it

Transcribe once with `transcribe_audio({ media_index })`; omit
`expected_sections` and reuse the saved word timing.

Understand the delivery and gestures, then make one coherent keep-range timeline.
Remove false starts, retakes, accidental
repetition, filler, hesitation, and pauses that drain momentum. Preserve meaning,
personality, emphasis, and the short breaths that make speech sound human.

Cut at semantic boundaries when possible. Use word boundaries for a precise
mistake only when the join stays natural; leave a small audio handle so words are
not clipped. Do not delete every ASR gap or mistake intentional repetition for a
stutter. The result should feel like the speaker delivered a stronger take.

For a TikTok/Douyin cut without a requested duration, choose the shortest
coherent argument that preserves the hook, core proof, and close. Do not keep
every intelligible example, use case, or aside merely because it can be cleaned
up.

## Make captions follow the voice

Build every caption from retained ASR words. Apply the Speech Clock keep-range
map and the shared Spoken Caption micro-cue contract; removed words never
appear. Keep punctuation light and let the speaker's delivery decide phrasing.
Shorten by splitting a kept thought into consecutive micro-cues, never by
summarizing or deleting words that remain audible. A long kept utterance and a
caption cue are different units.

For TikTok or Douyin, use `skills/tiktok-video/SKILL.md` for creator-native and
platform direction only; this Skill's source-speech route overrides TikTok's
generated-VO default. Place captions around the face and platform UI while
keeping the speaker visually dominant.

## Add visual support selectively

Keep A-roll dominant. Add B-roll, an example, a small diagram, product/UI proof,
or a brief mascot accent only where it makes an idea clearer or covers a hard
join. Keep source speech audible, mute incidental B-roll audio, and preserve the
captions. When the user explicitly asks for B-roll or information graphics,
include a few purposeful
moments selected by editorial judgment; do not silently omit the request.

## Compose and finish

- Keep cuts, captions, visual support, and source audio in one composition.
- Store only each keep range's source start and end. Derive its duration,
  cumulative output start, every caption position, and the composition total
  from that one range list; never hand-enter a separate `d`, caption clock, or
  animation duration.
- For multiple ranges from one source, use absolute `trimBefore` and `trimAfter`
  on each `<Video>` and add `data-editable-ignore`; later clips must not restart
  from source frame zero.
- Derive composition duration from the end of the final retained range, not the
  last caption or graphic.
- Review the opening, the ending, representative joins, and caption-heavy beats
  with sound at 1x. Confirm the final spoken line and its caption are present.
- If frame preview is unavailable, export first and review the MP4; do not stop
  before the requested delivery exists.
- Publish the editable composition and export a playable MP4. A bare fallback
  that drops requested captions or visual support is not finished.

Do not build new transcript tools, editing infrastructure, or a traditional
timeline UI for this task.
