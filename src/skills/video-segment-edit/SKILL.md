---
name: video-segment-edit
description: >
  Edit a video interval from natural-language times or a verified scene/frame;
  understand the footage, regenerate that range and deliver the complete video.
allowed-tools: inspect_retake retake_video analyze_video preview_frame run_code generate_animation write_file
metadata:
  makaron:
    icon: "🎬"
    color: "#f43f5e"
    tipsEnabled: false
    builtIn: true
    tags: [video, screenshot-edit, local-edit, segment-edit]
---

# Video Segment Edit

## Scope

This supplements full-source video editing. Use it only for a requested bounded
range/scene. Whole-video character replacement or a persistent global change
stays on video-edit, even for a short source or a single changed attribute.
Explicit new source/scope overrides prior GUI or chat ranges and actions.

## Known time interval: Local video editing (局部编辑 / Edit segment)

GUI selection is optional. Resolve explicit seconds/timecodes, "first/last N
seconds", or "first half" from the visible source duration; convert clip-relative
times to original-source seconds using the source offset. Briefly state the
resolved interval. When an interval is known from chat, CLI or the GUI, call `inspect_retake` first to understand the
selected action and boundaries, then call `retake_video` with the inspection
receipt and a scene-informed expanded instruction. If inspection fails, report
the failure instead of generating blindly. `retake_video` owns source
validation, contextual clipping, model submission, exact interval replacement,
selected audio policy and full-video delivery. Do not screenshot-locate
an already known interval, script a second clipping/assembly pipeline, or ask
for a second merge confirmation. Use original-source seconds, including a
bounded external clip's source offset. Respect the model explicitly selected
by the user; supported models are FAL H3 Max, Seedance 2.5 Eco (preferred
Seedance route), and native Seedance 2.5 when explicitly requested.

For a scene/action description, use analyze_video and preview_frame to locate the actual moment, then inspect and edit its bounded interval. Ask only if multiple scenes match or the requested scope is unclear.

`inspect_retake` automatically includes cached or newly measured ASR when the
source has audio. Read the selected speech together with the frame evidence;
use its output-time word/utterance cues to plan visual changes against the
retained original narration. Adjacent speech belongs to surrounding footage,
and untimed text is not a precise cue. Do not transcribe the same source again.
No recognized speech does not imply silence; ASR does not measure music beats,
effects or lip synchronization. If unavailable speech is essential to the edit,
resolve that evidence before submitting rather than inventing timing. Choose audio_mode independently of modify/replace: original for visual-only
edits (preserve the complete original soundtrack), generated when the request
changes speech, music or effects (use new clip audio only inside the selection).
Write new dialogue and sound explicitly, complete within outputSelection.
Generated audio follows its video timing; do not promise source speech is kept
inside that selection. Outside audio remains source audio. Verify delivered
ASR and speaking lips when requested; missing generated audio is a failure,
not permission to silently use original sound.

Choose `edit_mode` from intent. `modify` changes the inside of the existing sequence while preserving the original first/last composition and action states, including multi-angle edits and layers. `replace` discards the selected shot/scene; original endpoints need not match. Camera changes alone do not imply replacement. Do not supply the legacy boundary_mode override. On model-only comparison follow-ups, reuse the last explicitly edited original source, interval and demand, rather than editing the generated output or GUI's current selection.

Plan from the footage and the user's intent. Decide which content, action, framing or presentation must change, and what continuity to retain. A persistent change can use one continuous beat; additional temporal phases, shots or transitions must serve the desired result. There is no standard multi-camera sequence and no compulsory intermediate-image generation. Suitable supplied images take priority; an optional new keyframe is useful only when this particular edit needs a missing visual state. Camera changes can be attempted directly with an inspected, concrete prompt; choose an optional visual control when it would improve the result.

Interpret image roles from the request. A content reference to integrate into the scene belongs in reference_media_indices. An explicitly chosen final frame of the whole video belongs in end_frame_media_index when supported, with a range extending to the source end; reuse that actual image instead of generating a substitute. A desired intermediate state may use an optional middle-frame control. Read supplied images and honor their roles; do not treat creative references as screenshots to locate. Distinguish content phases from camera changes when writing camera_change. Composition serves explicit fixed layers/editability or deterministic text/layout; do not invent an editable timeline for a generative scene edit.

Never demand a GUI selection. Requests over 15s or sources over 120s need the
appropriate whole-video/long-video workflow; never silently shorten them.

The screenshot localization workflow below is for an unknown frame location.

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

Ordinary natural-language CLI requests need no skill flag or GUI interaction:

`makaron chat --project <id> "把 @1 的最后三秒改成夜景，其余不变"`

Once located, use inspect_retake and retake_video. Poll the root task and deliver
the complete result automatically, without a separate merge command.

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

- `located` with confidence >= 0.65: proceed only if `verification.verdict` is
  `match` and `verification.confidence >= 0.72`.
- `multiple_candidates`: use the strongest timestamp/window, then verify with
  `preview_frame`.
- `uncertain`, confidence < 0.65, missing verification, or failed verification:
  use the FFmpeg fallback below. Do not proceed to regeneration from an
  unverified timestamp.
- `not_found`: ask for a clearer screenshot or confirm the source video.

High confidence is not enough when several moments look broadly similar. If the
evidence sounds generic, if the returned timestamp is near 0s for a later-looking
frame, or if the video reuses similar layouts across time, run the local visual
cross-check below.

Verification is a hard gate. If the candidate frame extracted at the located
timestamp does not visually match the user's screenshot, say the frame could not
be located confidently and ask for a clearer screenshot or timestamp. Do not
continue just because the broad scene or skyline looks similar.

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

- Before choosing a timestamp, compare the user's screenshot with at least one
  candidate frame image. The selected timestamp must be visually defensible as
  the same underlying frame or moment.
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

## Step 4 - Resolve the Interval and Edit

Use the verified action/window, staying inside the visible source range and the
same scene when possible. Choose the smallest range that contains the requested
change (0.1–15 seconds); a timestamp-only repair defaults to a short window around
that moment, not everything after it. The product interval does not need to match
a provider's generation minimum: the tool owns contextual padding and trimming.

State the resolved source range briefly. Call inspect_retake for that exact
source/range/model, view its frames and boundary states, then expand the requested
change and call retake_video with the returned receipt and output-local timing.
If inspection fails, report it; do not generate blindly. Respect a request for
inspection/planning only and do not submit a paid generation in that case.

The user's clear edit instruction authorizes this operation. Do not require GUI
selection, extract before/segment/after files, call generate_animation for a
separate patch, or ask for a second merge confirmation. retake_video owns context,
replacement, the chosen audio policy, and full-video delivery. Poll the returned root task;
a delivery retry must not create another provider generation.

## Completion

Confirm the delivered complete video is playable and the requested change is
visible in the replaced interval, with coherent opening/ending action and visual
meaning/timing consistent with retained narration where relevant. Report the
actual replaced seconds and any failure honestly. Provider completion alone is
not successful editing. Precise cuts, subtitles, standalone audio work and extension
use their dedicated tools, also from natural-language instructions.
