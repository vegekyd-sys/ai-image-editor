---
name: talking-head
description: >
  Edit a speech-led or talking-head video from its existing ASR transcript:
  tighten pauses and mistakes, preserve meaning, add image/video B-roll, or
  extract ranked highlight clips without requiring a traditional editor.
allowed-tools: read_file analyze_video transcribe_audio run_code write_file preview_frame materialize_media generate_image generate_animation
metadata:
  makaron:
    icon: "✂"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    defaultAspectRatio: "16:9"
    sourceMediaRequired: true
    tags: [video, talking-head, transcript, asr, b-roll, highlights, remotion, ffmpeg]
---

# Talking Head Edit

Use this Skill for a single primary speech-led source: a direct-to-camera video,
lesson, interview answer, founder update, commentary, or similar spoken piece.
The user should be able to ask for edits in CUI without learning a traditional
timeline.

## Reuse Existing Skills

Do not create a parallel editing stack.

1. Read `skills/video-ffmpeg-lab/SKILL.md` for exact file cuts, concat, probing,
   workspace outputs, and publication.
2. For a ranked batch of quote/highlight clips, also read
   `skills/content-repurpose/SKILL.md` and reuse its editorial ranking criteria.
3. Read `skills/tiktok-video/SKILL.md` only when the requested output is TikTok
   or needs its 9:16 caption/safe-zone packaging.
4. Use the existing `transcribe_audio`, `run_code`, `write_file`,
   `preview_frame`, and `materialize_media` tools. Do not invent a second ASR
   tool, timeline, or timestamp format.

## ASR Contract

- Call `transcribe_audio({ media_index })` before any speech-dependent cut.
- For raw source footage, omit `expected_sections`; that field is for an exact
  approved narration script, not for discovering what the source says.
- The ASR provider receives audio only. Video sources are first reduced to a
  mono 16 kHz audio derivative; never submit the original video as the ASR
  payload or use a full-video fallback.
- Reuse the returned `utterances[].startMs/endMs` for sentence/line decisions
  and `utterances[].words[].startMs/endMs` for precise phrase decisions.
- If the inline result is truncated, read the returned full transcript artifact.
  Do not retranscribe, estimate a second timebase, or ask `analyze_video` for
  speech timing.
- Treat repeated characters semantically. `这这` may be a mistake, while
  `简简单单` and `真真实实` are intentional words. Never delete repetitions by
  character matching alone.

## Modes

### 1. Tight Cut

Use for pauses, retakes, fillers, repeated phrases, off-camera direction, and
explicitly unwanted sections.

1. Probe once and transcribe once.
2. Make a source-time keep/remove plan from existing ASR boundaries.
3. Prefer utterance boundaries for whole-sentence removal. Use word boundaries
   only when the exact mistake can be removed without damaging pronunciation.
4. Preserve a small breath/room-tone handle around joins. Do not mechanically
   remove every silence; intentional pauses and graphic holds can carry meaning.
5. Show a compact proposal before removing ambiguous content. When the user
   says to edit directly, proceed with the conservative plan.
6. For a cut-only deliverable, use the Node/FFmpeg route from
   `video-ffmpeg-lab`, return one real MP4, and publish it to the timeline.

### 2. B-roll

Use an editable Remotion composition when images or videos are added over the
primary speech. The primary source audio remains authoritative and continuous.

Represent the edit as data:

```js
const keepRanges = [
  { sourceStart: 0.0, sourceEnd: 34.2 },
  { sourceStart: 36.0, sourceEnd: 82.4 },
];

const broll = [
  {
    mediaIndex: 2,
    sourceStart: 18.4,
    sourceEnd: 23.8,
    presentation: 'replace-visual', // or overlay / picture-in-picture
    keepSourceAudio: true,
    muted: true, // default for video B-roll
  },
];
```

`sourceStart/sourceEnd` come directly from ASR word or utterance timestamps.
Resolve them into output time after cuts:

```js
function buildSourceToOutputMap(ranges) {
  let outputStart = 0;
  return ranges.map((range) => {
    const mapped = { ...range, outputStart };
    outputStart += range.sourceEnd - range.sourceStart;
    return { ...mapped, outputEnd: outputStart };
  });
}

function sourceTimeToOutputTime(sourceTime, map) {
  const range = map.find((item) => sourceTime >= item.sourceStart && sourceTime <= item.sourceEnd);
  return range ? range.outputStart + sourceTime - range.sourceStart : null;
}
```

Rules:

- If an anchored sentence is removed, omit its B-roll and report it as orphaned;
  never slide it onto another sentence.
- Image B-roll may use restrained pan/scale. Video B-roll is muted by default.
- `replace-visual` covers the speaker while keeping source audio;
  `picture-in-picture` and `overlay` retain the primary picture.
- Favor B-roll for concrete nouns, products, historical examples, proof, UI,
  numbers, and necessary jump-cut coverage. Keep the speaker visible for the
  strongest personal or emotional line.
- Reuse Timeline/Media Index assets first. Generate an image/video only when
  the user asks or the approved plan has a genuine asset gap.

### 3. Highlight Clips

Read `content-repurpose` and rank candidates by hook, standalone context,
insight/emotion, information density, and clean boundaries. A candidate must
preserve what the speaker actually meant.

- Select with utterance timestamps; refine only the boundary words when needed.
- Do not start mid-premise or end before the payoff.
- Remove near-duplicate candidates.
- Verify the opening, middle, and closing frames with `preview_frame`.
- Preserve source aspect unless the user asks for a platform package. For
  TikTok/9:16, read `tiktok-video` and keep captions/UI-safe placement editable.

## Visual Inspection Boundary

ASR decides speech timing. Use `analyze_video` or `preview_frame` only for
visual questions: graphics held during silence, eye closure at a boundary,
framing, gestures, or B-roll suitability. Do not send the whole video to a
vision provider merely to rediscover dialogue.

## Completion And QA

For every delivered cut:

1. Preview every join and every B-roll entrance/exit.
2. Confirm no word is clipped and the speaker's meaning is unchanged.
3. Confirm the main voice continues under B-roll and B-roll audio is muted
   unless explicitly requested.
4. Inspect representative rendered frames, especially existing source graphics.
5. Materialize or export the actual MP4, run `ffprobe`, and fully decode it.
6. Keep the editable Remotion draft when the result includes B-roll, captions,
   branding, or multiple layers.
