# Same-Speaker Voice Translation

Use this contract when existing speech must move to another language while the
speaker remains recognizably the same person. This is dubbing, not lip sync.

## Translate the accepted edit

Transcribe the source once, make all editorial cuts first, and translate only
the retained argument. Preserve names, numbers, claims, technical terms, and
meaning; localize syntax and cadence rather than translating word by word.

Call `generate_audio` once with `kind: "translation"`, `target_language`, and
exactly one `source_voice`:

- For a short final cut whose retained speech totals 2-30 seconds, use
  `source_voice.type: "timeline_media"` with the ordered ASR-aligned keep
  ranges and omit `translated_script`. The tool extracts and concatenates audio
  only; Seed Audio directly translates the accepted source speech.
- When protected wording must be deterministic, or the source is longer than
  30 seconds, provide the exact `translated_script` and use one clean 6-20
  second single-speaker range as the source voice sample.
- An attached MP3 or WAV in Audio Index may instead use
  `source_voice.type: "audio_index"`. Do not send video bytes to Seed Audio and
  do not use `reference_voices` for translation.

The Tool owns the same-speaker preservation brief: identity, age, timbre,
emotion, emphasis, pauses, breath, pacing, energy, and microphone distance.
Keep pitch and speed neutral unless timing pressure is real. Never promise
sample-identical voice; verify the actual output.

## Rebuild the speech clock

Call `transcribe_audio` on the returned translated audio URL. Compare meaning,
protected terms, names, numbers, omissions, and additions against the approved
translation. Retry once with `translated_script` if direct translation drifts.
The translated ASR words, not source timestamps or written estimates, become
the only caption and composition clock.

For video, mute the original source audio and use the translated master as the
only audible speech. Keep source visuals in the accepted editorial order. If
duration differs materially, tighten the translation or adjust neutral speech
rate and regenerate; do not stretch generated speech. Use purposeful B-roll to
support meaning and cover visibly distracting mouth mismatch, but do not claim
lip sync. Captions must follow the translated ASR words and the shared Spoken
Caption contract.
