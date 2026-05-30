---
name: video-ffmpeg-lab
description: Real MP4 editing mindset for Makaron Agent using run_code runtime=node, FFmpeg, FFprobe, and workspace outputs.
allowed-tools: run_code generate_animation analyze_video write_file
---

# Video FFmpeg Lab

Use `run_code` with `runtime: "node"` whenever the user asks for real MP4 operations: split, trim, concat, transcode, resize, crop, extract frames, preserve audio, replace audio, or prepare long videos for Seedance/Kling.

This is intentionally a recipe skill, not a narrow tool. You have a full Node backend:

- `require('fs')`, `require('path')`, `require('child_process')`
- `ffmpegPath`, `ffprobePath`
- `inputFiles` from `media_refs`
- `ctx.media` with real `.mp4` URLs for video snapshots
- `outputDir` for generated files
- `saveOutput(localPath, workspacePath?, contentType?)`
- `probeVideo(path)`

## Think in FFmpeg primitives

Do not memorize one tool per request. Translate the user's intent into a small graph:

- Inspect: `probeVideo(input)` for duration, size, fps, codecs.
- Select time: trim, split into equal parts, split by max duration, or cut around highlights.
- Transform image: scale, crop, pad, rotate, stabilize-ish crop, color grade, overlay text/image.
- Transform sound: keep audio, mute, normalize, replace BGM, delay, fade in/out.
- Assemble: concat clips, mux audio, make proxy/preview, export mobile MP4.
- Verify: probe every MP4 and return useful descriptions.

For Makaron UX, prefer H.264/AAC/yuv420p with `-movflags +faststart` unless the user asks for another format.

## Model capability mindset

Do not hardcode one workflow per model. Treat model limits as capabilities:

- `maxReferenceVideoDuration`: longest source/reference clip the model can accept.
- `maxOutputDuration`: longest generated output duration per task.
- `longVideoChunkSeconds`: target FFmpeg chunk length for long-video pipelines.
- `supportsBaseVideoEdit`: whether direct base video editing is supported.

Current known defaults:

| Model | Chunk target | Reference limit | Notes |
| --- | ---: | ---: | --- |
| SeeDance | 15s | 15.5s | Default video model, higher quality, feature/reference mode preferred. |
| Kling | 10s | 10.5s | Cheaper option, supports base video edit when capability allows it. |

If a new model appears, follow its capability/tool error messages instead of inventing a new case. The workflow stays the same: probe → segment to accepted duration → generate per segment → concat.

When the user asks to make the run cheaper, prefer Kling only when the requested source duration, reference-video mode, text/audio needs, and tool errors indicate Kling can support it. If Kling cannot handle the requested operation, say so briefly and continue with SeeDance.

## Segment planner pattern

Use this one pattern for "split into two", "make <=15s chunks", "cut first 5s", or "prepare for Seedance". Change only `segments`.

```js
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const exec = promisify(execFile);

const input = inputFiles[0].inputPath;
const info = await probeVideo(input);
const duration = info.duration || 0;
if (!duration) throw new Error('Could not read video duration');

// Pick ONE segment plan:
const parts = [
  // Exactly two videos:
  { start: 0, len: duration / 2, label: 'Part 1' },
  { start: duration / 2, len: duration / 2, label: 'Part 2' },

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

For direct split/trim/export requests, `type: "files"` is the final answer. The returned workspace URLs are the MP4 deliverables. Do not call `write_file` for each returned file, and do not start a second `run_code` just to re-open a file from the previous temp directory.

## Assembly pattern

```js
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const exec = promisify(execFile);

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
3. Use the segment planner once to create model-sized chunks: Kling `<=10s`, SeeDance `<=15s`.
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
5. `concat_outputs`: run `runtime: "node"` once to stitch generated chunks.
6. `publish_final`: call `write_file` once for the final MP4.

Never publish source chunks as timeline snapshots unless the user explicitly asks to see the chunks as separate videos.

Never split a generated chunk again unless a tool error says the generated chunk is still too long for the next step.

If the user asks for two separate deliverable videos, return both URLs from the first `type: "files"` run and stop. If the user asks for one final edited video, return one `type: "video"` from the concat/final run and publish that single final MP4 with `write_file`.
