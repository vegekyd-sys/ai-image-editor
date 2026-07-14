# Remotion Director Contract

Use this contract for every editable Remotion composition, including motion
graphics, social-video packaging, explainer videos, product demos, timeline
splices, subtitles, overlays, title cards, and patchable composition drafts.

## Director Layer vs Composition Layer

The director layer decides what the viewer experiences over time. It defines:

- purpose, audience, core message, and desired action
- emotional arc and pacing
- scene order, scene duration, and transition language
- the focal subject in each scene
- how text, footage, generated assets, subtitles, and audio relate to each other
- what should be verified before publishing

The Remotion composition layer implements that direction. It defines:

- `function Composition(props)` and helper components
- `width`, `height`, `fps`, and `animation.durationInSeconds`
- `<Sequence>` timing, `<Video>` / `<OffthreadVideo>` / `<Img>` / `<Audio>` usage
- editable `props`, `data-editable`, and `editables`
- frame-driven animation with `useCurrentFrame()`, `interpolate()`, `spring()`, and `Easing`
- preview/publish behavior through `preview_frame` and `write_file`

Do not let the implementation layer invent the creative structure by accident.
Plan the video experience first, then write the composition.

## Required References

Before creating a new Remotion composition, or making a major visual/timing
patch to an existing one, read:

1. `skills/_shared/remotion-video-director/SKILL.md`
2. `skills/_shared/remotion-video-director/references/video-archetypes.md`
3. `skills/_shared/remotion-video-director/references/remotion-patterns.md`
4. `skills/_shared/remotion-video-director/references/component-library.md`

For a complete theme-driven video, also read
`skills/_shared/visual-direction/SKILL.md`. This is the independent visual
decision layer: it chooses the per-scene carrier, shot scale, depth, and asset
role before media generation or Composition code. For a mechanical trim, splice,
or tiny patch, skip it.

For tiny text-only patches, prop changes, typo fixes, or mechanical trim
adjustments, do not re-read the references if this contract is already present
in the recent tool history.

## Video-First Planning Checklist

Before writing or patching composition code, create a compact internal plan:

- **Creative brief**: purpose, audience, core message, desired action.
- **Emotional arc**: what changes from the first frame to the final frame.
- **Scene map**: scene names, exact frame/time ranges, and the one idea in each scene.
- **Focal subject**: the viewer's first read in every representative frame.
- **Media role**: decide whether source footage, generated images, stickers, text, or diagrams carry the scene.
- **Visual carrier**: for substantial scenes, write the `visualPlan` from the
  Visual Director and choose one primary carrier: native, plate, cutout, or
  edge-video.
- **Audio/subtitle relation**: decide whether voice, music, captions, or original sound drives timing.
- **Verification plan**: choose stable hook, middle, and ending frames to preview before publishing.

If a requested edit is purely mechanical, such as "trim the first two seconds"
or "put these two clips back to back", the plan may be one sentence. If the
request asks for style, packaging, storytelling, explanation, or a complete
video, the plan must include scene timing and a visual direction.

## Anti-Web Rules

Makaron's Remotion output should not look like a webpage unless the user asks
for a web UI demo.

- Do not default to hero sections, card grids, pricing panels, dashboard widgets,
  pill collections, dense side-by-side blocks, or tiny labels.
- Do not solve a crowded frame by shrinking text. Solve it with time: reveal
  ideas one after another.
- Keep one obvious focal point per scene.
- Use large readable text, strong hierarchy, and generous safe areas.
- Treat cards, badges, borders, and labels as supporting elements, not the
  composition's default structure.
- If source footage exists, it is usually the subject. Build overlays around
  its rhythm instead of covering it with generic UI.

## Composition Handoff

When moving from direction to code:

- The final plan must map cleanly to `<Sequence>` ranges.
- The canvas aspect must come from the target platform or selected timeline
  media, not from a default template.
- The returned `animation.durationInSeconds` must match the planned timeline.
- User-facing text must live in `props` and editable fields.
- Media URLs belong in `props` or code as real URLs; never leave `<<<media_N>>>`
  or `<<<audio_N>>>` markers inside composition code.
- For video sources, use `<Video>` or `<OffthreadVideo>`, not image handling.
- Use `preview_frame` on stable representative frames before publishing visible
  timeline work.

## Completion Standard

A composition is ready only when it works as both:

- a directed video: hook, pacing, hierarchy, rhythm, and ending are intentional
- a Remotion composition: correct runtime shape, aspect, duration, props,
  media references, editables, and verification path
