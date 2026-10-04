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

## Continue the composite request

When one prompt asks to edit, translate, and publish a visible talking head, the
Skill chain is `talking-head` → `video-translate` → `tiktok-video` for a
TikTok/Douyin deliverable. Each Skill owns one decision layer, but reading the
next Skill continues the same user request. Do not stop at a handoff, ask the
user to restate the task, or present a clean A-roll, provider result, or one
translated chunk as the finished video.

Advance only through three accepted artifacts: a materialized clean A-roll;
all target-language chunks verified from their actual ASR and assembled in
order; then the captioned, visually supported, exported video. Retry only a
failed translated chunk. Platform captions and B-roll belong after translated
speech acceptance, so they follow the target-language clock rather than the
source clock.

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
