# TikTok Speech And Caption Direction

Read this only when the video contains narration or useful source speech. It
standardizes timing and export correctness while leaving typography, layout,
animation, and visual personality to the Composition.

## Shape The Speech First

- Lock the final narration-containing audio master before building captions.
- Listen to the audio and read the transcript together. Remove narration that
  merely describes visible action; preserve speech-free room unless the brief
  benefits from a continuous creator monologue.
- Group consecutive timed words the way a strong human short-form editor would
  phrase the thought. Semantic and prosodic coherence outrank brevity. Word
  count and cue duration are not quotas.
- Read the cue sequence aloud. Reconsider a boundary that sounds unfinished,
  attaches a word to the wrong thought, or creates a repetitive chopping
  rhythm.

## Use Measured Timing

1. Run `transcribe_audio` on the final VO or source-speech master.
2. Derive each cue from the words it contains: enter on the first included
   word's measured start and leave on the last included word's measured end,
   converted through the same Composition FPS.
3. A tiny legibility pad is allowed only inside real silence. Adjacent cues
   must not overlap, and a phrase must not be stretched to fill its visual
   scene.
4. Trigger word emphasis on that word's measured timestamp, not at the phrase
   entrance or an invented beat.
5. If wording, pace, or take changes, transcribe again and rebuild affected
   cues. Never reuse stale timing.
6. Retain one `subtitleSyncEvidence` record per narrated Script section with
   `timingSource: "transcribe_audio"`, exact cue text, frame range, and visible
   caption host. Narration with an empty evidence array is a failure. A hook,
   beat label, `KineticTitle`, or `Headline` cannot substitute for speech.
7. Use the same cue-sheet seconds and frame ranges for the linked visual scene,
   spoken-caption host, and semantic keyword emphasis. Do not make separate
   timing decisions for voice, caption, and picture.

## Keep The Visual Direction Autonomous

- Use one visible caption host per cue. A highlighted word belongs inside it;
  never stack a raw subtitle, editable mirror, or duplicate track over the same
  phrase.
- Select semantic emphasis from inside the spoken cue. Recoloring the whole
  sentence or decorating a surrounding rail is not keyword emphasis.
- Preserve the complete cue while styling its chosen substring. Splitting on a
  keyword removes that delimiter; do not map only the remaining pieces and
  accidentally delete the emphasized word. Render prefix + highlighted match +
  suffix (or use a capturing tokenizer), and fall back to the full unstyled cue
  if the requested match is absent.
- Flatten the rendered caption host before approval and compare it with the cue.
  Ignoring intentional case styling, every word and punctuation mark must remain
  in the same order exactly once; the highlighted substring itself must be
  visible, not represented only by a rail, border, or background accent.
- Preserve visible word gaps when highlights use separate spans. A wrapping
  flex or grid row with explicit `columnGap` is more reliable than whitespace,
  negative tracking, or spacer spans when words also scale.
- Multi-line glyph rows, outlines, shadows, and backing shapes must not touch
  or overprint at the final font metrics. Repair locally by changing width,
  line break, size, line-height, padding, or backing geometry; do not impose one
  universal caption component or line-height.
- A long spoken cue must not rely on `white-space: nowrap`, off-canvas overflow,
  or an oversized single line. At the settled font metrics, author a break or
  adjust measure and type size so the complete phrase remains inside its safe
  bounds throughout the entrance, stable hold, and exit.
- Never combine `display: inline` and `box-decoration-break: clone` around
  browser-auto-wrapped prose. Lambda Chromium can fragment and paint the
  backing differently from interactive Preview, especially on scaled exports.
  Use one wrapping `inline-block` backing (`maxWidth: '100%'`) or explicit
  authored line boxes when separate per-line shapes are essential.
- Store intended breaks as real line feeds or explicit authored lines. The
  shared runtime normalizes escaped newlines as a safety net, but resolved props
  and exported frames still require review.
- Derive motion from the meaning and action. Compare at least two different
  cues in motion; identical entrances need a creative reason, not merely a
  shared component.
- A plain ASS or `drawtext` subtitle track is a technical fallback, not an
  automatic TikTok art direction. When authored typography, semantic emphasis,
  or editable delivery matters, keep captions in the Composition. A deliberately
  minimal caption can still be right, but it must be a creative choice visible
  in Preview rather than a renderer limitation.

Typography remains Composition-owned. There is no required font, black plaque,
left rail, accent color, caption position, or entrance animation.
