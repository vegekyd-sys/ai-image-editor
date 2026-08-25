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
   beats. Preserve protected wording and meaning. Estimate the target-language
   reading time and set the generated duration from that target speech, not
   from the source chunk. Use the shortest integer duration that allows a
   natural delivery plus a small head/tail breath; the dialogue should occupy
   most of the generated clip. If it will not fit within 15 seconds, split at
   another sentence boundary. If it is shorter than the 4-second minimum, join
   it to an adjacent complete beat. Excess empty duration invites SeeDance to
   improvise, repeat, or fall back toward the source-language audio.
4. Read `prompts/animate.md`. Call `generate_animation` with the default
   `seedance-fast` model, the silent MP4 as `video_ref_url`, and the extracted
   voice URL as the single `audio_refs` item. Pass `video_ref_type: "feature"`:
   this is reference regeneration, not a base video edit. If a call is rejected
   because base editing is unsupported, correct that argument to `feature` and
   keep `seedance-fast`; do not switch to Seedance 2.5. Use standard `seedance`
   only when the user explicitly requests standard/full/1080p SeeDance. Before
   submitting, read the final `story_prompt` once: it must contain literal
   `<<<video_1>>>` and `<<<audio_1>>>` markers, the dialogue lock, and no `...`
   or `…` inside any quoted line.
5. Because SeeDance completes asynchronously, every generated chunk is an
   intermediate artifact. Add one `completion_actions` entry whose prompt says
   to resume `skills/video-translate/SKILL.md` for the same request, wait for all
   planned chunks, transcribe and verify each actual result, retry only a failed
   chunk, assemble them in order, and then continue to
   `skills/tiktok-video/SKILL.md` when platform delivery was requested. Use
   `policy: "auto"` only when the current request explicitly authorizes the
   complete end-to-end flow; otherwise use `policy: "confirm"`. Never end with only a prose promise to continue.

The first request should already use the same exact dialogue lock that a good
retry would use. Keep the entire control prompt compact and in English; only
the quoted dialogue changes language. Put the dialogue before secondary visual
instructions. Do not add a long Style block or repeat negative constraints.
Use this form:

```text
Target-Language Talking Head
<<<video_1>>> Same speaker and same shot. <<<audio_1>>> Use only this speaker's voice, tone, accent, and cadence; ignore its source-language words.
The speaker says in Target Language exactly once: "First complete translated sentence. Second complete translated sentence."
No other speech. No subtitles. Keep the same face, clothing, background, framing, and natural mouth motion.
```

This compact translation prompt overrides the ordinary generated-video `Shot`
template in `prompts/animate.md`; a single talking-head performance does not
need shot choreography. Put the target-language dialogue directly in
`story_prompt` as quoted speech; an instruction such as “translate this video”
is not dialogue. For one speaker, prefer one quotation containing the complete
short performance in natural sentence order; use multiple quotations only when
another speaker or a real pause must be distinguished. Never send an ellipsis,
dangling clause, or unfinished thought to SeeDance. If the retained source
itself ends mid-sentence, stop at its last complete semantic beat; the
incomplete tail carries no additional claim to preserve. Never include a known
wrong word merely to negate it; the dialogue lock already excludes every
unquoted word. To retain the speaker's personal
delivery, ask for their natural cadence and light non-native accent without
naming the source language as the desired accent; naming it can cause the model
to repeat the source-language audio.

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
