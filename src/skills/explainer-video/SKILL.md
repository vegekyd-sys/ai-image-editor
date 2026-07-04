---
name: explainer-video
description: >
  Create a concise 30-90s narrated explainer video about a topic, product,
  feature, company, or process. Use Makaron's current Remotion composition
  runtime with design references, synced subtitles, voiceover, and optional
  generated media/sticker overlays.
allowed-tools: read_file run_code write_file preview_frame list_voiceover_voices generate_voiceover transcribe_audio generate_music generate_image analyze_image analyze_video
metadata:
  makaron:
    icon: "🎙️"
    color: "#8b5cf6"
    tipsEnabled: false
    builtIn: true
    tags: [video, workflow, explainer, remotion, voiceover, subtitles]
---

# Explainer Video

You are making a polished, editable explainer video in Makaron's current
architecture. This is a local Remotion composition workflow, not a provider
long-video generation workflow and not the Open Montage workflow runtime.

## When To Use

Use this skill when the user asks for:

- "explainer video", "Explainer Video", "解释视频", "讲解视频"
- a 30-90 second topic, product, feature, company, or process explainer
- a narrated animated presentation with subtitles, diagrams, timelines, product
  screenshots, generated visual inserts, or sticker overlays

If the user explicitly asks for a provider-rendered cinematic video instead,
route to the video generation flow. Otherwise, build an editable Remotion
composition.

## Design Reference First

Before planning the video, inspect the local full copy of `awesome-design-md`:

1. Read `skills/explainer-video/references/awesome-design-md/README.md`.
2. Pick the closest brand/domain reference under
   `skills/explainer-video/references/awesome-design-md/design-md/*/DESIGN.md`.
   If an exact match exists, use it. For example, SpaceX should read
   `design-md/spacex/DESIGN.md`.
3. If there is no exact match, choose 1-2 relevant references and briefly
   internalize their typography, palette, motion density, layout rhythm, and
   do/don't guidance.
4. Apply the reference as visual direction, not as copy. Do not claim the video
   is official brand work unless the user says so.

This reference step is required. Do not skip it because the topic sounds simple.

## Default Deliverable

- A published Remotion composition snapshot on the project timeline.
- Target duration: use the user's requested duration. If missing, make 60s.
- Aspect ratio: default 16:9 unless the user specifies mobile/social.
- Voiceover is part of this skill by default. Generate spoken narration with
  TTS unless the user explicitly says no voice, no audio, silent, muted, or
  text-only.
- Subtitles are part of this skill by default and must be visible near the
  bottom safe area.
- Music: only call `generate_music` if the user asks for music or soundtrack.

## Direct Execution Rule

Do not stop at a script approval gate when the user says to make or test the
video directly. Write a compact production plan internally, then build and
publish the composition. Ask only if missing information would make the result
wrong or expensive.

## Production Flow

1. Read `prompts/remotion-composition.md` before the first `run_code` call.
2. Read the required design reference files from `awesome-design-md`.
3. Plan 6-8 scenes with exact time ranges that sum to the target duration.
4. Write a speakable narration script. Keep it human and paced:
   about 120-145 English words per minute or 180-230 Chinese characters per
   minute.
5. Unless the user explicitly requested a silent/text-only video, call
   `list_voiceover_voices`, choose a fitting voice, then call
   `generate_voiceover`.
6. After `generate_voiceover`, call `transcribe_audio({ media_url: audioUrl })`
   on the returned public audio URL. Use the real ASR utterance/word timecodes
   for subtitle timing. Do not rely only on estimated text length timing when
   ASR is available.
7. Build the video with `run_code({ runtime: "composition" })`.
8. Save the draft with `write_file({ fromLastRunCode: true, publish: false })`.
9. Verify at least three frames with `preview_frame`: early hook, middle
   explanation, and closing CTA/summary. Include subtitle readability in the
   check.
10. Patch if needed, then publish with
   `write_file({ fromLastRunCode: true, name: "explainer-video-..." })`.

## Subtitle Contract

Every explainer video must have subtitles unless the user explicitly declines.

- Render subtitles in the lower safe area, centered, with max width around
  78-86% of the canvas.
- Use a refined caption container: semi-transparent dark background, subtle
  border or shadow, comfortable horizontal padding, 1-2 lines max.
- Subtitles should enter elegantly: fade, slight rise, or type-on. Avoid noisy
  per-character effects that make reading harder.
- Subtitle cue timing must come from the TTS audio timeline when possible:
  use ASR from `transcribe_audio` after generating voiceover.
- Scene timing and subtitle cues must share the same FPS/timebase.
- The active subtitle should support the current visual idea. If ASR splits a
  sentence too finely, merge adjacent short cues without breaking timing.
- Do not let subtitles cover the primary subject, charts, timeline labels, or
  lower-third UI. Patch after `preview_frame` if needed.

## Generated Media And Sticker Inserts

Use generated assets when they improve the explainer. Do not make the whole
video a plain code-only slide deck.

- Generated images can be hero visuals, scene backgrounds, product-style
  illustrations, conceptual inserts, or visual examples.
- Generated videos can be short 4-10s insert clips when real motion matters.
  Use them sparingly because they cost time and money.
- Sticker overlays are useful for transparent decorative/explanatory elements:
  icons, mascots, arrows, labels, spark effects, props, satellites, rockets, UI
  pointers, and visual emphasis.
- To create transparent overlays, read and follow
  `skills/sticker-maker/SKILL.md`, then place the resulting PNG URL in the
  Remotion composition with `<Img>`.
- Generated assets must serve one of three roles: main subject, explanatory
  support, or tasteful decoration. Skip assets that are merely filler.
- Keep simultaneous media count low for mobile performance. Use one strong
  generated visual per scene rather than many small competing elements.

## Remotion Creative Direction

The composition should feel like a real explainer, not a static slide deck.

- Start from the selected `awesome-design-md` reference: palette, type scale,
  spacing, density, visual attitude, and restraint.
- Use animated diagrams, timelines, callout labels, progress bars, map paths,
  chart reveals, zooms, parallax, and clean scene transitions.
- Keep on-screen text short. Subtitles carry narration; scene text should carry
  structure.
- Use strong visual hierarchy: one main idea per scene, one supporting visual
  system, no crowded panels.
- If user media exists, reference it with `media_refs` and place it as footage,
  screenshots, still panels, or masked inserts.
- For factual topics, avoid pretending to have live research. Use stable,
  widely known facts or phrase uncertain details generically.

## 60s Structure Template

- 0-6s: Hook: define the topic and why it matters.
- 6-16s: Context: show the before/after or key problem.
- 16-28s: Mechanism: explain the core system in simple visual layers.
- 28-40s: Proof: timeline, metrics, comparison, or real-world example.
- 40-52s: Implication: what changes for users, industry, or the future.
- 52-60s: Recap: three takeaways and a clean ending.

## Completion Checklist

Before saying it is done:

- The relevant `awesome-design-md` reference was read and applied.
- `animation.durationInSeconds` matches the requested duration.
- The composition is saved and published to the timeline.
- Voiceover is attached by default, unless the user explicitly requested a
  silent/text-only video.
- Subtitles are present, bottom-aligned, elegant, readable, and timed from TTS
  ASR when available.
- At least three `preview_frame` checks returned usable frames.
- Generated images/videos/stickers were used only when they made the
  explanation clearer or more memorable.
- The final reply states what was created and where to view it, concisely.
