## Studio Remotion Fast Path

Use this compact guide only when the active video skill routes through Studio Run.
It replaces `prompts/agent-coding.md`, `prompts/remotion-composition.md`, and
`skills/_shared/remotion-director-contract.md` for that run. Do not read those
three longer guides as well.

## Direction First

Treat the approved Brief, Proposal, Script, Storyboard, and Assets artifacts as
the director contract. Preserve their audience, message, emotional arc, scene
order, pacing, focal subject, transition language, audio relation, and review
criteria. Build a video timeline, not a webpage. Keep the hook legible in the
opening, create one clear focal action per beat, and end on visible content.

For normal complete-video work, the Proposal must set `creativeMode` to
`directed` and include the compact `creativeTreatment` from
`skills/creative-direction/SKILL.md`. Make the composition visibly obey its
visual mechanism, signature frame, rhythm, material system, contrast plan, and
anti-cliches. Use `baseline` only for an explicit A/B control or template-speed
request. Do not invent a second style plan during composition.

## One-Pass Runtime

Use `runtime: "composition"` and send exactly one complete first draft through
the direct `composition` input. Do not wrap JSX inside executable `code`:

```js
run_code({
  runtime: 'composition',
  description,
  composition: { code, width, height, props, editables, animation: { fps, durationInSeconds } }
})
```

The `code` string must define `function Composition(props) { ... }`. React,
Remotion APIs, media APIs, path/noise helpers, and `THREE` are injected. Do not
use `import`, `export`, `require`, `window.Remotion`, or module syntax. Use
`useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`,
`AbsoluteFill`, and `Sequence` directly. Motion must be deterministic from the
current frame, not timers or browser interaction.

Creative lift must come from one strong mechanism, scale, contrast, timing, and
composition rather than source-code volume. For a local video of 15 seconds or
less with no source media, target at most 6500 composition characters and three
helper components. Reuse arrays and primitives. Avoid tiny decorative labels,
dense grids, and nested template literals.

Only `Composition(props)` may read outer `props`. Every helper receives its
values as parameters. Use Remotion `<Img>`, `<Video>`, `<OffthreadVideo>`, and
`<Audio>`, never HTML media tags. Put each scene or clip in a `<Sequence>`.
Use `trimBefore` and `trimAfter`, not deprecated `startFrom` or `endAt`.

Use literal 1-based `<<<media_N>>>` markers in code or props. `run_code` resolves
them to current URLs before validation, autosave, preview, and export. Never map
Media Index N to `ctx.snapshotImages[N]`; the array is 0-based and will shift the
media sequence.
Keep uploaded source audio authoritative and include it through `<Audio>`. Match
the requested or source aspect ratio. Keep filters and simultaneous media layers
modest, animate transform/opacity, and use system CJK fonts.

Every user-facing text value belongs in `props`, is rendered from props, has a
`data-editable` wrapper, and appears in `editables`. Keep total duration exactly
equal to the approved timeline.

## Verify And Publish

After the first successful `run_code`, make one `preview_frame` call with three
stable representative frames: hook, body/strongest beat, and ending. This
returns one contact sheet for comparative review. Patch only when it exposes a
real defect. Then publish once with
`write_file({ fromLastRunCode: true, name })` and materialize once. Do not make a
second named checkpoint, re-render an unchanged composition, or sample extra
frames after a clean three-frame review.

Check black frames, clipping, text readability, subject crops, scene timing,
final-frame content, and audio presence. Persist Composition, Review, and
Delivery artifacts together when auto approval and contiguous stage order allow
it.
