# TikTok Platform Layout

Read this before placing titles, captions, logos, prices, disclaimers, or calls
to action. Platform chrome is a set of independent exclusion zones, not one
centered safe rectangle.

## Canvas

- Standard high-resolution composition: `1080 × 1920`.
- The `720 × 1280` coordinates below are placement references only. Never use
  them as the final Composition or export dimensions.
- Background footage, color, and nonessential atmosphere may bleed to every
  edge. Do not letterbox a vertical deliverable.
- Keep the primary face, hands, tool, or product readable while allowing
  nonessential motion to cross exclusion zones.

## Organic LTR Profile

At the `720 × 1280` reference size, avoid these independent UI holes:

- top app chrome: `x=0..720`, `y=0..80`;
- right interaction rail: `x=600..720`, `y=400..1040`;
- bottom-left metadata for a short post caption: `x=0..560`, `y=1100..1280`.

At `1080 × 1920`, those become:

- top app chrome: `y=0..120`;
- right interaction rail: `x=900..1080`, `y=600..1560`;
- bottom-left metadata: `x=0..840`, `y=1650..1920`.

If the post caption may occupy several lines or an interactive add-on is
present, use the more conservative bottom-left exclusion `x=0..840`,
`y=1560..1920` at 1080p. TikTok UI varies by device, locale, caption length,
and feature flags, so final platform preview remains authoritative.

## Auction In-Feed Standard LTR Profile

TikTok's June 2026 `720 × 1280` template has a non-rectangular usable region:

- broad content bounds: `x=80..640`, `y=160..840`;
- lower-right interaction exclusion: `x=520..640`, `y=560..840`.

At `1080 × 1920`, those become:

- broad content bounds: `x=120..960`, `y=240..1260`;
- lower-right exclusion: `x=780..960`, `y=840..1260`.

An upper title may use the full broad width because the right interaction rail
starts lower. Do not shrink every element into the intersection of all zones.

## Placement Review

1. Compare each essential element's actual bounding box with the matching
   profile and exclusion zones.
2. Position text scene by scene around the focal action; lower-middle is an
   option, not a fixed coordinate.
3. Keep intended line breaks inside the available lane and never accept visible
   `\\n` characters.
4. Do not imitate TikTok interface controls or bake a TikTok watermark into the
   creative.
5. RTL, TopView, anchors, cards, and other interactive add-ons require their
   own placement template; do not mirror this LTR profile by assumption.
