# Same-Speaker Translation Contract

Use this contract with `skills/video-translate/SKILL.md` whenever existing
speech moves to another language while the speaker should remain recognizable.

## Translate the accepted content

Transcribe the source once, make editorial cuts first, and translate only the
retained argument. Preserve names, numbers, claims, technical terms, calls to
action, and meaning. Localize syntax and cadence rather than translating word
by word.

Choose from the visible carrier, not from a generic “lip sync” toggle:

- Off-screen VO or non-talking-head footage uses Seed Audio
  `kind: "translation"`. Send only the accepted audio derivative, never video
  bytes. Use one source voice and a target language; add `translated_script`
  when protected wording must be exact.
- A visible talking head is edited first by Talking Head, then translated
  directly by SeeDance 2.0 from a silent accepted A-roll, one original-speaker
  voice reference, and quoted target-language dialogue in the animation
  Prompt. Seed Audio must not be used in that route.

Never promise sample-identical voice. Verify the actual output and preserve the
source speaker's age, timbre, emotion, emphasis, pauses, pacing, energy, and
microphone character as closely as the chosen model allows.

## Rebuild the speech clock

Call `transcribe_audio` on the accepted translated audio or translated video.
Compare meaning, protected terms, names, numbers, omissions, additions, and
source-language leakage. The translated ASR words, not source timestamps or
written estimates, become the only caption and composition clock.

Mute the old speech. Captions must follow the translated ASR words and the
shared Spoken Caption contract. Add B-roll only after translation, using the
translated semantic beat and measured timing. If duration changes, adjust the
translation or edit deliberately; never stretch generated speech or patch a
second caption schedule by hand.
