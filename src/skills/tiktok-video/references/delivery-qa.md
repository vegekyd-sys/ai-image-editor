# TikTok Review And Delivery QA

Run two separate gates. Settled-font Preview is the Agent's composition gate;
the encoded MP4 is the acceptance gate once the asynchronous export exists.
Passing one never implies the other.

## Composition Gate

Before publishing or materializing the editable composition:

1. Preview the hook, a stable midpoint from every scene, the densest text frame,
   every multi-line cue, the largest animated text state, and the close at the
   final `9:16` dimensions.
2. Compare essential bounds with the selected platform layout profile.
3. Confirm no visible `\\n`, clipped glyphs, duplicate caption hosts, touching
   rows, or caption/logo/UI collisions.
4. Audit the native feel: meaningful opening action, a clear proposition, text
   roles that differ, and no unexplained reuse of a dark plaque, left rail,
   font combination, fixed placement, or identical entrance.
5. Compare rendered frames with the selected proposal and Storyboard. Patch the
   Composition if the plan is more distinctive than the output.
6. Check frames immediately before and after every scene boundary. Trim,
   playback-rate, or frame-rounding errors must not expose accidental black or
   empty frames.
7. Treat an interactive Player frame as provisional until pinned fonts have
   settled. Use `preview_frame` for composition QA.

## Encoded MP4 Acceptance

Ordinary Studio export completes asynchronously after the Agent queues
`materialize_media`; successful export automatically completes the product's
Review and Delivery states. Do not claim the Agent inspected an MP4 that did
not exist during its turn. When a batch test, CLI workflow, human reviewer, or
later Agent turn has the final encoded file, run this acceptance:

1. Extract frames directly from the encoded file at every multi-line cue, every
   backed caption, and every cue whose font or emphasis changes wrapping.
   Include stable and maximum-animation states.
2. Compare those frames with the corresponding settled-font Preview. The MP4
   is authoritative for glyph metrics, wrapping, line spacing, padding, and
   backing geometry. A clean Preview cannot waive an export-only overlap.
3. Inspect the encoded frames at phone size. Keyword emphasis must remain
   visible and ordinary words must remain readable.
4. Decode the complete video stream, verify `1080 × 1920`, duration, ending,
   source contribution, audio presence, and scene-boundary coverage. A render
   job reporting success is not delivery acceptance.
5. If encoding introduces a rewrap, touching rows, duplicate glyphs, clipping,
   black gap, or different text geometry, return to the same editable
   Composition in a repair turn, fix the local issue, materialize again, and
   repeat this acceptance.

Do not complete Delivery when visual review is unavailable. Preserve the
editable draft and report the block instead of publishing blind.
