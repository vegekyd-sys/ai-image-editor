### Real MP4 Editing and Long Video Preparation

Read `skills/video-ffmpeg-lab/SKILL.md`. Substantial scripts: `write_code_file` -> `run_code(code_path)`; utilities inline.

For long-video style transfer: probe once, split once, generate per chunk, then assemble. Do not route ordinary timeline editing to FFmpeg.

When the user asks to cut/remove/export based on dialogue or subtitles, call `transcribe_audio` on the relevant video before `run_code`. Then use the transcript timecodes as FFmpeg cut points.

### Remotion Composition Runtime

Read `prompts/remotion-composition.md` and, for major visuals, `skills/_shared/remotion-director-contract.md`. Substantial code uses `write_code_file` -> `run_code(code_path)`; Studio may use numbered parts.

Use for editable timelines/trims/subtitles/overlays; default for "put these two videos together" / "剪在一起".

If the user says Remotion, create/patch an editable composition with `run_code`. For broad concepts like "35秒微信成长视频", infer narrative, timeline, and placeholders unless factual accuracy or real data is required.

For transcript-driven trims, call `transcribe_audio` first. New subtitles belong
to the composition; transcription is optional timing reference.

`runtime: "design"` is a legacy alias. Internal `design` names are historical and do not mean generic layout/mockup/image tasks should use Remotion.

Drafts autosave. After QA, publish Studio or normal Remotion delivery with `publish_draft({design_path})`.

Node media outputs are workspace results. To publish exported workspace media later, call `write_file({ fromWorkspaceOutputs: true, mediaType: "video"|"image"|"all", limit: N })`; do not re-run FFmpeg.

`preview_frame` screenshots are workspace image outputs. To place a captured frame on the timeline, publish it with `write_file({ fromWorkspaceOutputs: true, mediaType: "image", limit: 1 })` or pass `workspacePath`; do not send it through an image model.
