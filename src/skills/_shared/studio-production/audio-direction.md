# Voice And Sound Direction

Treat audio as part of the edit, not a final attachment.

## Voice

- Lock one audio architecture before generation. If the finished track contains
  narration/dialogue plus music, ambience, or SFX, call
  `generate_audio({ kind: "mixed", ... })` exactly once with every layer in the
  same prompt. Do not generate a voice track and supporting track separately.
- Use `generate_audio({ kind: "voiceover", ... })` only for an intentionally
  isolated narration/VO master. Do not search for a separate voiceover,
  voice-catalog, or music tool.
- Before generation, write a Voice Performance Brief: who is speaking, who is
  listening, dramatic intent, emotional starting point, turning point, ending
  state, pace, energy, pauses, breaths, emphasis, restraint, and behaviors to
  avoid.
- For a unified track, Seed Audio must create the emotional voice, supporting
  bed, spot effects, ducking, and intentional ending in the same model
  generation. Do not request stems.
- Generate a short sample when voice identity materially affects the piece.
- For every narrated Remotion/Studio composition, call `transcribe_audio` with
  the approved Script sections and fps, persist its narration cue sheet, and
  use those measured seconds/frames as the master clock. This standardizes
  timing data, not subtitle styling or rendering.
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
