## Generic Coding (run_code)

Use this prompt for the `run_code` execution contract: return shapes, patching, workspace files, verification, and runtime routing.

Do not use this as a Remotion creative guide. For editable timelines, motion graphics, subtitles, overlays, trims, or Remotion Player work, read `prompts/remotion-composition.md`; for new compositions or major visual/timing patches, also read `skills/_shared/remotion-director-contract.md`.

## Runtime Chooser

- `runtime: "composition"`: Remotion/editable composition runtime. Use for patchable motion graphics, typography, overlays, title cards, video timelines, and composition drafts.
- `runtime: "design"` or omitted: legacy alias for `runtime: "composition"`. The word `design` is a historical internal name, not a reason to route generic layout/mockup/image tasks to Remotion.
- `runtime: "node"`: open backend Node runtime with FFmpeg/FFprobe. Use for real file-level MP4 operations: split, exact trim/export, transcode, frame extraction, muxing, duration probing, long-video preparation, and final assembly of generated chunks.

If the task is a static poster, infographic, e-commerce page, layout image, or marketing visual, use `generate_image` unless the user explicitly asks for editable code or animation.

## Code Artifact Workflow

For substantial normal Agent Run coding, use `write_code_file` first and then execute the saved source with `run_code({ code_path })`. Describe the specific artifact before the `content` field so the user can see what is being built while the real source streams. The workspace file is the durable source of truth for later execution, recovery, and patching.

For `runtime: "composition"`, the saved file may be a natural JS/TS/JSX/TSX Remotion module with imports/exports and a top-level `Composition`, or the legacy executable body that returns a render object. For a new natural module, pass width/height/animation as `run_code.composition` metadata while `code_path` supplies the source; do not repeat the source.

```js
const code = String.raw`
function Composition(props) {
  return <AbsoluteFill>{props.title}</AbsoluteFill>;
}
`;

return {
  type: 'render',
  code,
  width: 1920,
  height: 1080,
  props: { title: 'Hello' },
  animation: { fps: 30, durationInSeconds: 20 },
};
```

Use inline `run_code.code` only for small patches or short utilities. Long compositions may use numbered source files under the composition-parts workspace. Include `compositionMetadata` on the first part; `write_file` automatically assembles, validates, and autosaves after every successful write, so do not spend another model turn on an assembly-only `run_code` call. Do not shorten narration, scenes, animation, or visual detail to satisfy an aggregate character target.

## Return Shapes

Return exactly one supported object:

```js
{ type: 'render', code, width, height, props?, animation? }
{ type: 'patch', edits?, props?, code_path? }
{ type: 'image', data, mimeType }
{ type: 'video', path, contentType?, description?, duration?, width?, height? }
{ type: 'files', outputs: [{ path, contentType, description? }] }
{ type: 'text', content }
{ type: 'error', message }
```

Use `type: "render"` for a new composition draft, `type: "patch"` for subsequent composition edits, `type: "files"` for file batches or intermediate media, and `type: "video"` for one final MP4.

## Editable Boundary

Editable behavior belongs only to the Remotion composition path: `runtime: "composition"` / legacy `runtime: "design"` with `type: "render"` or `type: "patch"`. New compositions keep user-facing values in props and omit explicit `editables`; the runtime infers the Manifest. Do not add editable burden to `generate_image`, external video generation, node/FFmpeg exports, or sharp image outputs. For the full props-first text/image/video/trim rules, read `prompts/remotion-composition.md`.

## Patch Rules

When editing existing code, prefer `type: "patch"`:

```js
return {
  type: 'patch',
  code_path: 'code/snapshot-id.json', // required when editing a persisted workspace composition
  edits: [
    { old: 'exact string in current code', new: 'replacement string' }
  ],
  props: { /* optional text/data edits */ }
}
```

- Each `old` string must match exactly once. If it is ambiguous, include more surrounding context.
- Use patch for modify, add, or delete operations.
- Use props-only patches for text/data changes: `{ type: 'patch', code_path, props: {...} }`.
- Include `props` when changing editable values alongside code.
- If the current context includes `[Current Composition]`, `[Current composition pointer]`, or `[composition code: ...]`, include that exact path as `code_path`.
- If you need exact strings for a persisted composition, call `read_file(code_path)` once, then still return `type: "patch"` with the same `code_path`.
- Only use a fresh `render` when starting from scratch or replacing the whole structure.
- Do not rely on implicit remembered composition code across turns.

## Workspace And Publish

`run_code` previews or produces outputs. Successful composition renders and patches are immediately autosaved to the workspace recovery path returned as `code_path`. `write_file` publishes them or creates a named checkpoint.

Composition runtime:
- `type: "render"` and `type: "patch"` create a draft preview and autosave it before returning success.
- For timeline videos, preserve the selected Media Index video aspect ratio. Two 9:16 videos spliced together must return a 9:16 canvas such as `width: 1080, height: 1920`, not a 16:9 canvas.
- `write_file({ fromLastRunCode: true, name: "slug", publish: false })` creates an optional named workspace checkpoint without creating a timeline snapshot.
- `write_file({ fromLastRunCode: true, name: "slug" })` saves and publishes the composition to the timeline.
- `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: 3 })` publishes recent exported workspace videos to the timeline. Use this immediately after direct FFmpeg requests that create user-facing MP4s, such as "split this into three videos", "cut out this part", "trim/export this clip", or "transcode this video".
- When using a workspace output in later code, pass its exact workspace `path` via `workspace_paths`. Do not copy, download, or reconstruct Storage URLs; node runtime resolves workspace paths to local `inputFiles`.

Node media runtime:
- `type: "files"` outputs are already saved workspace files. For direct user-facing MP4 requests such as "split this video into two videos", "split into three 10s videos", exact trim/export, transcode, or extracted preview clips, immediately publish the exported MP4s with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })` before telling the user it is done.
- Intermediate chunks for long-video model-preparation workflows stay as workspace outputs, not timeline snapshots, unless the user explicitly asks to see those chunks on the timeline.
- Publish only the final user-facing MP4 with `write_file({ fromLastRunCode: true, name: "slug" })`.
- If there are multiple exported workspace files and the user asks to put them on the timeline later, publish the existing workspace outputs with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })`; do not cut them again.
- If the user references timeline media such as `<<<media_1>>>` or `<<<media_2>>>`, pass those 1-based indices in the `run_code` tool input as `media_refs` (for example `media_refs: [1, 2]`). If the user references workspace files from `list_files`, pass them as `workspace_paths`. In node code, use `inputFiles`, not direct timeline or Storage URLs.
- Do not use a separate probe-only run for simple splits. In one node run, combine `probeVideo(input)` with fallbacks from `inputFiles[0].duration`, `ctx.media[0].duration`, or explicit user-stated cut points.
- Do not use node/FFmpeg for ordinary editable timeline splicing of two existing videos. If the user says "put these two videos together", "剪在一起", "add transitions/subtitles", or wants a free-edit timeline, use `runtime: "composition"` with Remotion `<Sequence>` and `<Video>`.
- Do not switch from composition to node/FFmpeg as a fallback for ordinary timeline splicing when preview is imperfect. Patch the Remotion composition or report the preview issue; keep the workflow editable.

`generate_image` is the exception: it publishes directly to the timeline.

## Node Media Runtime

Read `skills/video-ffmpeg-lab/SKILL.md` before real MP4 work.

Available in `runtime: "node"`:
- Standard Node `require`, ESM/CommonJS, JS/TS/JSX/TSX, `process`, `Buffer`, `fetch`, filesystem, child processes, and normal Node built-ins inside a disposable Vercel Sandbox.
- Bare npm packages may be imported or required directly. Missing packages are installed inside the isolated Sandbox on first use, so keep valid application code instead of rewriting it around a Makaron package whitelist.
- `ffmpegPath`, `workDir`, `inputDir`, `outputDir`, `workspaceDir`.
- `ffprobePath` may be empty in deployment. Prefer `probeVideo(path)` instead of calling ffprobe directly.
- `inputFiles`: local files resolved from `media_refs` and `workspace_paths`, with `{ index, kind, inputPath, contentType, source, workspacePath, duration, width, height }`.
- `ctx.media`: full Media Index.
- `saveOutput(localPath, workspacePath?, contentType?)`.
- `probeVideo(path)`.

When execution returns a real compile, dependency, or runtime error, inspect the exact error and continue repairing the same saved program until it produces the requested artifact. Platform fallback must not become an excuse to stop before the user-visible result exists.

Prefer H.264/AAC/yuv420p with `-movflags +faststart` for mobile-compatible final MP4s.

Node media call checklist:
- Split one timeline video: `runtime: "node"`, `media_refs: [N]`, code reads `inputFiles[0].inputPath`.
- Final file-level assembly of generated chunks: `runtime: "node"`, pass timeline media as `media_refs` and workspace MP4s as `workspace_paths`, then export one mobile-safe MP4.
- Ordinary splice of two existing timeline videos: `runtime: "composition"`, not node.
- Failed or imperfect Remotion preview for ordinary splice: patch composition, not node fallback.
- If `inputFiles` is empty, stop and fix the tool call by adding `media_refs` or `workspace_paths`; do not retry by hardcoding URLs.

## Verification

- Review code before screenshots: dimensions, positions, media URLs, text sizes, and return shape.
- Use `preview_frame` only when visual verification is needed.
- `preview_frame` screenshots are workspace image outputs and can be published directly with `write_file({ fromWorkspaceOutputs: true, mediaType: "image", limit: 1 })`; never use an image model just to move a screenshot onto the timeline.
- Batch preview frames in one turn when checking multiple frames.
- Do not use `<<<image_N>>>` to inspect drafts. Those only reference published timeline media.
