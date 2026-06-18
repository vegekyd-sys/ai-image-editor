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

## CLI / Headless Guidance

In CLI usage, users may call:

`makaron chat --project <id> --image screenshot.png --skill video-segment-edit "@4 这帧换成巴黎，只改这一小段"`

Treat `--skill video-segment-edit` as equivalent to the CUI skill picker. Do not
explain the skill mechanism to the user. If the screenshot is missing, say:
"把那一帧截图作为 --image 传进来，或者告诉我具体秒数。"

When a generated patch clip finishes, rely on `completion_actions` so the CLI can
print the exact next `makaron chat --project ...` command. Keep that action
human-readable and include the original media marker plus numeric replace window.

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

- `located` with confidence >= 0.65: proceed only after the evidence includes
  time-specific details, not just broad scene similarity.
- `multiple_candidates`: use the strongest timestamp/window, then verify with
  `preview_frame`.
- `uncertain` or confidence < 0.65: use the FFmpeg fallback below.
- `not_found`: ask for a clearer screenshot or confirm the source video.

High confidence is not enough when several moments look broadly similar. If the
evidence sounds generic, if the returned timestamp is near 0s for a later-looking
frame, or if the video reuses similar layouts across time, run the local visual
cross-check below.

## Step 3 - Local Visual Cross-Check

Use this when `analyze_video(mode:"locate_frame")` is weak, ambiguous, or
overconfident on visually similar moments.

Read `skills/video-ffmpeg-lab/SKILL.md` before the first `run_code` call.

Use `run_code({ runtime: "node", media_refs: [media_index] })` to:

- probe the video,
- extract candidate frames every 0.5s, or every 0.25s around a likely window,
- compare the screenshot against candidate frames when it is an exact or near
  exact frame capture,
- optionally build a contact sheet,
- save the contact sheet or candidate frames to workspace outputs.

Decision rule:

- If the screenshot is a real frame capture and the best visual match is strong,
  isolated in time, and disagrees with `analyze_video`, prefer that timestamp
  even when `analyze_video` returned high confidence.
- A low visual distance is not enough by itself. If many near-identical matches
  span several seconds or more, treat the visual match as ambiguous; use it only
  as support evidence and ask for confirmation or keep the AI/user timestamp.
- If the screenshot includes player controls or UI chrome, crop/ignore the UI
  before comparing when possible. If not, use the visual search only as support
  evidence and rely on `preview_frame` for final confirmation.
- If the best visual match strongly disagrees with `analyze_video`, use the
  visual match timestamp and verify it with `preview_frame`.

Then compare the screenshot with the best candidates visually, or call
`analyze_video(mode:"locate_frame")` again on a smaller candidate segment.

Do not spend many turns on perfect matching. If two candidates are plausible,
ask the user which one is the frame they meant.

## Step 4 - Build the Edit Window

Start from the verified timestamp: the `analyze_video` timestamp, unless the
local visual cross-check overrode it.

Default window:

- SeeDance/default: at least 4 seconds, centered on the timestamp when possible
- Kling: at least 5 seconds, centered on the timestamp when possible
- clamp to the source video boundaries

If the returned `window` is usable and agrees with the verified timestamp, treat
it as the visual evidence window, then expand it to the selected model minimum
before generation. If the local visual cross-check overrode the timestamp, ignore
the old `analyze_video.window` and center the window on the verified timestamp.
Keep it small after that; for local repair, 4-5 seconds is usually enough.

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

- For `generate_animation`, use the provider URL returned next to the
  `segment.mp4` workspace path as `video_ref_url`; this URL is only for the
  external video model, not for FFmpeg or workspace reuse. Use
  `video_ref_type: "feature"`.
- The script should say "参考刚裁出的 segment.mp4 这一段..." in normal language.
- Do not reference the original full video, `before.mp4`, or `after.mp4` in
  `generate_animation`.
- Do not write `<<<media_N>>>` as if it were the segment unless you first
  published that exact segment to the timeline and verified its new Media Index.
- If the project already contains the original video as `<<<media_N>>>`, do not
  include that marker in the generation script for the patch. It will route the
  full video into the model again.
- Add `completion_actions` to the `generate_animation` call so the finished
  patch clip shows a clear next step in CUI/CLI. The default action should tell
  the agent to merge the generated patch back into the source video at the edit
  window, preserving original audio and publishing the full MP4.
- The action prompt must include the exact replace start, replace end, and
  replacement duration. If the generated patch is longer than the window, trim it
  to the replacement duration before concatenating. Never append the full patch
  clip after `before.mp4`; the final duration should match the original video.
- Prefer source media markers and workspace paths over raw URLs in the action prompt. Say
  `原视频 <<<media_N>>>`, `replaceStart`, `replaceEnd`, and
  `replacementDuration`. Do not say only "`before.mp4` URL is ..."; that makes
  the next agent rediscover the source and often causes retries.

Example action:

`completion_actions: [{ label: "拼回完整视频", description: "替换 7.5-12.5 秒，输出仍是原视频时长", prompt: "把刚生成的新片段作为 patch，拼回原视频 <<<media_2>>> 的 7.5-12.5 秒。replaceStart=7.5，replaceEnd=12.5，replacementDuration=5.0。先把 patch 精确裁/对齐到 5.0 秒，再用 FFmpeg 替换原视频这一段；保留原视频音频和前后内容，最终 MP4 总时长必须等于原视频时长，不要把 patch 直接追加到 before.mp4 后面。", policy: "confirm" }]`

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

When the patch clip finishes, use one `run_code({ runtime: "node" })` call with
`media_refs` for the original source video and the generated patch video.

Preferred assembly graph:

- cut original `0 -> replaceStart`,
- trim/fit patch to `replacementDuration`,
- cut original `replaceEnd -> sourceEnd`,
- concatenate `before + fittedPatch + after`,
- preserve the original audio bed unless the user asked for new audio.

Do not rely on `before.mp4` / `after.mp4` filenames from an earlier turn unless
they are exact workspace outputs returned in the current tool history. The stable
handoff is original media index + patch media index + numeric replace window.

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

Do not call both `write_file({ fromLastRunCode: true })` and
`write_file({ fromWorkspaceOutputs: true })` for the same final MP4. Pick one
publish path, preferably `fromWorkspaceOutputs` for FFmpeg outputs, so the same
video is not added twice.

Do not publish intermediate chunks unless the user asks.

## Completion Checklist

Before saying it is done:

- You have a located timestamp or the user confirmed the frame.
- You verified the edit window contains the problematic frame.
- You regenerated only the small segment.
- You assembled a full replacement MP4.
- You published the final full video snapshot to the timeline.
- You briefly say what seconds were replaced, e.g. "我替换了 5.8-8.7 秒这一段。"
