---
name: tiktok-video
description: >
  Create and package TikTok-ready 9:16 videos with platform-aware placement,
  creator-native direction, synchronized VO/BGM captions, and editable Remotion delivery.
allowed-tools: read_file studio_run prepare_visual_asset analyze_video analyze_image transcribe_audio generate_image generate_animation generate_audio run_code write_file preview_frame materialize_media
metadata:
  makaron:
    icon: "▯"
    color: "#ff5c72"
    tipsEnabled: false
    builtIn: true
    defaultAspectRatio: "9:16"
    sourceMediaRequired: false
    tags: [video, tiktok, vertical, social, captions, safe-zone, remotion]
---

# TikTok Video

Use this Skill whenever the destination is TikTok or Douyin, including organic
posts, creator-style ads, process edits, product demos, UGC packaging, and
TikTok variants of a larger campaign.

## Read The Conditional References

- Before laying out any text, read
  `skills/tiktok-video/references/platform-layout.md`.
- If the final piece contains narration or useful source speech, read
  `skills/tiktok-video/references/caption-direction.md` before writing the
  Script and again before composing the caption track.
- For the default VO-plus-BGM soundtrack and its shared timing contract, read
  `skills/tiktok-video/references/audio-sync.md` before writing the Script.
- Before choosing Composition dimensions or writing the Composition, read
  `skills/tiktok-video/references/delivery-qa.md`; read it again before Review
  or Delivery.
- For a substantial editable production, also read
  `skills/motion-design-video/SKILL.md`,
  `skills/_shared/studio-production/production-contract.md`, and
  `skills/_shared/remotion-director-contract.md`.

## Choose The Production Route

- Existing timeline or source footage normally calls for an editable Remotion
  composition with a deliberate hook, sound strategy, and native close.
- When the finished piece depends on authored captions, semantic keyword
  emphasis, or branded text motion, keep that packaging in the editable
  Remotion Composition. FFmpeg may normalize or trim source media, but a
  missing `drawtext` filter is not permission to downgrade the final captions
  to generic ASS subtitles or another renderer-owned fallback.
- A direct generated-video route is appropriate only when the user actually
  wants newly generated provider footage and the result does not need precise
  captions, branding, multiple sources, or deterministic layout.
- Unless the user explicitly asks for source sound, silence, music-only, or
  another audio treatment, a source-footage TikTok defaults to muted clip audio
  plus one finished soundtrack containing VO and instrumental BGM. This does
  not require wall-to-wall narration; keep useful BGM-led breathing room.

## Direct The Footage

An underspecified TikTok request is an invitation to direct. Inspect the whole
source set, propose genuinely different creator-native concepts, choose one
emotional engine or point of view, and commit to it. The result may be playful,
tactile, surprising, premium, intimate, urgent, quiet, or something else the
material supports; the choice must be visible in the final frames.

- Search for the strongest proof, reveal, reaction, human gesture, or tactile
  payoff before accepting source order as story order. A finished result may
  open and close the piece as a bookend.
- Begin with meaningful action, a result, or a specific question. Make the
  proposition clear in the first few seconds without spending the opening on a
  logo or generic slate.
- Cut on action, contact, material change, tool impact, or spoken emphasis.
  Reframes, freezes, speed changes, match cuts, or longer satisfying holds are
  choices, not a mandatory checklist.
- Treat source clips as visual material by default and mute their embedded
  audio. If the user explicitly wants real ambience or a source-sound moment,
  preserve it as a deliberate exception rather than letting every clip leak
  into the VO/BGM mix.
- Turn the selected proposal into a small set of signature moves and
  scene-specific promises, then implement them. A rich Storyboard must not
  collapse into one reusable caption plus one reusable step label.

## Keep Text Roles Distinct

Use only the roles the chosen concept needs:

- **Hook:** one clear curiosity, payoff, or point of view.
- **Spoken captions:** the part of the final speech currently being said.
- **Beat labels:** optional short reactions, proof labels, or step markers.
- **Close:** a brief payoff, question, loop-back, or CTA.

Do not render every role as the same lower-third component. One primary text
idea per beat is usually stronger than stacked hook, caption, label, badge, and
progress decoration.

## Write Less, Say Something

For process footage, write only the speech the pictures cannot communicate as
clearly. Before approving the Script, challenge every spoken
line with a silent-viewing test: if the action already says it, remove the line
or compress it to a sharper observation.

Unless the user explicitly asks for continuous narration, a sequence of full
sentences covering nearly every scene is an over-written cut. Intentional
speech-free beats are valid. When speech is used, preserve coherent thoughts
rather than chopping language into mechanical word-count cards; cue grouping
remains an editorial judgment grounded in measured word timing.

## Give Each Video Its Own Text Voice

Typography and caption packaging belong to the current concept, not to the
Skill itself.

- There is no default font family, black subtitle rectangle, left vertical
  rule, lower-left anchor, accent color, or pop animation.
- Bold condensed all-caps is one possible voice, not a synonym for TikTok.
  Match the type character to the footage: human, playful, tactile, technical,
  premium, quiet, or another defensible direction.
- Text-only type, a restrained outline, selective word blocks, an authored
  shape, or no spoken-caption track at all can each be right.
- Repeating a successful video's dark plaque, colored rail, font combination,
  placement, and entrance across unrelated footage is a failed art-direction
  pass, even when every element remains readable.
- Derive motion from the action and verbal beat. A clean cut, held phrase, mask
  reveal, tracking change, camera-attached label, word reaction, or brief settle
  may fit. Repeating one entrance is valid only when the repetition is an
  intentional part of the concept, not the easiest reusable implementation.

When speech is present, choose one or two meaningful words or a compact phrase
inside the spoken cue for visible emphasis. A colored rail, scene label, or a
boolean that recolors the whole sentence does not count as semantic keyword
emphasis. The Agent owns the visual method; the emphasis must remain visible at
phone size. Styling may wrap the chosen substring, but the flattened visible
caption must still contain the complete cue text exactly once.

## Compose And Deliver

- Deliver full-screen `1080 × 1920` for the standard high-resolution TikTok
  composition. The `720 × 1280` placement references are not final canvas or
  export dimensions. Keep footage full-bleed unless the concept says otherwise.
- Keep the result editable. Use one visible caption host for each spoken cue,
  with highlights inside that host.
- Fit every cue inside its safe bounds at the settled final font metrics. Do not
  preserve a prose caption as one unbroken line when it needs an authored break,
  narrower measure, or smaller type to remain fully visible.
- Use the final narration-containing audio master and its `transcribe_audio`
  word timing. Do not invent caption intervals or reuse timestamps from an
  earlier take.
- Persist that cue sheet as one data source and derive spoken-caption
  Sequences, word emphasis, and linked visual ranges from it. Do not manually
  retype a second schedule in JSX, FFmpeg arguments, or subtitle files.
- For generated narration, `explicit-audio-placement` and Script estimates are
  not ASR fallbacks. If measured transcription remains unavailable after one
  retry, preserve the work and stop before narrated Composition or Delivery.
- Inspect every measured cue rather than trusting only the aggregate pass flag.
  A take with a dropped final meaningful word or clipped clause is not the final
  master: shorten or clarify that VO line and regenerate it before Storyboard.
- Use that same measured cue sheet for captions, visual emphasis, and linked
  scene ranges. Script estimates and BGM beats are not speech-sync evidence.
- Review the selected concept against the rendered contact sheet. If the frames
  are more generic than the proposal, repair the Composition.
- Resolve any closing phrase or CTA before the timeline ends. Review both the
  final visible frame and the preceding half-second; an unfinished close is not
  an intentional loop unless the concept clearly completes it elsewhere.
- The settled-font Preview is the Agent's composition gate. Studio MP4 export
  finishes asynchronously, so batch, CLI, or later-turn acceptance must inspect
  the encoded result rather than pretending the same Agent turn reviewed bytes
  that did not exist yet. A clean Player does not waive a later export-only
  collision, rewrap, or overlap.
- Finish the same valid Studio workflow. Do not bypass a persistence or Review
  failure by publishing a private draft from another run, and do not substitute
  a `fast_720p` recovery export for the standard final.

Official source baseline: TikTok for Business, “TikTok Auction In-Feed Ads,”
In-Feed Standard Version LTR downloadable overlay (updated June 2026), plus the
2026 Creative Starter Pack and Creative Center guidance on hook/body/close,
sound, safe zones, and platform-native creative.
