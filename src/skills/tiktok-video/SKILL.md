---
name: tiktok-video
description: >
  Create and package TikTok-ready 9:16 videos while keeping captions, titles,
  logos, products, and calls to action clear of TikTok's top, bottom, and
  right-side interface zones. Includes placement and preview rules.
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

Use this Skill whenever the requested destination is TikTok, including organic
posts, Spark Ads, in-feed ads, captioned clips, product demos, UGC packaging,
and TikTok variants of a larger campaign.

## Production Route

- For a direct AI-generated clip up to 15 seconds, keep the direct video route
  unless the user also needs precise captions, titles, logos, or layout.
- Use editable Remotion packaging when the deliverable needs subtitles,
  kinetic text, branding, CTA, multiple clips, or deterministic placement.
- For a substantial editable production, read
  `skills/motion-design-video/SKILL.md`,
  `skills/_shared/studio-production/production-contract.md`, and
  `skills/_shared/remotion-director-contract.md` before composing.

## Canvas

- Deliver full-screen `9:16`; use `1080 × 1920` for the standard high-resolution
  Remotion canvas.
- Background footage, color, and nonessential atmosphere may bleed to every
  edge. Do not letterbox a vertical TikTok deliverable.
- Treat platform chrome as several independent exclusion zones. Do not derive
  one global center box by intersecting every zone.

## Choose the Placement Profile

- Organic post, unspecified TikTok post, UGC, or creator content: use the
  Organic LTR profile below, then verify in the current TikTok preview.
- Auction/Spark/Non-Spark In-Feed ad: use TikTok's official Auction In-Feed
  Standard LTR profile.
- Anchor, display card, TopView, RTL, search placement, or another add-on: use
  that placement's own template instead of either default profile.

## Organic LTR UI-Avoidance Profile

At the `720 × 1280` reference size, the full `x=0..720`, `y=0..1280` canvas is
available. There is no inner organic safe rectangle. Avoid only these
independent UI holes:

- top app chrome: `x=0..720`, `y=0..80`;
- right interaction rail: `x=600..720`, `y=400..1040`;
- bottom-left post metadata for a short caption: `x=0..560`, `y=1100..1280`.

Scaled to `1080 × 1920`, the top chrome is `y=0..120`, the right rail is
`x=900..1080`, `y=600..1560`, and bottom-left metadata is `x=0..840`,
`y=1650..1920`. Everything else is available for scene-specific design.

The shorter bottom exclusion is the default for posts with a compact account
caption. If the TikTok post caption may occupy three or four lines, or an
interactive add-on is present, use the conservative bottom-left exclusion
`x=0..560`, `y=1040..1280` (`x=0..840`, `y=1560..1920` at 1080p). TikTok's
official guidance says caption length and add-ons can shrink the usable area.

This is a product default, not an official fixed organic overlay. TikTok UI
varies by device, caption length, locale, and feature flags, so final app
preview is authoritative.

## Official Auction In-Feed Standard LTR Profile

TikTok's official June 2026 `720 × 1280` template has a non-rectangular black
usable region:

- broad bounds: `x=80..640`, `y=160..840` (`560 × 680`);
- lower-right interaction exclusion only: `x=520..640`, `y=560..840`.

At `1080 × 1920`, those become:

- broad bounds: `x=120..960`, `y=240..1260` (`840 × 1020`);
- lower-right exclusion: `x=780..960`, `y=840..1260`.

Therefore a title at the top may use the full `560px` reference width. A
subtitle extending below `y=560` must end at or before `x=520`. Never shrink
every element to `x=80..520`; that discards the clear upper-right area and
forces the whole design into an unnecessarily narrow center column.

## Placement Rules

1. Put subtitles, titles, logos, prices, product names, disclaimers, and CTA
   outside every exclusion zone. Review each element's actual bounding box;
   there is no single universal safe rect or centered design container.
2. Use the available lane instead of defaulting to a narrow central column.
   Upper titles may span almost the full broad width; lower subtitles should
   stay left of the interaction rail.
3. Keep the primary face or product readable in the safe region whenever
   reframing allows, while permitting hands, scenery, and motion to bleed out.
4. Use no more caption lines than can remain comfortably inside the safe region.
   Intended line breaks must render as real line breaks; never accept visible
   `\\n` characters in Preview or the exported MP4.
5. Render every subtitle cue exactly once. Use one text host with its background
   and border; never stack an editable mirror or second caption track over it.
6. Do not imitate the TikTok interface and do not bake a TikTok watermark into
   an ad creative.
7. RTL placements, TopView, anchors, download cards, and other interactive
   add-ons require their matching TikTok template. Do not mirror or reuse this
   LTR profile without checking the placement-specific official file.

## TikTok-Native Creative Grammar

Safe placement is necessary but it does not make a video feel native. For an
organic post or creator-style ad, the default should feel captured and edited
for the For You feed rather than resized from a brand film.

### Opening And Edit Rhythm

- Start on a human action, machine action, surprising result, or specific
  question. Do not spend the first second on a logo, establishing slate, or
  generic title card.
- State the content proposition in the first `3s`; make the first `3–6s` the
  strongest hook window. For a process video, show the transformation or its
  payoff before explaining every step.
- In the opening `3s`, prefer `2–4` distinct visual beats when the source
  supports them. After the hook, process footage commonly reads well at roughly
  `0.7–1.8s` per shot, with a longer hold only for a satisfying action or reveal.
  These are pacing defaults, not a mandate to cut across an unfinished action.
- Cut on action, contact, tool impact, material change, or a spoken emphasis.
  Use reframes, short punch-ins, match cuts, speed changes, and occasional
  freeze/hold moments when they clarify the process. Avoid a slideshow of equal
  durations and one identical centered crop for every source.
- Keep source footage full-bleed and tactile. Preserve useful original machine,
  tool, or handling sound under narration/music when available. Do not polish
  away all texture into a silent corporate montage.

### Text Roles

Author one coordinated text system with distinct jobs. Do not render every
piece of copy as the same lower-third component.

1. **Hook overlay:** one specific curiosity or payoff line, usually `4–9` words
   across one or two lines. At `1080 × 1920`, a typical hook is `88–132px`,
   heavy weight, compact line-height, and visible for about `0.8–2.0s`. It may
   sit in the clear upper or middle lane when that does not cover the subject.
2. **Spoken captions:** one coherent spoken thought at a time, usually no more
   than two readable lines. At `1080 × 1920`, start around `64–84px`, weight
   `700–900`, line-height `0.95–1.08`, with either a strong dark stroke/shadow or
   one compact opaque/translucent backing shape. Let the speaker's meaning and
   delivery determine when the caption turns over; do not optimize the track to
   a repeated word count or mechanical visual cadence.
3. **Beat labels:** optional `1–4` word step, reaction, or proof labels attached
   to the action they explain. Use at most one dominant label per scene and
   remove it when its beat ends; do not accumulate badges, cards, and labels.
4. **Close:** a short payoff, question, or CTA with an intentional final hold.
   Keep it native to the story instead of switching to a detached corporate
   end card unless the user explicitly asks for one.

### Caption Styling And Motion

- Treat the caption guidance below as an art-direction vocabulary, not a fixed
  caption template. The Agent owns the final font family, weight, casing,
  accent palette, outline or backing treatment, placement, phrase emphasis,
  and entrance motion for each video. Choose them from the footage, subject,
  brand, language, and scene geometry; vary them across concepts when that
  makes each cut feel authored. The numeric ranges are strong starting points,
  not a requirement to reuse one colorway or component in every TikTok.
- Use a bold rounded grotesk or similarly direct sans serif, not a thin
  editorial subtitle face. White text with a dark outline/shadow is the most
  neutral native baseline; choose one restrained accent color that comes from
  the subject or brand.
- Emphasize only the one or two words that carry the beat. A highlighted word
  may change accent color, gain a compact fill, or punch to about `1.06–1.14×`
  for `4–8` frames. Do not rainbow every word or run constant karaoke motion
  that competes with the footage.
- When a phrase is rendered as separate word spans for highlighting, preserve
  unmistakable visible word gaps in the exported frame. Prefer a wrapping flex
  or grid row with an explicit `columnGap` over text whitespace, `marginRight`,
  non-breaking-space spacer spans, or negative tracking: those can collapse in
  the export renderer. Per-word transforms must never turn `Precision is built`
  into `Precisionis built`. Inspect the densest highlighted phrase at final
  resolution, including while its longest word is at maximum emphasis. The
  visible gap must survive the scaled word's extra width; enlarge the gap or
  prefer color/weight emphasis without scale if it does not. Semantic timing
  can be correct while typography is still unreadable.
- Caption entrances should feel immediate: a short pop, upward settle, or
  cut-on beat over roughly `4–8` frames. Do not use slow fades, floaty webpage
  easing, or a large glass-panel lower third for ordinary speech.
- Position captions scene by scene around the focal action. Lower-middle is a
  useful default, not a fixed coordinate: move a cue upward or sideways when it
  covers hands, tools, faces, product detail, the bottom-left metadata, or the
  right interaction rail.
- Use exactly one visible caption host for the speech track. A word highlight
  belongs inside that host; never duplicate the same cue as both a subtitle and
  an editable mirror.
- Spoken-caption copy should normally be consecutive words actually spoken in
  the final VO. Do not paraphrase it into a different short slogan merely to
  make the caption punchier. Put editorial compression and extra copy in the
  separate hook-overlay or beat-label tracks. Omitting a hesitation or filler
  word is acceptable only when the remaining phrase stays faithful to the
  spoken meaning and its timing still comes from the retained spoken words.
  Prefer spoken contractions and natural sentence case; reserve ALL CAPS for
  the hook, a short step label, or a deliberate impact word.

### Meaning-First, VO-Grounded Phrase Captions

Short phrase captions make exact voice correspondence more important, not less.
Do not add another renderer or subtitle feature for this. Use the existing
`transcribe_audio` result and narration cue sheet as composition input:

1. Lock the final VO master first. Then call `transcribe_audio` with the approved
   Script sections and Composition FPS. Use its utterance and word timestamps
   as the authoritative speech clock; Script estimates, equal scene lengths,
   and manually invented cue intervals are not timing evidence.
2. Before placing any boundary, understand the complete utterance as speech:
   what the speaker is asserting, which words belong together, where the voice
   resolves or suspends an idea, and what rhetorical beat the delivery creates.
   Use the transcript and the audio together. Silence is evidence, but it is
   not automatically a boundary; a pause may still sit inside one thought.
3. Group consecutive timed words the way a strong human short-form editor would
   phrase the line. Each appearance should feel like a coherent piece of the
   speaker's thought when read on its own and should lead naturally into the
   next. Semantic and prosodic coherence outrank brevity. Word count and cue
   duration are not targets or quotas: a short cue is useful when the speaker
   intentionally lands an impact beat, while a longer phrase is better when its
   words form one readable idea.
4. Do not let visual rhythm fracture the language. For example,
   `The final decal | is small | but it seals the | system` should remain closer
   to `The final decal is small | but it seals the system`; and
   `A connector gets pressed | in then the frame...` should preserve the spoken
   relationships as `A connector gets pressed in | then the frame...`. These
   are illustrations of editorial judgment, not templates or parser rules.
5. Derive each phrase cue from the words it contains: start at the first
   included word's measured start and end at the last included word's measured
   end, converted through the same Composition FPS/timebase. A tiny legibility
   pad is allowed only inside real silence and must never make adjacent cues
   overlap. Do not stretch a phrase to fill its visual scene.
6. Drive in-caption emphasis from the same word data. If one word changes
   color, gains a backing shape, or punches in scale, trigger that emphasis at
   that word's measured start rather than at the phrase entrance or an
   arbitrary beat.
7. Keep editorial text roles separate. Hook overlays, beat labels, prices, and
   CTAs may be authored copy; they must not masquerade as the spoken-caption
   track. A viewer should be able to tell which short text is being said now
   and which text is editorial packaging.
8. If the VO file, approved wording, speaking pace, or take changes, rerun
   `transcribe_audio` and rebuild every affected phrase cue and word emphasis.
   Never reuse stale timestamps from a draft VO. Scene boundaries may respond
   to the measured speech, but must not replace its word-level timing.
9. Before composing the caption track, read the proposed cue sequence aloud in
   order and compare it with the final audio. Reconsider any boundary that
   makes a cue sound unfinished, attaches a word to the wrong thought, obscures
   the speaker's intended emphasis, or produces a repetitive chopping rhythm.
   Also look at every cue in isolation: if it only becomes intelligible after
   the next card appears, the boundary probably serves the layout rather than
   the speaker and should be reconsidered. This is an editorial warning, not a
   requirement that every cue be a formal written sentence.
   When more than one grouping is plausible, choose the one that best preserves
   intent and remains comfortable on the actual frame. Record the chosen cue
   text and word range in the Composition Plan so this judgment is inspectable.
10. Retain one `subtitleSyncEvidence` record per narrated Script section using
   `timingSource: "transcribe_audio"`. At the representative speaking frame,
   verify that the visible phrase is a contiguous span from the words sounding
   in that window and that the current picture belongs to the same beat.

The cue grouping remains editorial and therefore Agent-owned: the Agent decides
where a human editor would break the spoken line, which one or two words deserve
emphasis, and how the caption is art-directed. The measured first-word,
last-word, and emphasized-word timestamps are not creative guesses.

### Packaging Anti-Patterns

- No persistent full-width lower-third bar, news-style name strap, or corporate
  gradient footer for the whole video.
- No repeated centered card, rounded dashboard panel, glassmorphism stack, or
  template-like chapter slate between every source shot.
- No tiny subtitles sized like film captions, and no three-plus-line blocks.
- No constant logo lockup. If branding is required, weave a small mark or
  product cue into the footage and let the close carry the strongest lockup.
- Do not cover satisfying process detail with decoration. Text and stickers
  should explain, react to, or punctuate the visible action.

### Process And Behind-The-Scenes Default

For manufacturing, craft, food, packing, repair, or other satisfying process
footage, use this default arc when the brief does not provide a stronger one:

1. **Payoff tease (`0–2s`):** result-first shot or the most tactile action plus
   a concrete hook.
2. **Transformation (`2–15s` in a `20s` cut):** compact steps ordered by cause
   and effect, with action-matched cuts, concise spoken captions, and one or two
   step labels only where they add clarity.
3. **Proof/reveal (`15–19s`):** inspection, finish, comparison, or real use.
4. **Native close (`19–20s`):** one brief reaction, question, loop-back, or CTA;
   avoid a long logo-only tail.

For a `20s` English voiceover, start with roughly `35–50` conversational words
and tighten after the real audio timing is measured. Let the visuals carry
obvious process details instead of narrating every visible motion.

## Review Gate

Before publishing or materializing:

1. Preview the hook, the densest caption frame, and the closing CTA at the final
   `9:16` dimensions. For a multi-scene composition, also preview a stable
   midpoint from every scene and confirm its intended overlay is actually
   visible; three global spot checks are not enough to catch Sequence-local
   timing mistakes.
2. Compare each essential bounding box with the broad bounds and every scaled
   exclusion zone. Confirm that clear upper space remains usable instead of
   forcing unrelated elements into one center stack.
3. Confirm no visible `\\n`, clipped glyphs, duplicated subtitle glyphs, or
   subtitle/logo overlap with the top, bottom-left, or right-side UI zones.
4. If the post caption is long or the placement uses an interactive add-on,
   switch to the conservative bottom-left exclusion and use TikTok's final
   preview tool because TikTok states that the usable safe zone can shrink.
5. Run a native-feel pass in addition to collision checks: verify the first
   frame starts with meaningful action, the proposition is clear by `3s`, the
   hook and spoken captions have visibly different roles, captions change in
   short measured phrases, and no persistent corporate lower third or repeated
   card template has flattened the footage.
6. Review at least one caption entrance and one emphasized word in motion, not
   only as still frames. Confirm the pop/settle is brief, legible, and does not
   make the subject jump or disappear behind text.
7. For narrated work, audit the opening, a dense middle passage, and the close
   against the final VO: each spoken phrase must enter on its first included
   word, leave on its last included word, and any highlighted word must react on
   its own measured timestamp. If sync is wrong, regroup or retime from the
   existing `transcribe_audio` word data rather than eyeballing new intervals.
8. Inspect at least one multi-word highlighted phrase in the exported frame and
   confirm every word boundary remains visibly spaced. Fix the Agent-authored
   caption layout when per-word spans, scaling, or tracking make adjacent words
   touch; do not alter correct VO timestamps to repair a typography problem.

Official source baseline: TikTok for Business, “TikTok Auction In-Feed Ads,”
In-Feed Standard Version LTR downloadable overlay (updated June 2026), plus the
2026 Creative Starter Pack and Creative Center guidance on hook/body/close,
sound-on storytelling, captions, text overlays, transitions, and creator-native
production. Pacing and organic caption styling above are Makaron defaults
derived from those principles and current platform examples, not official fixed
TikTok templates.
