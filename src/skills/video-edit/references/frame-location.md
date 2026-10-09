# Locate an unknown screenshot moment

Read only when a supplied screenshot identifies a video repair but its timestamp
is unknown. A creative image is not a screenshot locator. If the user supplies a
clear time/range, return directly to video-edit inspection without this workflow.

## Locate the screenshot in the video

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

## Verify the candidate visually

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


After a verified match, resolve the smallest bounded scene/window containing the
requested correction, inside the visible source range. A timestamp repair does
not mean editing everything after it. Return to the Bounded visual edits steps
in `skills/video-edit/SKILL.md`; do not generate/assemble a separate patch here.
