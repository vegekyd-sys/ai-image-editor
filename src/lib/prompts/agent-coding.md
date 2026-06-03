## Generic Coding (run_code)

Use this prompt for the `run_code` execution contract: return shapes, patching, workspace files, verification, and runtime routing.

Do not use this as a Remotion creative guide. For editable timelines, motion graphics, subtitles, overlays, trims, or Remotion Player work, read `prompts/remotion-composition.md`.

## Runtime Chooser

- `runtime: "composition"`: Remotion/editable composition runtime. Use for patchable motion graphics, typography, overlays, title cards, video timelines, and composition drafts.
- `runtime: "design"` or omitted: legacy alias for `runtime: "composition"`. The word `design` is a historical internal name, not a reason to route generic layout/mockup/image tasks to Remotion.
- `runtime: "node"`: open backend Node runtime with FFmpeg/FFprobe. Use for real media files: MP4 split/trim/concat/transcode, frame extraction, muxing, duration probing, and long-video preparation.

If the task is a static poster, infographic, e-commerce page, layout image, or marketing visual, use `generate_image` unless the user explicitly asks for editable code or animation.

## Return Shapes

Return exactly one supported object:

```js
{ type: 'render', code, width, height, editables?, props?, animation? }
{ type: 'patch', edits, props?, code_path? }
{ type: 'image', data, mimeType }
{ type: 'video', path, contentType?, description?, duration?, width?, height? }
{ type: 'files', outputs: [{ path, contentType, description? }] }
{ type: 'text', content }
{ type: 'error', message }
```

Use `type: "render"` for a new composition draft, `type: "patch"` for subsequent composition edits, `type: "files"` for file batches or intermediate media, and `type: "video"` for one final MP4.

## Patch Rules

When editing existing code, prefer `type: "patch"`:

```js
return {
  type: 'patch',
  code_path: 'code/snapshot-id.json', // required when editing a persisted workspace composition
  edits: [
    { old: 'exact string in current code', new: 'replacement string' }
  ]
}
```

- Each `old` string must match exactly once. If it is ambiguous, include more surrounding context.
- Use patch for modify, add, or delete operations.
- Include `props` when changing editable values alongside code.
- If the current context includes `[Current Composition]`, `[Current composition pointer]`, or `[composition code: ...]`, include that exact path as `code_path`.
- If you need exact strings for a persisted composition, call `read_file(code_path)` once, then still return `type: "patch"` with the same `code_path`.
- Only use a fresh `render` when starting from scratch or replacing the whole structure.
- Do not rely on implicit remembered composition code across turns.

## Workspace And Publish

`run_code` previews or produces outputs. `write_file` persists them.

Composition runtime:
- `type: "render"` and `type: "patch"` create a draft preview.
- `write_file({ fromLastRunCode: true, name: "slug", publish: false })` saves code to workspace without creating a timeline snapshot.
- `write_file({ fromLastRunCode: true, name: "slug" })` saves and publishes the composition to the timeline.
- `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: 3 })` publishes recent exported workspace videos to the timeline. Use this when the user says "publish the videos you just exported"; do not re-run FFmpeg.

Node media runtime:
- `type: "files"` outputs are already saved workspace files. For direct requests such as "split this video into two videos", return those URLs and stop.
- Intermediate chunks for long-video workflows stay as workspace outputs, not timeline snapshots.
- Publish only the final user-facing MP4 with `write_file({ fromLastRunCode: true, name: "slug" })`.
- If there are multiple exported chunk files and the user asks to put them on the timeline, publish the existing workspace outputs with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })`; do not cut them again.
- If the user references timeline media such as `<<<media_1>>>` or `<<<media_2>>>`, pass those 1-based indices in the `run_code` tool input as `media_refs` (for example `media_refs: [1, 2]`). In node code, use `inputFiles`, not direct timeline URLs.

`generate_image` is the exception: it publishes directly to the timeline.

## Node Media Runtime

Read `skills/video-ffmpeg-lab/SKILL.md` before real MP4 work.

Available in `runtime: "node"`:
- `require`, `process`, `Buffer`, `fetch`, and normal Node built-ins.
- `ffmpegPath`, `workDir`, `inputDir`, `outputDir`.
- `ffprobePath` may be empty in deployment. Prefer `probeVideo(path)` instead of calling ffprobe directly.
- `inputFiles`: downloaded `media_refs` with `{ index, kind, url, inputPath, contentType, duration, width, height }`.
- `ctx.media`: full Media Index.
- `saveOutput(localPath, workspacePath?, contentType?)`.
- `probeVideo(path)`.

Prefer H.264/AAC/yuv420p with `-movflags +faststart` for mobile-compatible final MP4s.

Node media call checklist:
- Split one timeline video: `runtime: "node"`, `media_refs: [N]`, code reads `inputFiles[0].inputPath`.
- Concat two timeline videos: `runtime: "node"`, `media_refs: [A, B]`, code reads both `inputFiles`.
- If `inputFiles` is empty, stop and fix the tool call by adding `media_refs`; do not retry by hardcoding URLs.

## Verification

- Review code before screenshots: dimensions, positions, media URLs, text sizes, and return shape.
- Use `preview_frame` only when visual verification is needed.
- Batch preview frames in one turn when checking multiple frames.
- Do not use `<<<image_N>>>` to inspect drafts. Those only reference published timeline media.
