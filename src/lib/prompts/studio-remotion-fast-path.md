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

## One-Pass Runtime

Use `runtime: "composition"` and return exactly one complete first draft:

```js
return {
  type: 'render',
  code,
  width,
  height,
  props,
  editables,
  animation: { fps, durationInSeconds }
}
```

The `code` string must define `function Composition(props) { ... }`. React,
Remotion APIs, media APIs, path/noise helpers, and `THREE` are injected. Do not
use `import`, `export`, `require`, `window.Remotion`, or module syntax. Use
`useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`,
`AbsoluteFill`, and `Sequence` directly. Motion must be deterministic from the
current frame, not timers or browser interaction.

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

After the first successful `run_code`, preview three stable representative
frames in parallel: hook, body/strongest beat, and ending. Patch only when a
preview exposes a real defect. Then publish once with
`write_file({ fromLastRunCode: true, name })` and materialize once. Do not make a
second named checkpoint, re-render an unchanged composition, or sample extra
frames after a clean three-frame review.

Check black frames, clipping, text readability, subject crops, scene timing,
final-frame content, and audio presence. Persist Composition, Review, and
Delivery artifacts together when auto approval and contiguous stage order allow
it.
