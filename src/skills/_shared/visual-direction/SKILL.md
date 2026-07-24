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
  "subject": "the subject, ensemble, or relationship carrying attention",
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

Record one dominant carrier for asset routing. Supporting media and native
layers may coexist freely when their relationship makes the scene stronger; the
carrier field is not a composition limit.

## Frame Direction

- Choose shot scale deliberately. Hooks and emotional turns often need a close
  or extreme-close subject; establishing or system scenes may need a wide shot.
- Use foreground, subject plane, and background to create depth. Flat centered
  objects on empty backgrounds are not a finished visual direction.
- Let the hero subject occupy enough of the frame to carry the scene. Do not
  shrink it to make room for decorative UI.
- Let production detail reinforce scale, place, causality, rhythm, and character:
  traces, shadows, particles, environmental responses, readouts, and secondary
  actions can make the world feel specific.
- Solve density over time. Reveal and replace supporting information instead of
  packing a dashboard into one frame.
- Shape contrast across the sequence so transformations and quiet moments make
  each other more effective.

## Asset Decision Conversation

Before generating an asset, state:

1. what visual job it performs;
2. why native Remotion or existing media cannot perform that job better;
3. which scene uses it and at what shot scale;
4. whether it should be a `plate`, `cutout`, or `edge-video`;
5. how its edges, lighting, palette, and motion will join the composition.

Use these questions to improve the decision, not to reject imaginative options.
There is no required asset count.

## Completion Reflection

At representative frames, consider:

- the theme is visible in the image, not only stated in text;
- the focal subject and shot scale match the scene's purpose;
- the frame uses foreground, subject plane, and background intentionally;
- generated media is integrated rather than displayed as a rectangular insert;
- the sequence varies scale and energy while preserving one visual world;
- removing the brand name would not make the video indistinguishable from a
  generic template.

Compare the rendered frame to each scene's intent, not merely to general
readability. If a frame feels accidental, generic, or visually unresolved,
consider scale, crop, depth, environment, relationships, or supporting action,
then preview the improved source. This is creative judgment, not a numeric score
or universal density gate.
