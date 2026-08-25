---
name: video-translate
description: Translate accepted video into another language; compose first with talking-head when visible-speaker cuts are requested and finish through tiktok-video for TikTok/Douyin. Use Seed Audio for off-screen VO and SeeDance 2.0 for a visible speaker.
allowed-tools: read_file analyze_video transcribe_audio generate_audio generate_animation run_code write_code_file write_file preview_frame publish_draft materialize_media generate_image
metadata:
  makaron:
    icon: "译"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    sourceProject: "openmontage"
    sourceSkill: "video-translate"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "video-workflow"
    canonicalSkill: "video-translate"
    sourceMediaRequired: true
    tags: [video, translation, dubbing, talking-head, voiceover, captions, seed-audio, seedance]
---

# Video Translation

Translate only the accepted content. Translation does not choose new cuts.
Captions and B-roll come after the translated speech is accepted.

This Skill can be the middle of one request. If a visible talking-head request
also asks to clean up, shorten, or edit the take and no accepted clean A-roll
exists yet, read `skills/talking-head/SKILL.md` and finish the Talking Head
keep-range edit first. If the deliverable is for TikTok/Douyin, also read
`skills/tiktok-video/SKILL.md`
now and continue there after translation is verified. Reading another Skill is
a same-request handoff, not a reason to stop or ask the user to repeat the task.

Before acting, read `skills/_shared/speech-clock.md`,
`skills/_shared/spoken-caption.md`, and
`skills/_shared/voice-translation.md`. Reuse the accepted source transcript;
do not transcribe the same source again.

## Choose by visual carrier

### Non-talking-head or off-screen VO: Seed Audio

Use this route when no visible mouth must match the translated speech: process
footage, product footage, documentary B-roll, motion graphics, screen footage,
or any video led by off-screen narration.

- Call `generate_audio` once with `kind: "translation"`, the target language,
  and exactly one source voice. Send only an audio derivative to Seed Audio.
- Preserve claims, names, numbers, product terms, calls to action, and meaning.
  Use `translated_script` when that wording must be deterministic.
- Mute the old VO and make the translated master the only audible speech.
- Transcribe the accepted translated audio once. Its target-language word
  timestamps become the only clock for captions, emphasis, scene beats, and
  B-roll. Never reuse source-language caption timing.

### Visible talking head: SeeDance 2.0

Use this route when the speaker is visibly delivering the translated words.
The upstream Talking Head Skill owns cuts; this Skill owns translation. Do not
call Seed Audio anywhere in this route.

1. Materialize the accepted clean A-roll before captions or B-roll. Each
   SeeDance 2.0 request must be 4-15 seconds; split longer edits at sentence
   boundaries and preserve order.
2. Read `skills/video-ffmpeg-lab/SKILL.md`, then use one Node/FFmpeg preparation
   run to create two model inputs from each accepted chunk:
   - a visually identical MP4 with its audio removed;
   - a clean MP3/WAV of the original speaker for voice identity only.
   Keep these as intermediate workspace outputs rather than timeline deliverables.
3. Translate the retained argument, then shape it into short natural spoken
   beats that fit the chunk. Preserve protected wording and meaning.
4. Read `prompts/animate.md`. Call `generate_animation` with the default
   `seedance-fast` model, the silent MP4 as `video_ref_url`, and the extracted
   voice URL as the single `audio_refs` item. Use standard `seedance` only when
   the user explicitly requests standard/full/1080p SeeDance.
5. Because SeeDance completes asynchronously, every generated chunk is an
   intermediate artifact. Add one `completion_actions` entry whose prompt says
   to resume `skills/video-translate/SKILL.md` for the same request, wait for all
   planned chunks, transcribe and verify each actual result, retry only a failed
   chunk, assemble them in order, and then continue to
   `skills/tiktok-video/SKILL.md` when platform delivery was requested. Use
   `policy: "auto"` only when the current request explicitly authorizes the
   complete end-to-end flow; otherwise use `policy: "confirm"`. Never end with only a prose promise to continue.

The complete script must use this form, adapted to the target language:

```text
Translated Talking Head

<<<video_1>>> (silent accepted A-roll) is the only visible speaker.
<<<audio_1>>> is voice identity, age, timbre, energy, and delivery reference only; do not repeat its source-language words.

Shot 1 (7s): Fixed talking-head shot. The same speaker says in natural target-language speech: "First short translated phrase." After a natural pause, the speaker continues: "Second short translated phrase." Keep identity stable and match every target-language phoneme with natural mouth and jaw motion.
Sound: Only the quoted target-language dialogue. No source-language speech, music, effects, or subtitles.
Style: Photorealistic talking head, exact identity and setting, stable face, no beautification, no text.
```

Put the target-language dialogue directly inside the `Shot` as quoted speech;
an instruction such as “translate this video” is not dialogue. Split long copy
into shorter quoted phrases. To retain the speaker's personal delivery, ask for
their natural cadence and light non-native accent without naming the source
language as the desired accent; naming it can cause the model to repeat the
source-language audio.

Poll every actual chunk MP4 and transcribe its audio. Reject omitted, added,
garbled, or source-language words. Retry only the failed chunk once with shorter
quoted phrases when wording drifts; do not switch to Seed Audio inside this
route. Do not assemble or package while any chunk is unverified. Review
identity, background, mouth motion, and unwanted performance drift. SeeDance
may regenerate head or body motion, so do not describe it as pixel-preserving
lip sync.

## Package after translation

Use the accepted target-language ASR as the Speech Clock. Add target-language
captions with the shared Spoken Caption contract, then add only B-roll or
graphics that explain the translated beat or cover a necessary join. Keep the
translated speech audible and incidental B-roll audio muted.

For TikTok/Douyin, continue through `skills/tiktok-video/SKILL.md`; otherwise
package here. Publish the editable composition and export a playable MP4 in the
same project. Review the encoded file with sound, including the first phrase,
final word, caption boundaries, and any B-roll transition. Provider completion
alone is not delivery.
