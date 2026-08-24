# TikTok Audio And Synchronization

Read `skills/_shared/speech-clock.md` first. It owns the one-ASR-result rule,
measured cue timing, mapping, and synchronization review for every speech-led
video. This reference only defines TikTok's default generated-audio route.

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
4. Apply the Speech Clock generated-master route. Persist the cue sheet and use
   its identity mapping for Storyboard scenes, Remotion Sequences, captions,
   emphasis, and visual beats.
5. In the Composition, every source `<Video>` or `<OffthreadVideo>` is explicitly
   silent (`volume={0}` or an equivalent deterministic mute). The generated
   mixed master is the only audible layer unless the user requested a deliberate
   source-sound exception.

Do not create separate VO and music generations for this default route. If
transcription cannot align the expected VO, shorten or clarify the audio prompt
and regenerate before composing.

If the user explicitly requests source sound plus music and no narration, treat
on-screen copy as editorial beat text rather than speech subtitles. Tie it to the
visible action and music structure, but do not claim VO/caption synchronization
or fabricate `transcribe_audio` evidence for speech that does not exist.

`explicit-audio-placement` is valid only when speech was intentionally placed at
known fixed offsets by the production itself. It is not a fallback clock for a
generated mixed master whose actual spoken timing has not been measured.

In addition to the shared review, confirm speech-free intervals are intentional
BGM-led beats, source clips are muted, the one mixed master is audible, and no
source audio leaks into the materialized MP4.
