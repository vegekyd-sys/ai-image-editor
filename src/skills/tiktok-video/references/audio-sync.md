# TikTok Audio And Synchronization

## Default Audio Contract

For an under-specified source-footage TikTok, the default finished soundtrack
contains natural VO plus continuous instrumental BGM, while every source video
clip is muted. User direction for source sound, silence, music-only, isolated VO,
or another audio treatment overrides this default.

1. Finish the concise Script first. Preserve speech-free beats; VO does not need
   to fill the runtime. Keep the last spoken line comfortably clear of the hard
   soundtrack boundary and leave an intentional BGM-only tail.
2. Read `prompts/audio.md`, then normally call
   `generate_audio({ kind: "mixed", ... })` once. Put the approved VO lines
   verbatim in the voice section and direct an audible instrumental music arc
   underneath them. Return one finished soundtrack, not stems. Generate a new
   take only when duration, intelligibility, or transcription validation rejects
   the previous take; never keep more than one accepted master in the timeline.
3. Call `transcribe_audio` on that returned mixed-master URL with every narrated
   Script section in `expected_sections` and the Composition `fps`. Do this
   before Storyboard or Composition work.
   Inspect each returned cue, not only the aggregate `verification.passed`
   value. Reject a take when a cue drops its final meaningful word, truncates a
   clause, or aligns only a fragment of the expected line, even if fuzzy
   matching produces a passing overall score. Shorten or clarify the affected
   line before generating the replacement; do not repeat the same crowded read.
   If the tool itself is temporarily unavailable, retry it once on the same
   accepted master. If it still fails, preserve the Script and master, report
   the synchronization block, and stop before narrated Storyboard, Composition,
   publish, or Delivery. Never replace failed ASR with Script-estimated timing.
4. Persist the returned narration cue sheet. Its measured section, word, second,
   and frame ranges are the only speech clock for Storyboard scenes, Remotion
   Sequences, spoken captions, keyword emphasis, and visual beats. Pass this
   cue sheet forward as data and derive those ranges from it; do not copy its
   numbers into a second hand-authored caption or scene schedule.
5. In the Composition, every source `<Video>` or `<OffthreadVideo>` is explicitly
   silent (`volume={0}` or an equivalent deterministic mute). The generated
   mixed master is the only audible layer unless the user requested a deliberate
   source-sound exception.

Do not align captions to planned Script timestamps, equal scene lengths, a prior
audio take, waveform guesses, or the BGM beat alone. Do not create separate VO
and music generations for this default route. If transcription cannot align the
expected VO, shorten or clarify the audio prompt and regenerate before composing.

If the user explicitly requests source sound plus music and no narration, treat
on-screen copy as editorial beat text rather than speech subtitles. Tie it to the
visible action and music structure, but do not claim VO/caption synchronization
or fabricate `transcribe_audio` evidence for speech that does not exist.

`explicit-audio-placement` is valid only when speech was intentionally placed at
known fixed offsets by the production itself. It is not a fallback clock for a
generated mixed master whose actual spoken timing has not been measured.

## Synchronization Review

- Confirm every narrated Script section has non-empty timing evidence and one
  visible spoken-caption host.
- At each cue midpoint, the visible phrase and emphasized keyword must belong to
  the words currently spoken. The linked visual scene must begin no later than
  the cue and remain visible until the cue ends.
- Spoken-caption copy must follow the words present in that cue's actual
  transcript, in their spoken order. Shorter on-screen grouping is fine, but it
  must not rewrite, reorder, or conceal missing VO; keep editorial headlines in
  a separate visual role.
- Check speech-free intervals as intentional BGM-led beats, not missing captions.
- Inspect the editable Composition to prove source clips are muted and only the
  mixed master is audible.
- In the materialized MP4, verify audible VO and BGM, no leaked source audio,
  and no caption or scene change that leads or trails its measured cue.
