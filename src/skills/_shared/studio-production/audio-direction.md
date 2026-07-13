# Voice And Sound Direction

Treat audio as part of the edit, not a final attachment.

## Voice

- Decide who is speaking, to whom, with what intent, pace, energy, and pause
  behavior before generating voiceover.
- Use `list_voiceover_voices` and choose a voice for the role, not only gender
  or accent.
- Generate a short sample when voice identity materially affects the piece.
- When measured speech timing materially improves the edit, transcribe the
  generated narration and use those timecodes as editorial reference. Do not
  create a separate caption artifact or renderer.
- If speech exceeds the locked duration by more than 10%, rewrite or tighten it;
  do not casually lengthen the video.

## Source Speech

- For interviews, podcasts, demos, and localization, source speech is primary.
- Preserve meaning, names, numbers, and sentence boundaries.
- Normalize and duck supporting audio, but do not make speech sound processed
  for its own sake.

## Music And Effects

- Give music a job: momentum, tension, warmth, space, or punctuation.
- Use one coherent bed by default. Add spot effects only at meaningful actions
  or transitions.
- Keep music and effects under narration. End with an intentional fade or hit
  inside the locked runtime.

## Review

Review the materialized MP4 for narration presence, unexpected silence, music
presence when promised, timing drift, and distracting transitions. The review
artifact records measured values when available and honest best-effort values
otherwise; never invent a measurement that was not performed.
