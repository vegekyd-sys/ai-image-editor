---
name: video-ffmpeg-lab
description: Real MP4 editing mindset for Makaron Agent using run_code runtime=node, FFmpeg, FFprobe, and workspace outputs.
allowed-tools: run_code generate_animation analyze_video transcribe_audio write_file
---

# Video FFmpeg Lab

Use `run_code` with `runtime: "node"` whenever the user asks for real file-level MP4 operations: split, exact trim/export, transcode, resize, crop, extract frames, preserve audio, replace audio, or prepare long videos for Seedance/Kling.

Use this skill for file truth, not design truth:

- Choose FFmpeg when the user cares about an existing MP4 as a file: exact duration, codecs, chunking, audio, export format, model-sized chunks, or final file-level deliverables.
- Choose Remotion/composition runtime when the user wants editable timelines, two existing timeline videos cut together, typography systems, reusable title cards, overlays, transitions, subtitles, or patchable code.
- A common long-video generation pipeline is FFmpeg first, model generation second, file-level assembly last. Remotion is separate and optional unless the user wants an editable timeline layer.
- Do not use Remotion to fake a source-video split/export task. Do not use FFmpeg when the request is really "put these timeline videos together in an editable sequence."

This is intentionally a recipe skill, not a narrow tool. You have a full Node backend:

- `require('fs')`, `require('path')`, `require('child_process')`
- `ffmpegPath`
- `ffprobePath` may be empty in deployment. Prefer `probeVideo(path)` instead of calling ffprobe directly.
- `workspaceDir`
- `inputFiles` from `media_refs` and `workspace_paths`, already resolved to local files
- `ctx.media` with video metadata for timeline snapshots
- `outputDir` for generated files
- `saveOutput(localPath, workspacePath?, contentType?)`
- `probeVideo(path)`

Tool call rule: when FFmpeg work references timeline media such as `<<<media_1>>>`, `<<<media_2>>>`, or "current video", the `run_code` tool call must include those 1-based indices as `media_refs`. Example: split `<<<media_1>>>` → `media_refs: [1]`. When FFmpeg work references files from workspace, pass exact paths as `workspace_paths`. Inside code, use `inputFiles[N].inputPath`. Do not download or hardcode `ctx.media[N].url`; use it only for metadata or diagnostics. If the task is simply cutting two existing timeline videos together, stop and use Remotion composition instead.

Transcript rule: when the requested cut point depends on spoken words, subtitles, dialogue, or "the part where they say ...", call `transcribe_audio` before `run_code`. Use the returned utterance/word timestamps as the segment plan; do not guess speech timing from `analyze_video`.

Publish rule: if FFmpeg produces user-facing MP4 deliverables, publish them to the timeline immediately with `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })` or exact `workspacePaths` before saying the task is complete. Examples: "split this video into 3 parts", "cut the first 10 seconds", "trim/export this clip", "transcode this MP4". If FFmpeg already exported workspace images/videos and the user later says "publish/send them to timeline", publish existing outputs; do not re-run the FFmpeg cut just to publish.

Probe rule: do not spend a separate `run_code` call only to probe before a simple split. In one node run, call `probeVideo(input)` and fall back to `inputFiles[0].duration`, `ctx.media[0].duration`, or explicit user-stated cut points. If the user says "30s into 3 x 10s", cut those ranges directly in the same run.

## Think in FFmpeg primitives

Do not memorize one tool per request. Translate the user's intent into a small graph:

- Inspect: `probeVideo(input)` for duration, size, fps, codecs.
- Select time: trim, split into equal parts, split by max duration, or cut around highlights.
- Transform image: scale, crop, pad, rotate, stabilize-ish crop, color grade, overlay text/image.
- Transform sound: keep audio, mute, normalize, replace BGM, delay, fade in/out.
- Assemble file deliverables: stitch generated chunks, mux audio, make proxy/preview, export mobile MP4.
- Verify: probe every MP4 and return useful descriptions.

For Makaron UX, prefer H.264/AAC/yuv420p with `-movflags +faststart` unless the user asks for another format.

## Model capability mindset

Do not hardcode one workflow per model. Treat model limits as capabilities:

- `maxReferenceVideoDuration`: longest source/reference clip the model can accept.
- `referenceVideoSize`: provider input size constraints such as file size, width/height, aspect ratio, and frame pixels.
- `maxOutputDuration`: longest generated output duration per task.
- `longVideoChunkSeconds`: target FFmpeg chunk length for long-video pipelines.
- `supportsBaseVideoEdit`: whether direct base video editing is supported.

Current known defaults:

| Model | Chunk target | Reference duration | Reference size | Notes |
| --- | ---: | ---: | --- | --- |
| SeeDance | 15s | 15.5s | <=50MB; width/height 300-6000px; aspect ratio 0.4-2.5; frame pixels 409,600-2,086,876 | Default video model, higher quality, feature/reference mode preferred. The lower frame-pixel bound matters: tiny videos must be resized/padded before submission. |
| Kling | 15s | 10.5s | <=200MB; resolution <=2K; no documented video resolution lower bound | Cheaper option, supports base video edit when capability allows it. |

If a new model appears, follow its capability/tool error messages instead of inventing a new case. The long-video generation workflow stays the same: probe → segment to accepted duration → generate per segment → assemble generated outputs.

When the user asks to make the run cheaper, prefer Kling only when the requested source duration, reference-video mode, text/audio needs, and tool errors indicate Kling can support it. If Kling cannot handle the requested operation, say so briefly and continue with SeeDance.

## Segment planner pattern

Use this one pattern for "split into two", "make <=15s chunks", "cut first 5s", or "prepare for Seedance". Change only `segments`.

```js
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const exec = promisify(execFile);

if (!inputFiles.length) throw new Error('Missing media_refs. Call run_code again with media_refs: [1] for <<<media_1>>>.');
const input = inputFiles[0].inputPath;
const info = await probeVideo(input).catch(() => ({}));
const duration = info.duration || inputFiles[0].duration || ctx.media?.[0]?.duration || 0;

// Pick ONE segment plan:
const parts = [
  // If the user explicitly requested 30s split into 3 equal videos:
  { start: 0, len: 10, label: 'Part 1' },
  { start: 10, len: 10, label: 'Part 2' },
  { start: 20, len: 10, label: 'Part 3' },

  // Exactly two videos:
  // { start: 0, len: duration / 2, label: 'Part 1' },
  // { start: duration / 2, len: duration / 2, label: 'Part 2' },

  // Or <=15s chunks:
  // ...Array.from({ length: Math.ceil(duration / 15) }, (_, i) => ({
  //   start: i * 15,
  //   len: Math.min(15, duration - i * 15),
  //   label: `Part ${i + 1}`,
  // })),
];

const outputs = [];
for (const [i, part] of parts.entries()) {
  const out = path.join(outputDir, `part-${String(i + 1).padStart(2, '0')}.mp4`);
  await exec(ffmpegPath, [
    '-ss', String(part.start),
    '-i', input,
    '-t', String(part.len),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    out,
  ]);
  const probe = await probeVideo(out);
  outputs.push({ path: out, contentType: 'video/mp4', description: `${part.label}: ${probe.duration?.toFixed(2)}s` });
}

return { type: 'files', outputs };
```

After a split run, treat the returned files as a manifest. Do not run the same split again unless the source video, model limit, or requested cut points changed.

For direct split/trim/export requests, `type: "files"` contains the MP4 deliverables. Do not stop at workspace paths: immediately publish those exported MP4s to the timeline with one `write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: N })` call so the user can see them. Do not start a second `run_code` just to re-open a file from the previous temp directory; reuse workspace paths with `workspace_paths` when more assembly is needed.

## Final file assembly pattern

Use this only after a workflow has produced file-level chunks that need one exported MP4, such as generated long-video segments. Do not use this as the default for "put two existing timeline videos together"; that is Remotion composition work.

```js
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const exec = promisify(execFile);

if (inputFiles.length < 2) throw new Error('Missing media_refs. Call run_code again with media_refs for every clip, e.g. [1, 2].');
const listPath = path.join(outputDir, 'concat.txt');
await fs.writeFile(
  listPath,
  inputFiles.map(f => `file '${f.inputPath.replace(/'/g, "'\\''")}'`).join('\n')
);

const out = path.join(outputDir, 'final.mp4');
await exec(ffmpegPath, [
  '-f', 'concat',
  '-safe', '0',
  '-i', listPath,
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-movflags', '+faststart',
  out,
]);

const probe = await probeVideo(out);
return {
  type: 'video',
  path: out,
  contentType: 'video/mp4',
  description: 'Final stitched MP4',
  duration: probe.duration,
  width: probe.width,
  height: probe.height,
};
```

## Useful command shapes

Use these as building blocks inside the segment planner or assembly pattern:

```js
// Trim without re-encoding when speed matters and keyframe precision is acceptable:
['-ss', '10', '-i', input, '-t', '5', '-c', 'copy', out]

// Precise trim / mobile-safe transcode:
['-ss', '10', '-i', input, '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out]

// Resize/crop for platform formats:
['-i', input, '-vf', 'scale=1080:-2,crop=1080:1350', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]

// Extract analysis frames:
['-i', input, '-vf', 'fps=1,scale=720:-1', '-q:v', '3', path.join(outputDir, 'frame-%03d.jpg')]

// Replace audio with a generated or uploaded BGM:
['-i', input, '-i', bgm, '-map', '0:v:0', '-map', '1:a:0', '-shortest', '-c:v', 'copy', '-c:a', 'aac', out]

// Mute:
['-i', input, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]
```

## Long-video style transfer through video models

1. Analyze/probe the source video.
2. Choose model capability: SeeDance is default; Kling is cheaper when it supports the request.
3. Use the segment planner once to create model-sized chunks: Kling `<=15s`, SeeDance `<=15s`.
4. Save chunks to workspace and keep the returned manifest in the conversation.
5. Call `generate_animation` for each chunk with the user's requested model and the same style direction.
6. Use the assembly pattern to stitch generated chunks.
7. Publish only the final MP4 with `write_file({ fromLastRunCode: true, name: "..." })`.

## Long-video state machine

Use this checklist to avoid repeated splitting and wasted tokens:

1. `probe_source`: inspect the original MP4 once.
2. `split_source`: create chunks once and return `type: "files"` with descriptions like `Chunk 1/2, 14.98s`.
3. `generate_chunks`: submit each manifest chunk to `generate_animation`.
4. `collect_outputs`: wait for all generated chunk URLs.
5. `assemble_outputs`: run `runtime: "node"` once to stitch generated chunks into a final MP4.
6. `publish_final`: call `write_file` once for the final MP4.

Never publish source chunks for model-preparation workflows as timeline snapshots unless the user explicitly asks to see the chunks as separate videos. Direct user-facing split/trim/export requests are different: publish those MP4 deliverables to the timeline.

Never split a generated chunk again unless a tool error says the generated chunk is still too long for the next step.

If the user asks for two separate deliverable videos, export both from the first `type: "files"` run and publish both to the timeline with `fromWorkspaceOutputs`. If a long-video generation workflow needs one final file deliverable, return one `type: "video"` from the final assembly run and publish that single final MP4 with `write_file`.
