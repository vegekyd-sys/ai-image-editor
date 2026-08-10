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

Official ad source baseline: TikTok for Business, “TikTok Auction In-Feed Ads,”
In-Feed Standard Version LTR downloadable overlay, article updated June 2026.
