# Visual Director

Use this shared layer for any complete, theme-driven video whose visual result
matters. It is independent from explainer, cinematic, product-demo, character,
and other format skills.

Its job is to decide what the viewer should see. It does not generate assets,
prepare files, prescribe subtitle styling, provide JSX components, or replace
the Remotion Director contract.

## Theme Before Style

Translate the subject into a visual idea before choosing colors or effects.

- Identify what is distinctive about this subject, not merely its category.
- Choose a visual metaphor, material world, camera attitude, and recurring
  motif that make this specific theme legible without narration.
- Reject a direction that could be reused unchanged for an unrelated topic.
- Treat brand references as source material, not as a palette-only skin.

## Per-Scene Visual Plan

Before paid generation or Composition code, give every substantial scene one
`visualPlan`:

```json
{
  "carrier": "native | plate | cutout | edge-video",
  "subject": "the one first-read subject",
  "shotScale": "extreme-close | close | medium | wide",
  "compositionIntent": "how the frame directs attention",
  "backgroundIntent": "environment, depth, material, and contrast",
  "motionIntent": "what changes and why",
  "integrationIntent": "how generated media belongs in the frame"
}
```

Carrier meanings:

- `native`: real UI, diagrams, typography, data, paths, or procedural graphics
  are the visual evidence. Remotion carries the scene.
- `plate`: a full-frame image or video carries the world; Remotion directs
  camera movement, labels, timing, and transitions.
- `cutout`: a transparent character, product, object, or effect is staged as a
  foreground or midground subject inside a Remotion-built world.
- `edge-video`: an opaque generated clip has quiet, stable edges designed to
  match the surrounding background, so it can blend without looking pasted in.

Choose one primary carrier for each scene. Supporting media may coexist, but do
not let three media systems compete for the first read.

## Frame Direction

- Choose shot scale deliberately. Hooks and emotional turns often need a close
  or extreme-close subject; establishing or system scenes may need a wide shot.
- Use foreground, subject plane, and background to create depth. Flat centered
  objects on empty backgrounds are not a finished visual direction.
- Let the hero subject occupy enough of the frame to carry the scene. Do not
  shrink it to make room for decorative UI.
- Add production detail only when it reinforces scale, place, causality, or
  rhythm: traces, shadows, particles, environmental responses, readouts, or
  secondary actions should make the world feel specific.
- Solve density over time. Reveal and replace supporting information instead of
  packing a dashboard into one frame.
- Reserve one or two hero moments for the strongest visual transformation. Do
  not apply maximum intensity to every scene.

## Asset Decision Gate

Before generating an asset, state:

1. what visual job it performs;
2. why native Remotion or existing media cannot perform that job better;
3. which scene uses it and at what shot scale;
4. whether it should be a `plate`, `cutout`, or `edge-video`;
5. how its edges, lighting, palette, and motion will join the composition.

Generate only assets that survive this gate. There is no required asset count.

## Completion Check

At representative frames, verify:

- the theme is visible in the image, not only stated in text;
- the focal subject and shot scale match the scene's purpose;
- the frame uses foreground, subject plane, and background intentionally;
- generated media is integrated rather than displayed as a rectangular insert;
- the sequence varies scale and energy while preserving one visual world;
- removing the brand name would not make the video indistinguishable from a
  generic template.

Compare the rendered frame to each scene's `visualPlan`, not merely to general
readability. A `medium` or `close` hero reduced to a small centered icon on a
mostly empty field is underfilled and fails even when the asset is sharp and
the text is readable. Patch scale, crop, depth planes, or supporting action,
then preview again. Record this check in the Composition draft gate and final
MP4 review.
