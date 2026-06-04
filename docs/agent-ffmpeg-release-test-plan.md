# Agent FFmpeg / Remotion Release Test Plan

## Blocking Routing Principle

Before merging this branch, keep this rule fixed:

- Two existing timeline videos cut together, trimmed, transitioned, subtitled, or kept as an editable timeline: use Remotion `runtime: "composition"`.
- FFmpeg `runtime: "node"` is only for real file-level MP4 operations: splitting a long source, transcoding, frame extraction, preparing model-sized chunks, exact exported file trims, or final file-level assembly after generated chunks.

If a test or prompt routes ordinary timeline splicing of two existing videos to FFmpeg, the branch is not ready to merge.

## Branch Update Scope

- Agent runtime: adds `runtime: "node"` FFmpeg sandbox, workspace outputs, `fromWorkspaceOutputs` publishing, and composition/design alias support.
- Prompt architecture: trims generic coding guidance and adds `remotion-composition.md`; the concat/timeline routing must stay corrected.
- Tool history: adds `agent_tool_history` migration, sanitizer, `tool_result` persistence, and `ModelMessage[]` history reconstruction.
- Video upload/model: raises upload limit to 120s, defaults video generation toward SeeDance, and adds Kling/SeeDance capability guards.
- Timeline/UI: video snapshots use real `video_meta.videoUrl`, and multiple workspace video outputs can be published to the timeline.
- E2E: adds video upload and agent video style probe scripts.

## Pre-Release Test Matrix

T01 DB migration: preview has `agent_tool_history` table, indexes, and RLS.

T02 Historical compatibility: old projects open; normal prompts and video prompts do not crash.

T03 Tool history write: after the agent reads `prompts/agent-coding.md`, DB has a `read_file` row.

T04 Sanitizer: DB contains no `data:image`, base64 payloads, large video payloads, or full code blobs.

T05 Second-turn reuse: first turn reads a guide; second turn continues without repeatedly reading the same guide.

T06 30s single video split into 3 parts: must use FFmpeg `runtime: "node"` and output workspace videos.

T07 Publish split outputs: next turn "send to timeline" must call `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: 3 })` and must not cut again.

T08 Two existing videos cut together: must use Remotion `runtime: "composition"` with `<Sequence>` and `<Video>`, not FFmpeg.

T09 Two existing videos with transitions/subtitles: must use Remotion, with preview-frame verification.

T10 Two existing videos exported as one final MP4: default remains Remotion timeline first; FFmpeg or Remotion export is allowed only after the product goal is one final file.

T11 Single-video free trim: default is Remotion non-destructive trim; use FFmpeg only when the user asks for a real exported trimmed file.

T12 Long-video model preparation: for source video longer than model limits, split with FFmpeg before per-chunk `generate_animation`.

T13 Long-video generated-chunk final assembly: generated chunks may be FFmpeg-concatenated into one final MP4.

T14 Remotion composition patch: after publishing, a next-turn title edit must use `code_path` patch and must not rebuild from scratch.

T15 Media Index wording: agent-visible context uses composition/code_path terminology and does not show misleading `Current design code`.

T16 Workspace output across session: after refresh/session change, recent exported outputs can still be published without redoing work.

T17 Multiple video snapshots: publishing 3 clips creates 3 video snapshots in DB and frontend timeline.

T18 SeeDance default: when no video model is selected, video generation uses SeeDance.

T19 Kling cheaper mode: when the user explicitly asks for cheaper generation and video length is within Kling limits, Kling can be used; over-limit cases must prompt split or model switch.

T20 SeeDance reference-video limit: reference video longer than 15.5s must not be submitted directly; it must be split first.

T21 Upload duration limits: 30s, 60s, and 120s uploads create projects successfully; longer than 121s is rejected.

T22 High-resolution upload guard: videos exceeding frame-pixel limits are rejected.

T23 Video snapshot URL: editor video `src` is `video_meta.videoUrl`, not poster URL.

T24 CUI tool-result recovery: after a previous turn says "exported", the next turn "publish" must not rerun `run_code`.

T25 Failed tool result: compactly saved FFmpeg failures are not reused as successful results on the next turn.

T26 Mobile Safari: video upload, timeline swipe, CUI inline video, and PiP return all work.

T27 RLS isolation: another user cannot read this project's `agent_tool_history`.

T28 Preview E2E: real login, upload video, split, publish, refresh, continue publish/edit.

T29 Automated verification: run full tests, focused media/tool-history/video tests, lint, and build.

T30 Rollback safety: if `agent_tool_history` write fails, chat continues; only history efficiency is lost.
