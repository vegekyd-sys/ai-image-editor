---
name: video-segment-edit
description: >
  Locate a user-provided screenshot/frame inside a video, regenerate only the
  nearby problem segment, and assemble it back into the original MP4.
allowed-tools: analyze_video preview_frame run_code generate_animation write_file
metadata:
  makaron:
    icon: "🎬"
    color: "#f43f5e"
    tipsEnabled: false
    builtIn: true
    tags: [video, screenshot-edit, local-edit, segment-edit]
---

# Video Segment Edit

Use this workflow when the user wants to fix only a small part of an existing
video, especially when they provide a screenshot/frame and say something like:
"这里有点怪", "这个画面修一下", "这帧不对", "手这里坏了", "第 7 秒附近有问题",
"fix this frame", or "change this moment".

This is not a full video remake workflow. The goal is to find the frame, make a
small edit window, regenerate only that segment, and put it back into the
original video.

## User-Facing Tone

Talk like the user talked. Do not mention internal skill names, "pipelines", or
implementation unless the user asks. Good short replies:

- "我先定位这张截图在视频里的位置，然后只修附近几秒。"
- "我先看一下它落在哪一段，再裁出那几秒来改。"
- "找到了大概位置后，我会只重做这一小段。"

Avoid stiff prompts like "activating frame-anchored segment edit workflow".

## Inputs

The workflow needs:

1. A source video in Media Index, such as `<<<media_1>>>`.
2. A visual anchor:
   - preferred: user-provided screenshot/frame image,
   - or a timestamp the user mentioned, which you convert to a screenshot using
     `preview_frame`.
3. A local edit instruction, such as what looks wrong in that frame.

If the source video is ambiguous, ask one short question: "是要改 @几 这个视频？"
If the screenshot is missing and the user only says "这里", ask for the screenshot
or timestamp.

## Step 1 - Resolve the Frame Anchor

If the user provides a screenshot image, use it as the anchor directly.

If the user gives a timestamp, first call:

`preview_frame({ media_index, timestamp, question })`

Use the returned `workspacePath` as the screenshot anchor for the next step.

## Step 2 - Locate the Screenshot in the Video

Primary locator: call `analyze_video` with `mode: "locate_frame"`.

Examples:

For an uploaded screenshot URL:

`analyze_video({ media_index: 1, mode: "locate_frame", image_url, question })`

For a frame captured by `preview_frame`:

`analyze_video({ media_index: 1, mode: "locate_frame", workspace_path, question })`

Interpret the result:

- `located` with confidence >= 0.65: proceed.
- `multiple_candidates`: use the strongest timestamp/window, then verify with
  `preview_frame`.
- `uncertain` or confidence < 0.65: use the FFmpeg fallback below.
- `not_found`: ask for a clearer screenshot or confirm the source video.

## Step 3 - FFmpeg Fallback for Low Confidence

Use this only when `analyze_video(mode:"locate_frame")` is weak or ambiguous.

Read `skills/video-ffmpeg-lab/SKILL.md` before the first `run_code` call.

Use `run_code({ runtime: "node", media_refs: [media_index] })` to:

- probe the video,
- extract candidate frames every 0.5s or 1s,
- optionally build a contact sheet,
- save the contact sheet or candidate frames to workspace outputs.

Then compare the screenshot with those candidates visually, or call
`analyze_video(mode:"locate_frame")` again on a smaller candidate segment.

Do not spend many turns on perfect matching. If two candidates are plausible,
ask the user which one is the frame they meant.

## Step 4 - Build the Edit Window

Start from the located timestamp.

Default window:

- SeeDance/default: at least 4 seconds, centered on the timestamp when possible
- Kling: at least 5 seconds, centered on the timestamp when possible
- clamp to the source video boundaries

If the returned `window` is usable, treat it as the visual evidence window, then
expand it to the selected model minimum before generation. Keep it small after
that; for local repair, 4-5 seconds is usually enough.

If the screenshot is near a hard scene cut, keep the window inside that scene.
Use `preview_frame` at the middle of the proposed window to verify it contains
the problem.

## Step 5 - Extract the Segment

Use `run_code({ runtime: "node", media_refs: [media_index] })` to cut:

- `before.mp4`: source from 0 to window start
- `segment.mp4`: source from window start to window end
- `after.mp4`: source from window end to source end

The `segment.mp4` is the reference clip sent to video generation.

For model preparation chunks, keep them in workspace; do not publish them to the
timeline yet.

## Step 6 - Regenerate the Segment

Call `generate_animation` on the segment clip only.

Use the `segment.mp4` workspace output as the single video reference:

- Prefer `video_ref_url: "<segment.mp4 storageUrl>"` and
  `video_ref_type: "feature"`.
- The script should say "参考刚裁出的 segment.mp4 这一段..." in normal language.
- Do not reference the original full video, `before.mp4`, or `after.mp4` in
  `generate_animation`.
- Do not write `<<<media_N>>>` as if it were the segment unless you first
  published that exact segment to the timeline and verified its new Media Index.
- If the project already contains the original video as `<<<media_N>>>`, do not
  include that marker in the generation script for the patch. It will route the
  full video into the model again.

Script style:

- Keep it short and concrete.
- Reference the segment video.
- Say exactly what to fix.
- Preserve camera, framing, character identity, motion, lighting, and continuity.
- Do not describe a new scene unless the user asked for a new scene.

If the user clearly said to proceed, you may direct-submit. Otherwise show the
short segment script and wait for confirmation, following the normal video
rendering gate.

If `generate_animation` says multiple reference videos would be submitted, stop
and rewrite the call so that only the segment clip is passed.

## Step 7 - Assemble Back Into the Full Video

When the patch clip finishes, use `run_code({ runtime: "node" })` to concatenate:

`before.mp4 + patch.mp4 + after.mp4`

Do not directly stream-copy concatenate provider output. First normalize every
video leg to the original video's width, height, fps, SAR, and pixel format. A
provider patch may come back at a nearby but different size such as 864x496.

Audio rule:

- If the user did not ask for new audio, keep the original segment audio under
  the generated patch video.
- If the patch has no audio, do not leave the final MP4 with a broken or missing
  audio section; use the original `segment.mp4` audio for that window.

Export H.264/AAC/yuv420p with `-movflags +faststart`.

Publish only the final full MP4 to the timeline:

`write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: 1 })`

Do not publish intermediate chunks unless the user asks.

## Completion Checklist

Before saying it is done:

- You have a located timestamp or the user confirmed the frame.
- You verified the edit window contains the problematic frame.
- You regenerated only the small segment.
- You assembled a full replacement MP4.
- You published the final full video snapshot to the timeline.
- You briefly say what seconds were replaced, e.g. "我替换了 5.8-8.7 秒这一段。"
