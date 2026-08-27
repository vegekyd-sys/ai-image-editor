---
name: explainer-video
description: >
  Create a narrated explainer video longer than 15s, typically 30-90s, about a
  topic, product, feature, company, or process. Use Makaron's current Remotion
  composition runtime with design references, synced subtitles, voiceover,
  generated sound design, and optional generated media/sticker overlays.
allowed-tools: read_file studio_run prepare_visual_asset run_code write_file publish_draft preview_frame materialize_media transcribe_audio generate_audio generate_image analyze_image analyze_video
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

Use this skill when the requested video is longer than 15 seconds and the user
asks for:

- "explainer video", "Explainer Video", "解释视频", "讲解视频"
- a 30-90 second topic, product, feature, company, or process explainer
- a narrated animated presentation with subtitles, diagrams, timelines, product
  screenshots, generated visual inserts, sticker overlays, music beds, sound
  effects, ambience, or mixed sound design

For a video up to and including 15 seconds, return to the normal Agent video
path in `prompts/animate.md`; the explainer label alone does not justify this
Studio workflow.

If the user explicitly asks for a provider-rendered cinematic video instead,
route to the video generation flow. Otherwise, build an editable Remotion
composition.

## Shared Remotion Director Contract First

Before planning the video, inspect the shared Remotion Director and Visual
Invention guidance:

1. Read `skills/_shared/remotion-director-contract.md`.
2. Read `skills/_shared/visual-direction/SKILL.md`.
3. Read `skills/_shared/studio-production/taste-direction.md`.
4. Read an optional `remotion-video-director` archetype, pattern, or component
   reference only when the chosen direction creates a concrete need for it.
5. Choose a creative direction, scene archetype set, emotional arc, pacing model,
   and layout contract before writing Remotion code.
6. Apply the contract as video direction: shot flow, frame hierarchy, timing,
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
- Voiceover and an instrumental score are part of this skill by default.
  Unless the user explicitly requests no audio, silent, muted, or text-only
  output, generate narration, continuous music, ambience, and meaningful SFX
  together once with Seed Audio `kind: "mixed"`. If the user requests no voice,
  keep music and sound design but omit narration. Use isolated `voiceover` only
  when the user explicitly requests voice-only or no music/supporting sound.
- Subtitles are part of this skill by default and are authored by the Agent as
  part of each scene's Composition direction.
- Sound design is part of the default planning pass. Give the score a narrative
  arc and include only ambience, UI sounds, transitions, and scene-specific
  effects that clarify or strengthen the explanation.

## Direct Execution Rule

Do not stop at a script approval gate when the user says to make or test the
video directly. Write a compact production plan internally, then build and
publish the composition. Ask only if missing information would make the result
wrong or expensive.

## Production Flow

1. Start a `studio_run` before producing the creative packet. Use the user's explicit
   approval preference; when they preauthorize the full run, set
   `approval_policy: "auto"`. Lock duration, resolution, FPS, runtime, editable
   mode, narration, and subtitle promise in `delivery_promise`. Leave
   `include_stage_schemas` false on the normal path.
2. Read `prompts/remotion-composition.md` before the first `run_code` call.
3. Read the shared Remotion Director contract, Visual Director, and
   `skills/_shared/studio-production/taste-direction.md`. Use an optional
   video-director reference only when the selected direction benefits from it.
4. In one uninterrupted creative pass, write a compact brief, at least two
   genuinely different concepts, select one direction, and write its complete
   timed narration. Every narrated section must include authored
   `onScreenText`; this is content direction, not a fixed caption renderer.
   Persist the whole decision once with
   `studio_run(operation: "put_creative_packet", creative_packet: ...)`.
   The harness will project separate Brief, Proposal, and Script artifacts into
   the eight-stage CUI. Do not recreate or resubmit those three JSON documents.
5. Keep the narration human and paced:
   about 120-145 English words per minute or 180-230 Chinese characters per
   minute.
6. Unless the user explicitly requested no audio, silent, muted, or text-only
   output, read
   `prompts/audio.md`, write a complete Voice Performance Brief, and lock the
   final audio architecture before generation. A narrated explainer includes
   continuous instrumental music and meaningful sound design by default: call
   `generate_audio({ kind: "mixed", ... })` exactly once and direct the entire
   synchronized soundtrack in that prompt. The mixed prompt must use the
   canonical performance-score blocks from `audio.md`: `[MUSIC]` defines a
   continuous audible backbone and its arc; `[VOICE]` gives every spoken line
   its own emotional action, turn, emphasis, breath, pause, or restraint;
   `[SFX]` places concrete effects in narrative order; `[MIX]` locks layer
   priority and ending behavior. Call
   `generate_audio({ kind: "voiceover", ... })` only when the user explicitly
   requests an isolated voice master with no music or supporting sound. The
   prompt must include the
   approved Script narration verbatim, the speaker/listener relationship,
   dramatic intent, emotional starting point, turning point, ending state,
   pace, pauses, breaths, emphasis, restraint, and behaviors to avoid.
   For `mixed`, keep speech intelligible while treating the score as a
   co-leading layer: its melody, rhythm, bass, and harmonic changes must remain
   identifiable under every spoken line, with no more than 1-2 dB of ducking
   and immediate recovery between lines. Direct ambience, meaningful effects,
   and the ending inside the same one-pass performance score. Avoid
   attenuation-heavy wording such as background, faint, sparse, or barely
   underneath. Never generate
   narration and supporting audio as separate Seed Audio assets.
   Keep the narration short enough for the requested duration. If the generated
   voiceover is more than 10% longer than the requested video, regenerate a
   shorter script or trim/fade it; never change the video duration to match an
   overly long narration.
7. After `generate_audio`, call
   `transcribe_audio({ media_url: audioUrl, expected_sections:
   Script.sections.filter(({ narration }) => narration.trim()).map(
   ({ id, narration }) => ({ id, text: narration })), fps })`
   when a single continuous voiceover is used. This returns and persists an
   authoritative narration cue sheet with measured section seconds and frame
   ranges. Use it to decide scene boundaries before Storyboard; planned Script
   ranges are not proof that generated speech lands in those ranges. This is
   timing data, not a caption renderer: subtitle wording, grouping, placement,
   typography, and motion remain inside the Composition.
8. Plan scenes with exact time ranges that sum to the target duration.
   Each narrated section must fit inside its linked visual scene using the real
   speech timing from step 7. Give every substantial scene a `visualPlan` with
   one dominant technical carrier, subject relationship, shot scale,
   depth/composition intent,
   background, and motion intent.
   For `cutout` and `edge-video`, set `primaryAssetId` to the exact semantic ID
   that will be passed to `prepare_visual_asset` and stored in Assets.
   Store one `narrationTimingEvidence` record per narrated Script section in
   Storyboard. Studio Run rejects Storyboard before asset generation when real
   narration starts before or ends after its linked scene.
9. Create a layout contract before writing code: frame hierarchy, readable text
   and subject-avoidance zones, transition pattern, and the component/archetype
   used by each scene. Persist this as the storyboard artifact before generating
   visual assets.
10. Create a compact asset-and-audio cue sheet before generating remaining
   media: for each scene, name the real narration range, sound cue, main visual
   layer, and whether its carrier is native, a full plate, a prepared cutout,
   or an edge-matched generated video. If cutout or edge-video is selected,
   read the Visual Asset Bridge and call `prepare_visual_asset` during Assets.
11. Do not add a second generated audio layer after step 6. The audio decision
   is already locked:
   - Isolated standalone narration -> one `voiceover` generation.
   - Voice/dialogue plus any music, soundtrack, ambience, UI blip, riser,
     impact, or SFX -> one `mixed` generation.
   - A truly separate non-speech asset requested by the user -> the matching
     `music` or `sound_design` generation.
12. Generate only the sticker/image assets chosen in the cue sheet. If an asset
   is an overlay, read `skills/sticker-maker/SKILL.md` first and make it a
   transparent PNG sticker instead of a hard-to-place rectangular image.
13. Persist the asset manifest only after every referenced asset is ready.
   Unless the user explicitly opted out of audio, voiceover and music must be
   present in this manifest; do not close Assets before generating them.
14. Build the video with `run_code({ runtime: "composition" })`.
15. Use the durable autosaved `design_path` returned by `run_code` or the
   numbered composition workspace, and run the Composition draft gate before
   publishing or exporting. Calculate
   the exact expected frame count, confirm the scene timeline covers it, inspect
   every scene boundary plus the final visible frame with batched
   `preview_frame` calls, and confirm all required audio props contain real URLs.
   For every narrated Script section, add exactly one `subtitleSyncEvidence`
   record that reuses its Storyboard narration range and links the Script
   section, Storyboard scene, real narration range,
   visual range, representative speaking frame, timing source, and the exact
   `subtitleText` authored in the Composition at that frame. It may preserve
   the spoken line or use concise `onScreenText` authored for that same Script
   section; do not force every scene to display a verbatim transcript. It must
   not borrow unrelated copy from another beat. Patch the draft until
   this gate has no unresolved issue, then persist the composition artifact
   with its real design path and evidence. Studio Run cross-checks timing and
   semantic links against the persisted Script and Storyboard. Do not duplicate
   already-rendered subtitle strings into props or editables merely to satisfy
   metadata inspection; actual subtitle visibility and picture alignment are
   verified from the representative Composition preview frames before export.
16. Review means fixing the Remotion source itself. Keep using `preview_frame`
   and `run_code` patch mode on the exact draft until visual, timing, subtitle,
   audio, transition, and ending issues are resolved. Do not author a separate
   Review JSON artifact.
17. Publish that exact gated draft once with
   `publish_draft({ design_path: "<exact-gated-path>" })`. Do not publish an
   older timeline snapshot or use its `media_index` as the export source.
18. Materialize the exact gated `design_path` once with
   `materialize_media({ design_path })`. Studio Run selects the locked source
   resolution automatically and returns after durable queue submission. When
   the final MP4 is ready, the worker projects both Review and Delivery UI
   states. Do not call `studio_run` to persist Review or Delivery, and do not
   start another preview/review loop after materialization is queued.
   A failed Studio Run artifact write or materialization is a blocker, not a
   warning.

## Audio And Sound Design Contract

Explainers should feel authored, not silent slide decks with narration pasted
on top. Use a unified audio bed in every narrated video unless the user
explicitly asks for silent, text-only, or voice-only output.

- Keep voiceover intelligible while the instrumental score remains clearly
  audible as a co-leading layer. Keep ambience lower and avoid busy vocals.
  Duck music by no more than 1-2 dB under spoken sections; use absolute
  narration timestamps for volume changes so drift cannot accumulate across
  scenes.
- For every narrated explainer, put continuous instrumental music, transition
  whooshes, notification ticks, ambience, and other meaningful supporting
  sounds into the same one-pass `mixed` prompt unless the user explicitly opts
  out of music or supporting sound.
- Use the V3 performance-score shape from `audio.md`: `[MUSIC]`, `[VOICE]`,
  `[SFX]`, and `[MIX]`. Give each spoken line its own emotional direction,
  rather than one generic mood for the narrator.
- Make music a co-leading score rather than background filler. Keep its motif,
  beat, bass, and harmony perceptible under every line; duck no more than
  1-2 dB and shorten narration before sacrificing music.
- Prefer one cohesive 30-90s unified soundtrack. Do not create separate
  voiceover/music/effect generations for one final audio track.
- When an intro, interlude, or outro matters, shorten the narration enough to
  reserve real speech-free time. Prompt timestamps express order and intent,
  not frame-accurate truth; only the measured ASR cue sheet may drive Remotion.
- Audio duration must fit the video duration. Fade or trim music/effects at the
  ending rather than extending the video.
- Use the `kind` field rather than searching for separate voiceover or music
  tools. All new standalone audio generation uses Seed Audio.
- Audio Index markers such as `<<<audio_N>>>` are labels, not playable URLs.
  Use the returned public `audioUrl` directly in Remotion `<Audio src={...}>`
  props/code. Never put `<<<audio_N>>>` inside composition props or `<Audio>`.

## Subtitles As Composition

Every explainer video must have subtitles unless the user explicitly declines.

- Write subtitle text, timing data, JSX, and animation in the same composition
  as the scenes they support. There is no required prop name, cue shape,
  placement, container, or shared overlay.
- Treat subtitles as part of the visual direction. A scene may use restrained
  dialogue captions, kinetic typography, integrated labels, or another readable
  treatment that fits its subject and composition.
- For ordinary spoken captions, default to the lower safe area, centered, with
  a maximum width around 78-86% of the canvas. Depart from this baseline only
  when an intentional kinetic or integrated treatment better serves the scene.
- The default spoken-caption treatment should be refined and readable: a
  semi-transparent dark background, subtle border or shadow, comfortable
  horizontal padding, and no more than 1-2 lines. Implement it directly in the
  scene Composition; do not introduce a shared caption renderer.
- Bring captions in with a restrained fade, slight rise, or readable type-on.
  Avoid noisy per-character effects that make narration harder to follow.
- Use the narration script and the persisted `transcribe_audio` narration cue
  sheet as source material. For narrated work, its measured ranges are
  authoritative, and scene timing plus subtitle cues must share the same
  Remotion FPS/timebase. Do not copy raw ASR output blindly; decide phrase
  boundaries and timing as an editor. Merge adjacent short cues when ASR splits
  a sentence too finely, without breaking the original timing.
- The displayed phrase may be a faithful spoken caption or concise kinetic copy
  authored in the active Script section. Keep it semantically local to that
  picture and narration beat; visual freedom is not permission to show generic
  or next-scene copy.
- At representative speaking frames, require a three-way semantic match between
  the visible subtitle or kinetic phrase, the current picture/action, and the
  narration actually sounding at that frame. A readable phrase that describes
  the previous or next scene is still out of sync.
- Check representative speaking frames with `preview_frame` for readability,
  synchronization, subject occlusion, and visual coherence before publishing.
  Captions must not cover the primary subject, charts, timeline labels, or
  lower-third UI; patch their placement or the scene layout when they collide.
- In the Composition review loop, inspect every `subtitleSyncEvidence`
  representative frame and compare its authored phrase, visible non-text
  subject/action, and active narration beat. Patch the Remotion source when the
  three do not align; do not create a second subtitle evidence document.
- `subtitleSyncEvidence` records only editorial timing and cross-artifact links.
  They do not choose subtitle text styling, placement, grouping, JSX, or motion.

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
- Generated videos can be short 4-10s hero clips when real motion matters. For
  an inset clip, generate quiet edges close to the intended background and use
  `prepare_visual_asset({ mode: "edge-video" })` before Composition. Otherwise
  use it as a full-frame plate.
- Sticker overlays are useful for transparent decorative/explanatory elements:
  icons, mascots, arrows, labels, spark effects, props, satellites, rockets, UI
  pointers, and visual emphasis.
- To create transparent overlays, read and follow
  `skills/sticker-maker/SKILL.md`, then place the resulting PNG URL in the
  Remotion composition with `<Img>`.
- Make sticker prompts composition-friendly: centered complete subject, clean
  edges, no text, no watermark, chroma-key background as required by the sticker
  workflow, and enough padding so motion does not crop the asset.
- Use stickers where they carry the visual idea: hook reveal, concept transition,
  proof moment, recurring character performance, recap, or CTA.
- Prefer a coherent recurring asset system over unrelated one-offs. There is no
  fixed sticker quota; each asset must pass the Visual Director's job gate.
- Animate sticker overlays as part of the explanation: float in, orbit, point,
  stamp, connect two diagram nodes, or react to an audio hit. Do not leave them
  static unless the scene needs a calm anchor.
- For generated or uploaded timeline images, use the literal 1-based
  `<<<media_N>>>` marker in Remotion props/code. `run_code` resolves it before
  validation and rendering; never map Media Index N to the 0-based
  `ctx.snapshotImages[N]` array yourself.
- Generated assets must serve one of three roles: main subject, explanatory
  support, or tasteful decoration. Skip assets that are merely filler.

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
- Use time to stage, transform, and reveal the composition instead of flattening
  every element into one static layout.
- In `run_code`, keep JavaScript/TypeScript syntax strict. All Chinese,
  Japanese, Korean, emoji, and display copy must be inside quoted strings.
  Use ASCII variable names and object keys unless they are quoted. Never leave
  raw display words in code, because that causes parser errors such as
  `Unexpected identifier`.
- Keep on-screen text intentional. Spoken captions may carry narration, while
  concise kinetic or integrated text may carry the active scene beat.
- Design the frame hierarchy and visual density for the chosen subject and
  creative direction.
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

- The Visual Invention Pass was available during Storyboard and Composition;
  optional reference files were used only when relevant to the selected direction.
- The creative brief, scene plan, layout contract, and cue sheet were internally
  created before code.
- `animation.durationInSeconds` matches the requested duration.
- Voiceover and generated audio fit within that duration, or are trimmed/faded
  to fit.
- The composition is saved and published to the timeline.
- Unless the user explicitly opted out, the explainer contains one generated
  unified soundtrack with voiceover, continuous instrumental music, ambience,
  and meaningful effects.
- Subtitles are present, readable, synchronized to the narration, and composed
  by the Agent in a treatment appropriate to each scene. Ordinary spoken
  captions use the polished lower-safe-area baseline; intentional kinetic or
  integrated text may depart from it. No fixed cue schema or shared caption
  renderer is required.
- At least three `preview_frame` checks returned usable frames.
- Generated images/videos/stickers were used only when they made the
  explanation clearer or more memorable.
- The final reply states what was created and where to view it, concisely.
- A Studio Run exists with schema-valid Agent-authored artifacts through
  Composition; Review and Delivery are system-projected from materialization.
- The Studio Run reaches `completed`; no stage remains invalidated, pending, or
  awaiting approval.
- The final MP4 is materialized from the exact reviewed Composition design path.
