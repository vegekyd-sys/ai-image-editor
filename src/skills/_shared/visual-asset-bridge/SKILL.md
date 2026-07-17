# Visual Asset Bridge

Read this only after Visual Director chooses `cutout` or `edge-video` for a
scene. The bridge standardizes media quality and metadata; it never chooses the
composition, typography, animation, subtitle style, or final renderer.

## Supported First-Phase Modes

- `cutout`: transparent PNG images prepared from generated or supplied images.
- `edge-video`: ordinary opaque videos whose quiet border colors are designed
  to blend into a matching Remotion background.

Transparent video is intentionally unsupported.

## Tool Contract

Call `prepare_visual_asset` with the literal Media Index or public source URL.
The tool preserves the source, writes a cached prepared asset, performs quality
checks, and returns a `PreparedVisualAsset` record.

Every record includes a workspace copy of the source, the prepared media, and
the QA contact sheet. Later edits should resolve the record by `assetId`,
`sourceSnapshotId`, and `cacheKey`; Media Index is only the turn-time selector.
The bridge also writes the latest record to
`<project-id>/visual-assets/by-id/<assetId>.json`. After a stream recovery or a
new Agent attempt, call `prepare_visual_asset` with `mode` and `asset_id` but no
media source before generating anything again. A cache hit returns the prepared
asset and QA sheet without repeating generation or keying.

For `cutout`, provide `key_color` only when auto-detection would be ambiguous.
The tool removes only key-colored regions connected to the image border, so an
isolated green detail inside a subject is preserved. It also despills edge
color, crops the prepared PNG to a small transparent safety margin around the
subject while preserving the original source, computes the resulting subject
box and safe area, and renders a five-background QA sheet.

For `edge-video`, provide the intended `target_background`. Generate the clip
with low-detail, low-motion edges in that color family and keep the subject away
from the boundary. The tool samples the clip over time, measures edge color,
detail, and temporal drift, and returns an integration recommendation. It does
not fake transparency or force a shared video-window component.

## Composition Handoff

- Set the Storyboard `visualPlan.primaryAssetId`, Bridge `asset_id`, and Assets
  manifest ID to the same semantic value. Store the full returned record in
  `prepared` and set the manifest path to `preparedUrl`; Studio Run rejects
  ad hoc cutouts and edge-video proxies.
- Use `preparedUrl` as the media source.
- Use `subjectBox` and `safeArea` as placement evidence, not fixed layout.
- For edge video, build the Remotion background from `targetBackground` and
  `edgePalette`; use the returned feather recommendation only when it improves
  the chosen composition.
- If quality is `revise` or `fail`, inspect the contact sheet and regenerate or
  reprepare the source. Do not hide a bad edge with a tiny asset.
- Reuse the same `cacheKey` output for later Composition changes.
