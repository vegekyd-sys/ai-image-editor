---
name: sticker-maker
description: >
  Generate, extract, and prepare transparent image assets for video composition. Prefers native
  GPT Image 2 alpha, falls back to controlled chroma keying when needed, and verifies the result
  on five backgrounds before handing the PNG to Remotion.
allowed-tools: generate_image analyze_image prepare_visual_asset
metadata:
  makaron:
    icon: "🩹"
    color: "#E040FB"
    tipsEnabled: false
    tags: [sticker, overlay, transparent, png, asset, workflow, visual-asset-bridge]
---

# Sticker Maker

Use this skill when a character, product, object, icon, or effect should become
a transparent foreground or midground asset in a video or editable
composition. Read `skills/_shared/visual-asset-bridge/SKILL.md` first.

The Agent decides what to generate and how it will be staged. The deterministic
Visual Asset Bridge owns native-alpha validation or chroma removal, cropping,
caching, metadata, and QA.
Do not write an ad hoc Sharp script and do not remove backgrounds inside the
Composition runtime.
When a Studio Storyboard selects `carrier: "cutout"`, set
`visualPlan.primaryAssetId` to the semantic `asset_id` used below. Assets cannot
advance without the matching PreparedVisualAsset record.

## 1. Decide The Asset Job

Before generation, state:

- scene and visual purpose;
- role: `hero`, `support`, or `decoration`;
- intended shot scale and pose;
- how it enters, moves, and relates to the Remotion background;
- why a transparent cutout is better than a full-frame plate or native graphic.

If these answers are weak, do not generate the asset.

## 2. Prefer Native Transparent Generation Or Extraction

For a new sticker, icon, character pose, product insert, reaction, particle,
foreground prop, or overlay, call:

```text
generate_image({
  editPrompt: "[specific subject, pose, expression, material, camera angle; full silhouette and padding]",
  background: "transparent"
})
```

For an uploaded/source image that needs background removal, pass it as the
literal `media_index` and use the same native-alpha contract. Describe what
must be preserved (identity, product geometry, typography, fine edges, glow)
rather than asking the model to redesign it. Do not route through a normal
opaque fallback.

Native-alpha requirements:

- one complete subject with generous transparent padding on every side;
- no floor, horizon, environmental shadow, border, sticker outline, or text
  unless the requested asset itself contains text;
- keep translucent materials, glow, hair, fur, fingers, and holes in the matte;
- use actual reference images when identity or product fidelity matters.

Then call `prepare_visual_asset({ mode: "cutout", ... })`. The bridge recognizes
native alpha, preserves it without re-keying, crops excess padding, records
`alphaSource: "native"`, and still produces the five-background QA sheet.

## 3. Chroma Fallback

Use controlled chroma only when native-alpha generation is unavailable or a
native result fails QA and a deterministic key source is more appropriate.

Default to a solid bright green background `#00ff00`. If the subject contains
important green material, choose solid magenta `#ff00ff`; if it contains both
green and magenta, choose solid blue `#0000ff`.

Generation prompt pattern:

```text
Create [specific subject, pose, expression, material, and camera angle] as one
complete isolated asset on a perfectly flat solid chroma background [HEX].
Keep the full silhouette inside the canvas with generous clear margin on every
side. No floor, horizon, cast shadow, vignette, gradient, scenery, text,
watermark, border, or additional object. Keep edge lighting controlled and do
not color the subject outline with the chroma color.
```

Requirements:

- one complete subject, clearly separated from all four edges;
- no crop, floor contact, environmental shadow, or background texture;
- no chroma-colored floor ellipse, drop shadow, reflected glow, or particles;
- no chroma-colored rim light;
- preserve reference identity, pose intent, and material detail;
- use the relevant reference image indices when identity matters.

If the generated source visibly violates these requirements, regenerate before
keying. Preparation cannot repair a cropped limb or a textured background.

## 4. Prepare The Cutout

Call:

```text
prepare_visual_asset({
  mode: "cutout",
  media_index: N,
  asset_id: "semantic-scene-asset-id",
  role: "hero | support | decoration",
  key_color: "#00ff00"
})
```

`key_color` is only for chroma fallback and may be omitted when the border is
unambiguous. The tool:

- preserves provider-authored native alpha without chroma keying or despill;
- removes key-like pixels connected to the canvas border plus enclosed high-confidence chroma pockets large enough to be background;
- preserves only tiny isolated same-color details; choose a different key color whenever the subject contains meaningful key-colored material;
- reconstructs and despills semi-transparent antialiased edges;
- emits a transparent PNG without overwriting the source;
- crops the PNG to the subject's transparent safety margin so Composition size
  describes the visible sticker rather than an empty chroma canvas;
- retains workspace URLs for the source, transparent result, and QA sheet;
- computes `subjectBox` and `safeArea`;
- caches by source bytes and preparation settings;
- produces a five-background QA sheet.

## 5. Sticker Acceptance Gate

Inspect the QA image returned directly by `prepare_visual_asset`; do not approve
from `quality.status` alone. The contact sheet composites the PNG over black,
white, gray, Makaron-brand purple, and high-contrast cyan.

The asset passes only when all are true:

- the complete silhouette is present with visible margin on every side;
- hair, fingers, thin lines, glow edges, and antialiasing remain coherent;
- no green, magenta, blue, white, or dark halo is visible on any QA background;
- white and pale subject details were not accidentally removed;
- meaningful subject details do not share the selected key color;
- `residualChromaRatio` stays below the QA threshold, including inside loops made by props, limbs, strokes, or glow effects;
- transparent areas contain no opaque islands or environmental shadow;
- `quality.status` is `pass` and `status` is `ready`.

If it fails:

- cropped or cluttered source -> regenerate with stronger isolation language;
- wrong key color -> prepare again with the explicit correct `key_color`;
- chroma-colored subject rim -> regenerate without chroma rim lighting;
- remaining spill -> regenerate a flatter, cleaner chroma source rather than
  hiding the asset at a tiny size.

## 6. Composition Handoff

Use the returned `preparedUrl` with Remotion `<Img>`. Use `subjectBox` and
`safeArea` as evidence when choosing scale and placement, not as a fixed layout.
The Composition remains free to choose background, lighting, motion,
typography, depth, and interaction. Store the full PreparedVisualAsset record in
the Studio Assets manifest, set that manifest asset's `path` to `preparedUrl`,
and keep its ID equal to `visualPlan.primaryAssetId` so later edits reuse the
same PNG.
Use the prepared PNG for reaction overlays, product callouts, mascot beats,
foreground props, particle/effect layers, transition accents, and reusable
picture-in-picture inserts. Animate it as a real scene participant with
position/scale/rotation/opacity; do not bake the QA background into the video.
After recovery, resolve it first with the same `asset_id` and no media source;
regenerate only when that lookup misses or QA requires a new source.
