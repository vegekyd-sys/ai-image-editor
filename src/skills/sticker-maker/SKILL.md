---
name: sticker-maker
description: >
  Generate and prepare transparent image assets for video composition. Creates a subject on a
  controlled chroma background, runs deterministic chroma keying and despill, and
  verifies the result on five backgrounds before handing the PNG to Remotion.
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
Visual Asset Bridge owns chroma removal, despill, caching, metadata, and QA.
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

## 2. Generate A Clean Chroma Source

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

## 3. Prepare The Cutout

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

`key_color` may be omitted when the canvas border is unambiguous. The tool:

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

## 4. Sticker Acceptance Gate

Inspect the QA image returned directly by `prepare_visual_asset`; do not approve
from `quality.status` alone. The contact sheet composites the PNG over black,
white, gray, Makaron-brand purple, and high-contrast cyan.

The asset passes only when all are true:

- the complete silhouette is present with visible margin on every side;
- hair, fingers, thin lines, glow edges, and antialiasing remain coherent;
- no green, magenta, or blue fringe is visible on any QA background;
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

## 5. Composition Handoff

Use the returned `preparedUrl` with Remotion `<Img>`. Use `subjectBox` and
`safeArea` as evidence when choosing scale and placement, not as a fixed layout.
The Composition remains free to choose background, lighting, motion,
typography, depth, and interaction. Store the full PreparedVisualAsset record in
the Studio Assets manifest, set that manifest asset's `path` to `preparedUrl`,
and keep its ID equal to `visualPlan.primaryAssetId` so later edits reuse the
same PNG.
After recovery, resolve it first with the same `asset_id` and no media source;
regenerate only when that lookup misses or QA requires a new source.
