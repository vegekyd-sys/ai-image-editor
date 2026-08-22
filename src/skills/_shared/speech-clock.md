# Speech Clock

Use this contract whenever audible speech drives captions, cuts, visual beats,
or B-roll. It is shared by generated narration and source-speech editing.

## Establish one measured clock

Choose the final audible speech asset first, then call `transcribe_audio` once.
The tool sends an audio derivative to ASR; never upload the video bytes merely
for transcription.

- Source speech: transcribe the source `media_index` and omit
  `expected_sections`.
- Generated narration: transcribe the accepted final audio master with the
  approved Script in `expected_sections` and the Composition FPS.

Persist and reuse that result. Its utterance and word timestamps are the only
speech clock. Do not retype a second caption schedule, estimate timing from the
Script, infer it from scene length or music, or transcribe the same accepted
asset again. On a temporary tool failure, retry the same asset once; if measured
timing is still unavailable, preserve the work and stop before claiming synced
speech delivery.

## Map source time to output time

Keep source and output coordinates explicit. Derive every caption, emphasis,
speech-linked visual range, and composition duration through one mapping.

- An unchanged generated master normally uses the identity map. If production
  intentionally places it later, add that one placement offset everywhere.
- A source-speech edit uses ordered keep ranges shaped like
  `{ sourceStart, sourceEnd, outputStart, playbackRate }`. For a retained word,
  `outputTime = outputStart + (sourceTime - sourceStart) / playbackRate`.
  Exclude removed words. Derive each next `outputStart` and the final duration
  cumulatively from those same ranges.

Never maintain separate cut, caption, B-roll, or animation clocks. If a cut or
playback rate changes, remap all consumers from the same ASR words and keep
ranges rather than patching offsets by hand.

## Compose and review

- A spoken caption begins at its first retained word and ends with its last;
  grouping may be shorter, but wording and order stay faithful to the speech.
- Keyword emphasis must select text inside that cue and preserve the complete
  cue string.
- Speech-linked B-roll or graphics may begin before a cue for anticipation, but
  must not be presented as synchronized evidence unless their range covers the
  measured spoken beat.
- At cue midpoints and boundaries, compare audible words, visible captions, and
  linked visuals. Inspect the encoded MP4; Preview alone cannot prove sync.
- Verify the final spoken word, its caption, audio continuity, and the timeline
  ending. Early, late, future, removed, or already-spoken text fails delivery.
