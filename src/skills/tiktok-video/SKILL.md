---
name: tiktok-video
description: >
  Create and package TikTok-ready 9:16 videos with platform-aware placement,
  creator-native direction, optional speech-led captions, and editable Remotion delivery.
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
- Before completing Review or Delivery, read
  `skills/tiktok-video/references/delivery-qa.md`.
- For a substantial editable production, also read
  `skills/motion-design-video/SKILL.md`,
  `skills/_shared/studio-production/production-contract.md`, and
  `skills/_shared/remotion-director-contract.md`.

## Choose The Production Route

- Existing timeline or source footage normally calls for an editable Remotion
  composition with a deliberate hook, sound strategy, and native close.
- A direct generated-video route is appropriate only when the user actually
  wants newly generated provider footage and the result does not need precise
  captions, branding, multiple sources, or deterministic layout.
- TikTok does not imply narration. Choose among speech-led, source-sound-led,
  music-led, or concise editorial-text-led storytelling based on what the
  footage needs. Do not create wall-to-wall VO merely to justify subtitles.

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
- Preserve useful source sound and physical texture. A polished TikTok can
  still breathe; it need not narrate or decorate every second.
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

For process footage, write only the speech the pictures and source sound cannot
communicate as clearly. Before approving the Script, challenge every spoken
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
phone size.

## Compose And Deliver

- Deliver full-screen `1080 × 1920` for the standard high-resolution TikTok
  composition. Keep source footage full-bleed unless the concept deliberately
  authors another treatment.
- Keep the result editable. Use one visible caption host for each spoken cue,
  with highlights inside that host.
- Fit every cue inside its safe bounds at the settled final font metrics. Do not
  preserve a prose caption as one unbroken line when it needs an authored break,
  narrower measure, or smaller type to remain fully visible.
- Use the final VO master and its `transcribe_audio` word timing. Do not invent
  caption intervals or reuse timestamps from an earlier take.
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
