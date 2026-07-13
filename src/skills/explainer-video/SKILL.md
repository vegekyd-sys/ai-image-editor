---
name: explainer-video
description: >
  Create a concise 30-90s narrated explainer video about a topic, product,
  feature, company, or process. Use Makaron's current Remotion composition
  runtime with design references, synced subtitles, voiceover, generated
  sound design, and optional generated media/sticker overlays.
allowed-tools: read_file studio_run run_code write_file preview_frame materialize_media list_voiceover_voices generate_voiceover transcribe_audio generate_audio generate_music generate_image analyze_image analyze_video
metadata:
  makaron:
    icon: "🎙️"
    color: "#8b5cf6"
    tipsEnabled: false
    builtIn: true
    studioRunRecipe: "explainer-video"
    studioRunProfile: "generated-explainer"
    sourceMediaRequired: false
    tags: [video, workflow, explainer, remotion, voiceover, subtitles, audio]
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
  screenshots, generated visual inserts, sticker overlays, music beds, sound
  effects, ambience, or mixed sound design

If the user explicitly asks for a provider-rendered cinematic video instead,
route to the video generation flow. Otherwise, build an editable Remotion
composition.

## Shared Remotion Director Contract First

Before planning the video, inspect the shared Remotion Director contract and
its local copy of `remotion-video-director`:

1. Read `skills/_shared/remotion-director-contract.md`.
2. Read `skills/_shared/remotion-video-director/SKILL.md`.
3. Read `skills/_shared/remotion-video-director/references/video-archetypes.md`.
4. Read `skills/_shared/remotion-video-director/references/remotion-patterns.md`.
5. Read `skills/_shared/remotion-video-director/references/component-library.md`.
6. Choose a creative direction, scene archetype set, emotional arc, pacing model,
   and layout contract before writing Remotion code.
7. Apply the contract as video direction: shot flow, frame hierarchy, timing,
   transition language, typography scale, audio attitude, and review criteria.
   Do not reduce it to a color palette or website design system.

This shared contract is required for all Makaron Remotion compositions. Do not
skip it because the topic sounds simple.

## Default Deliverable

- A published Remotion composition snapshot on the project timeline.
- Target duration: use the user's requested duration. If missing, make 60s.
- The requested duration is a hard contract. Do not extend the composition just
  because generated voiceover or music is longer. Rewrite, regenerate, trim, or
  fade audio to fit the requested duration.
- Aspect ratio: default 16:9 unless the user specifies mobile/social.
- Voiceover is part of this skill by default. Generate spoken narration with
  TTS unless the user explicitly says no voice, no audio, silent, muted, or
  text-only.
- Subtitles are part of this skill by default and must be visible near the
  bottom safe area.
- Sound design is part of the planning pass. Use `generate_audio` when music,
  ambient texture, UI sounds, transitions, or scene-specific sound effects would
  make the explanation clearer or more memorable. Use `generate_music` for
  background music beds or soundtrack-style requests; it uses Seed Audio.

## Direct Execution Rule

Do not stop at a script approval gate when the user says to make or test the
video directly. Write a compact production plan internally, then build and
publish the composition. Ask only if missing information would make the result
wrong or expensive.

## Production Flow

1. Start a `studio_run` before producing the brief. Use the user's explicit
   approval preference; when they preauthorize the full run, set
   `approval_policy: "auto"`. Lock duration, resolution, FPS, runtime, editable
   mode, narration, and subtitle promise in `delivery_promise`.
2. Read `prompts/remotion-composition.md` before the first `run_code` call.
3. Read the shared Remotion Director contract and required video-director
   reference files.
4. Create a compact creative brief: purpose, audience, core message, desired
   action, emotional arc, creative direction, audio strategy, and visual style.
   Persist it with `studio_run(operation: "put_artifact", stage: "brief")`.
5. Produce at least two genuinely different concepts and persist the selected
   proposal artifact. Do not continue if its Studio Run gate is awaiting approval.
6. Write and persist the timed script artifact.
7. Plan 6-8 scenes with exact time ranges that sum to the target duration.
8. Create a layout contract before writing code: one focal point per scene,
   readable text zones, subtitle-safe lower area, transition pattern, and the
   component/archetype used by each scene.
   Persist this as the storyboard artifact before generating assets.
9. Create a compact asset-and-audio cue sheet before generating media:
   for each scene, name the narration cue, sound cue, main visual layer, and
   whether it needs a sticker overlay, full generated image, generated video
   insert, or no generated media.
10. Write a speakable narration script. Keep it human and paced:
   about 120-145 English words per minute or 180-230 Chinese characters per
   minute.
11. Unless the user explicitly requested a silent/text-only video, call
   `list_voiceover_voices`, choose a fitting voice, then call
   `generate_voiceover`.
   Keep the narration short enough for the requested duration. If the generated
   voiceover is more than 10% longer than the requested video, regenerate a
   shorter script or trim/fade it; never change the video duration to match an
   overly long narration.
12. After `generate_voiceover`, call `transcribe_audio({ media_url: audioUrl })`
   on the returned public audio URL. Use the real ASR utterance/word timecodes
   for subtitle timing. In the first composition, write the project-specific
   subtitle renderer against `props.captions`; `run_code` automatically finds
   the latest project cue sheet, stores its `captionCuePath`, and injects the
   full cue array. This authoritative array is rehydrated after every render
   and patch, so treat it as read-only. Group phrases inside the renderer and
   derive or clamp animation windows from each cue's real duration; a word cue
   may span only a few frames. Long subtitles therefore do not consume model
   context. Do not `read_file` the cue sheet, manually convert its words,
   construct a second caption array, or add subtitles in a later patch.
13. Decide the audio layer:
   - Exact spoken narration -> `generate_voiceover`.
   - Prompt-first music bed, ambience, sound effects, UI blips, risers, impacts,
     or mixed sound design -> `generate_audio`.
   - Music / soundtrack / song-structure request -> `generate_music`; new music
     generation uses Seed Audio, not Suno.
14. Generate only the sticker/image assets chosen in the cue sheet. If an asset
   is an overlay, read `skills/sticker-maker/SKILL.md` first and make it a
   transparent PNG sticker instead of a hard-to-place rectangular image.
15. Persist the asset manifest only after every referenced asset is ready.
16. Build the video with `run_code({ runtime: "composition" })`.
17. Save the draft with `write_file({ fromLastRunCode: true, publish: false })`,
   and run the Composition draft gate before publishing or exporting. Calculate
   the exact expected frame count, confirm the scene timeline covers it, inspect
   every scene boundary plus the final visible frame with batched
   `preview_frame` calls, and confirm all required audio props contain real URLs.
   Patch the draft until this gate has no unresolved issue, then persist the
   composition artifact with its real design path and `draftGate` evidence.
18. Publish that exact gated draft once. Do not publish an older timeline
   snapshot or use its `media_index` as the export source.
19. Materialize the exact gated `design_path` once with `materialize_media`.
   Run container, visual-renderer, audio, and runtime-promise review against the
   actual MP4, then persist `review`.
20. Delivery is bookkeeping only: when review status is `pass`, persist the
   already-reviewed MP4 path and editable source path, approve if authorized,
   and report completion. Never patch, preview, publish, or render in Delivery.
   If a blocking issue is found after Composition, invalidate back to
   Composition and rerun its draft gate. A failed Studio Run artifact write is
   a blocker, not a warning.

## Audio And Sound Design Contract

Explainers should feel authored, not silent slide decks with narration pasted
on top. Consider an audio bed in every video unless the user explicitly asks for
silent, text-only, or voice-only output.

- Keep voiceover intelligible. Music and ambience should sit under narration,
  with lower volume and no busy vocals. Duck the music under spoken sections;
  use absolute narration timestamps for volume changes so drift cannot
  accumulate across scenes.
- Use `generate_audio` for prompt-first assets: subtle background music,
  transition whooshes, notification ticks, magical sparkles, classroom ambience,
  sci-fi hums, battle-arena impacts, UI sounds, or one mixed sound-design track.
- Prefer one cohesive 30-90s sound bed over many separate effects unless the
  story clearly benefits from timed spot effects.
- If the composition uses multiple audio tracks, keep them aligned to the same
  Remotion FPS/timebase as scenes and subtitles.
- Audio duration must fit the video duration. Fade or trim music/effects at the
  ending rather than extending the video.
- Do not use `generate_voiceover` for music or effects. Do not use Suno for new
  music generation.
- Audio Index markers such as `<<<audio_N>>>` are labels, not playable URLs.
  Use the returned public `audioUrl` directly in Remotion `<Audio src={...}>`
  props/code. Never put `<<<audio_N>>>` inside composition props or `<Audio>`.

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
- Render `props.captions` with a project-specific subtitle component written in
  the composition. The cue data is standardized; the visual treatment is not.
  Every injected cue contains both `{ word, startMs, endMs }` and rendering
  aliases `{ text, startFrame, endFrame }`, calculated from the composition FPS.
  Use one timing pair consistently; do not invent another cue shape.
  Choose phrase grouping, placement, typography, highlighting, and background
  treatment to suit the subject and art direction. Static scene labels or one
  caption per scene do not replace timed subtitles.
- Scene timing and subtitle cues must share the same FPS/timebase.
- Treat narration timestamps as edit decisions: reveal the visual evidence,
  label, stat, or action at the absolute moment the narration refers to it, not
  merely somewhere inside the same scene.
- The active subtitle should support the current visual idea. If ASR splits a
  sentence too finely, merge adjacent short cues without breaking timing.
- Do not let subtitles cover the primary subject, charts, timeline labels, or
  lower-third UI. Patch after `preview_frame` if needed.

## Generated Media And Sticker Inserts

Use generated assets when they improve the explainer. Do not make the whole
video a plain code-only slide deck.

- Decide asset placement before calling generation tools. A useful cue sheet
  looks like: `Scene -> narration beat -> sound beat -> base Remotion motion ->
  generated asset -> role -> entry/exit animation`.
- Prefer stickers for foreground insertions. Rectangular generated images are
  harder to compose cleanly unless they are meant to be full-screen hero art,
  framed product screenshots, or background plates.
- Generated images can be hero visuals, scene backgrounds, product-style
  illustrations, conceptual inserts, or visual examples. Use them when the image
  itself is the scene, not as a random decoration.
- Generated videos can be short 4-10s insert clips when real motion matters.
  Use them sparingly because they cost time and money.
- Sticker overlays are useful for transparent decorative/explanatory elements:
  icons, mascots, arrows, labels, spark effects, props, satellites, rockets, UI
  pointers, and visual emphasis.
- To create transparent overlays, read and follow
  `skills/sticker-maker/SKILL.md`, then place the resulting PNG URL in the
  Remotion composition with `<Img>`.
- Make sticker prompts composition-friendly: centered complete subject, clean
  edges, no text, no watermark, chroma-key background as required by the sticker
  workflow, and enough padding so motion does not crop the asset.
- Use stickers at decisive beats: hook reveal, concept transition, proof moment,
  recap/CTA. Avoid sprinkling stickers on every scene.
- Keep sticker count intentionally small for a 60s explainer: usually 1-3 strong
  recurring assets are better than many unrelated one-offs.
- Animate sticker overlays as part of the explanation: float in, orbit, point,
  stamp, connect two diagram nodes, or react to an audio hit. Do not leave them
  static unless the scene needs a calm anchor.
- For generated or uploaded timeline images, use the literal 1-based
  `<<<media_N>>>` marker in Remotion props/code. `run_code` resolves it before
  validation and rendering; never map Media Index N to the 0-based
  `ctx.snapshotImages[N]` array yourself.
- Generated assets must serve one of three roles: main subject, explanatory
  support, or tasteful decoration. Skip assets that are merely filler.
- Keep simultaneous media count low for mobile performance. Use one strong
  generated visual per scene rather than many small competing elements.

## Scene Cue Sheet Pattern

Before writing Remotion code, turn the plan into a short cue sheet:

- `Audio`: voiceover cue range, subtitle cue, music/SFX volume change or hit.
- `Base motion`: the Remotion-native diagram, timeline, chart, typography, or
  UI movement that carries the explanation.
- `Generated asset`: none, sticker PNG, full generated image, or short generated
  video insert.
- `Asset role`: main subject, explanatory support, or decoration.
- `Compositing`: where it enters, how it moves, how it avoids subtitles, and how
  it exits.

This keeps generated images from becoming awkward rectangular inserts and makes
audio, subtitles, Remotion motion, and stickers feel intentionally directed.

## Remotion Creative Direction

The composition should feel like a real explainer, not a static slide deck.

- Start from the shared Remotion Director contract and selected
  `remotion-video-director` creative direction: purpose,
  audience, core message, emotional arc, scene archetypes, pacing, audio attitude,
  and frame hierarchy.
- Use animated diagrams, timelines, callout labels, progress bars, map paths,
  chart reveals, zooms, parallax, and clean scene transitions.
- Do not default to webpage structures: hero sections, card grids, pricing-like
  panels, dense dashboard widgets, many pills, or static side-by-side blocks.
- Let time solve layout density: reveal one strong idea at a time instead of
  shrinking text or packing more UI into one frame.
- Keep the first working composition compact enough to render reliably. Prefer
  a clean 6-8 scene composition over an oversized one-shot code dump; patch
  polish after preview checks.
- In `run_code`, keep JavaScript/TypeScript syntax strict. All Chinese,
  Japanese, Korean, emoji, and display copy must be inside quoted strings.
  Use ASCII variable names and object keys unless they are quoted. Never leave
  raw display words in code, because that causes parser errors such as
  `Unexpected identifier`.
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

- The relevant `remotion-video-director` reference files were read and applied.
- The creative brief, scene plan, layout contract, and cue sheet were internally
  created before code.
- `animation.durationInSeconds` matches the requested duration.
- Voiceover and generated audio fit within that duration, or are trimmed/faded
  to fit.
- The composition is saved and published to the timeline.
- Voiceover is attached by default, unless the user explicitly requested a
  silent/text-only video.
- Generated audio/music/effects were considered, and used when they help the
  pacing, mood, or comprehension without masking narration.
- Subtitles are present, bottom-aligned, elegant, readable, and timed from TTS
  ASR when available.
- At least three `preview_frame` checks returned usable frames.
- Generated images/videos/stickers were used only when they made the
  explanation clearer or more memorable.
- The final reply states what was created and where to view it, concisely.
- A Studio Run exists with schema-valid artifacts for all eight stages.
- The Studio Run reaches `completed`; no stage remains invalidated, pending, or
  awaiting approval.
- The final review references the actual materialized MP4 and cannot pass while
  technical, visual, audio, or runtime-promise checks fail.
