# Spoken Caption

Use this contract whenever audible speech has an on-screen caption track. Read
`skills/_shared/speech-clock.md` first; it owns timing and source-to-output
mapping. This contract owns caption phrasing, emphasis, presentation integrity,
and review. It does not provide a renderer or a fixed visual template.

## Shape readable micro-cues

- Partition consecutive retained ASR words into the shortest natural phrase
  that still carries one complete semantic beat. A sentence, transcript line,
  or Script section is not automatically one caption card.
- Use the measured start of the first word and end of the last word. Do not
  invent a second schedule, stretch a phrase across its scene, or overlap
  adjacent cues.
- Keep wording and order faithful to the audible speech. Concatenating the
  ordered micro-cues for a measured section must reproduce its retained words
  without dropping, duplicating, paraphrasing, or moving them. Editorial hooks
  and labels remain separate from spoken captions.
- Make captions shorter by partitioning the retained speech, not by summarizing
  it. If a filler, false start, or redundant phrase should disappear from the
  caption, remove that sound from the edit too; never silently clean words that
  remain audible.
- Optimize for one-glance phone reading. Prefer one clear idea and one or two
  comfortable lines, but treat that as an editorial outcome rather than a word
  or character quota. If a cue settles into dense prose, split it at a measured
  clause, emphasis, or breath boundary before shrinking the type.

## Make emphasis semantic

- Choose one or two meaningful words, or one compact phrase, from inside the
  visible cue. The emphasized text must be an exact substring of that cue.
- Styling may wrap the match, but the flattened visible host must still contain
  the complete cue exactly once. Render prefix + highlighted match + suffix, or
  use a capturing tokenizer; `text.split(keyword)` alone removes the keyword.
- Recoloring the whole sentence, leaving only an accent rail, or appending a
  paraphrased keyword is not semantic emphasis.

## Let the composition own the style

- Match typography, position, color, backing, and motion to the footage,
  speaker, platform, and concept. There is no shared font, plaque, lower-third,
  accent color, anchor, entrance, or line-height.
- Keep one visible caption host per active cue. A highlighted word belongs
  inside that host; do not stack a raw subtitle, editable mirror, or duplicate
  track over the same phrase.
- Maintain high contrast and a clear hierarchy at phone size. Place captions
  around the face, important action, and platform UI rather than obscuring
  them. A backing is optional, not the default repair for crowded copy.
- Derive entrances and emphasis motion from the spoken beat. Repeated motion is
  valid when it belongs to the concept, not merely because one component was
  reused.

## Preserve layout across renderers

- Long caption prose may wrap; do not use full-cue `nowrap` or off-canvas
  overflow. A compact emphasized substring may use `inline-block` plus `nowrap`
  so a CJK or Latin keyword stays atomic.
- Keep intended line breaks explicit. Give multi-line glyph rows enough local
  line-height and give separately authored line boxes a real vertical gap.
- Do not use `display: inline` plus `box-decoration-break: clone` around
  browser-auto-wrapped prose. If the concept needs a backing, use one wrapping
  shape or explicit line boxes; text-only, outlined, shadowed, and selectively
  blocked treatments remain valid.

## Review the actual delivery

- At every cue midpoint and boundary, compare the audible words, visible cue,
  emphasis, and linked visual. Flatten the visible host and verify exact text,
  one glyph silhouette, safe placement, and no clipped or touching rows.
- Review the longest cue, every multi-line cue, the largest animated state, and
  two different cue transitions in settled-font Preview.
- Repeat those checks on frames extracted from the encoded MP4. Preview cannot
  waive an export-only rewrap, overlap, duplicate, missing keyword, or timing
  drift. The final MP4 is the acceptance artifact.
