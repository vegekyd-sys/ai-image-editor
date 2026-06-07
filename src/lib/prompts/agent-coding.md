## Generic Coding (run_code)

Use this prompt for the `run_code` execution contract: return shapes, patching, workspace files, verification, and runtime routing.

Do not use this as a Remotion creative guide. For editable timelines, motion graphics, subtitles, overlays, trims, or Remotion Player work, read `prompts/remotion-composition.md`.

## Runtime Chooser

- `runtime: "composition"`: Remotion/editable composition runtime. Use for patchable motion graphics, typography, overlays, title cards, video timelines, and composition drafts.
- `runtime: "design"` or omitted: legacy alias for `runtime: "composition"`. The word `design` is a historical internal name, not a reason to route generic layout/mockup/image tasks to Remotion.
- `runtime: "node"`: open backend Node runtime with FFmpeg/FFprobe. Use for real file-level MP4 operations: split, exact trim/export, transcode, frame extraction, muxing, duration probing, long-video preparation, and final assembly of generated chunks.

If the task is a static poster, infographic, e-commerce page, layout image, or marketing visual, use `generate_image` unless the user explicitly asks for editable code or animation.

## Return Shapes

Return exactly one supported object:

```js
{ type: 'render', code, width, height, editables?, props?, animation? }
{ type: 'patch', edits, props?, editables?, code_path? }
{ type: 'image', data, mimeType }
{ type: 'video', path, contentType?, description?, duration?, width?, height? }
{ type: 'files', outputs: [{ path, contentType, description? }] }
{ type: 'text', content }
{ type: 'error', message }
```

Use `type: "render"` for a new composition draft, `type: "patch"` for subsequent composition edits, `type: "files"` for file batches or intermediate media, and `type: "video"` for one final MP4.

## Editable Composition Contract

Editable fields belong to the Remotion composition path only: `runtime: "composition"` / legacy `runtime: "design"` with `type: "render"` or `type: "patch"`. Do not add editable burden to `generate_image`, external video generation, node/FFmpeg exports, or sharp image outputs.

Make these editable:
- User-facing text: titles, subtitles, captions, labels, CTAs.
- Primary image layers the user may select, move, or resize.
- Primary video layers the user may select, move, resize, or trim.

Do not mark tiny decorative icons, static copyright text, purely structural wrappers, gradients, glows, or borders as editable.

Rules:
- Put `data-editable="fieldId"` on the visible measurable wrapper, not on a decorative parent. The wrapper needs explicit `width`+`height`, four edges/inset, or another stable measurable box, and should render as `block` or `inline-block`.
- Text content must live in `props`; JSX must read `props[propKey]` or `props['propKey']`. Never hardcode visible text in arrays or JSX when it is declared editable.
- Declare `editables` entries like `{ id, type: 'text' | 'image' | 'video', label, propKey }`.
- Image/video sources should read from `props[propKey]`; place `data-editable` on a wrapper around `<Img>` / `<Video>` so Moveable can resize the wrapper.
- Decorative layers above image/video editables must use `pointerEvents: 'none'`.
- Video trim editables must declare `trimBeforePropKey` and `trimAfterPropKey`, and wire those props to `<Video trimBefore={props.startFrame} trimAfter={props.endFrame}>` or equivalent prop keys.
- If a patch adds or removes visible editable text/image/video layers, return the complete updated `editables` array alongside the patch.

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
- For timeline videos, preserve the selected Media Index video aspect ratio. Two 9:16 videos spliced together must return a 9:16 canvas such as `width: 1080, height: 1920`, not a 16:9 canvas.
- `write_file({ fromLastRunCode: true, name: "slug", publish: false })` saves code to workspace without creating a timeline snapshot.
- `write_file({ fromLastRunCode: true, name: "slug" })` saves and publishes the composition to the timeline.
- `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: 3 })` publishes recent exported workspace videos to the timeline. Use this immediately after direct FFmpeg requests that create user-facing MP4s, such as "split this into three videos", "cut out this part", "trim/export this clip", or "transcode this video".
- When using a workspace output in later code, copy the exact `storageUrl` returned by `run_code` or `list_files`. Do not guess a workspace URL from the local filename; node runtime auto-generates timestamped workspace paths.

Node media runtime:
- `type: "files"` outputs are already saved workspace files. For direct user-facing MP4 requests such as "split this video into two videos", "split into three 10s videos", exact trim/export, transcode, or extracted preview clips, immediately publish the exported MP4s with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })` before telling the user it is done.
- Intermediate chunks for long-video model-preparation workflows stay as workspace outputs, not timeline snapshots, unless the user explicitly asks to see those chunks on the timeline.
- Publish only the final user-facing MP4 with `write_file({ fromLastRunCode: true, name: "slug" })`.
- If there are multiple exported workspace files and the user asks to put them on the timeline later, publish the existing workspace outputs with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })`; do not cut them again.
- If the user references timeline media such as `<<<media_1>>>` or `<<<media_2>>>`, pass those 1-based indices in the `run_code` tool input as `media_refs` (for example `media_refs: [1, 2]`). In node code, use `inputFiles`, not direct timeline URLs.
- Do not use a separate probe-only run for simple splits. In one node run, combine `probeVideo(input)` with fallbacks from `inputFiles[0].duration`, `ctx.media[0].duration`, or explicit user-stated cut points.
- Do not use node/FFmpeg for ordinary editable timeline splicing of two existing videos. If the user says "put these two videos together", "剪在一起", "add transitions/subtitles", or wants a free-edit timeline, use `runtime: "composition"` with Remotion `<Sequence>` and `<Video>`.
- Do not switch from composition to node/FFmpeg as a fallback for ordinary timeline splicing when preview is imperfect. Patch the Remotion composition or report the preview issue; keep the workflow editable.

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
- Final file-level assembly of generated chunks: `runtime: "node"`, `media_refs` or workspace paths for the generated MP4s, then export one mobile-safe MP4.
- Ordinary splice of two existing timeline videos: `runtime: "composition"`, not node.
- Failed or imperfect Remotion preview for ordinary splice: patch composition, not node fallback.
- If `inputFiles` is empty, stop and fix the tool call by adding `media_refs`; do not retry by hardcoding URLs.

## Verification

- Review code before screenshots: dimensions, positions, media URLs, text sizes, and return shape.
- Use `preview_frame` only when visual verification is needed.
- `preview_frame` screenshots are workspace image outputs and can be published directly with `write_file({ fromWorkspaceOutputs: true, mediaType: "image", limit: 1 })`; never use an image model just to move a screenshot onto the timeline.
- Batch preview frames in one turn when checking multiple frames.
- Do not use `<<<image_N>>>` to inspect drafts. Those only reference published timeline media.
