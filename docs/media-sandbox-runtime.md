# Dedicated Node Media Sandbox

`runtime: "node"` uses a disposable Vercel Sandbox created from
`MEDIA_SANDBOX_SNAPSHOT_ID`. It must not reuse `REMOTION_SNAPSHOT_ID`.

## Lifecycle

1. Next.js resolves project media and workspace files.
2. A fresh Node 24 Sandbox is created from the media snapshot.
3. Agent code and inputs are copied into the Sandbox.
4. The program runs with standard Node, npm, FFmpeg, and FFprobe.
5. Outputs are copied back and persisted to Supabase/workspace.
6. The Sandbox is stopped in `finally`; runtime installs and temporary files
   are discarded.

Missing bare npm packages are installed on demand inside the disposable
Sandbox. Common packages are pinned in `scripts/create-media-sandbox-snapshot.mjs`
to reduce latency and make normal media programs reproducible.

## Default commands

- `node`, `npm`, `npx`
- `ffmpeg`, `ffprobe`
- package CLIs under `/vercel/sandbox/node_modules/.bin`
- standard system commands from `/usr/local/bin`, `/usr/bin`, and `/bin`

## Preinstalled npm packages

- FFmpeg/probing: `ffmpeg-static`, `ffprobe-static`
- Image/media: `sharp`, `canvas`, `@napi-rs/canvas`, `exifr`,
  `heic-convert`, `image-size`, `jimp`, `pngjs`
- Archives/metadata: `jszip`, `music-metadata`, `file-type`
- Agent code: `typescript`, `tsx`, `sucrase`, `esbuild`
- Previous runtime compatibility: `remotion`, `@remotion/media`,
  `@remotion/media-utils`, `@remotion/renderer`

System fonts include Noto Sans CJK, Noto Color Emoji, Liberation, and DejaVu.

## Injected programming API

- `require`, `process`, `fetch`, `console`
- `ctx` / `context`
- `inputFiles`, `inputDir`, `outputDir`, `workDir`, `workspaceDir`
- `ffmpegPath`, `ffprobePath`
- `downloadFile`, `saveOutput`, `saveToWorkspace`, `probeVideo`

## Common FFmpeg operations

- probe duration, dimensions, codecs, and streams
- exact trim/split and H.264/AAC transcode
- resize, crop, pad, rotate, and mobile-safe `yuv420p` output
- extract frames and contact sheets
- preserve, mute, replace, normalize, or mux audio
- concatenate generated chunks into a final MP4
- add overlays/subtitles and create web-compatible `faststart` files

Create a new snapshot with `npm run snapshot:media`, set the resulting ID as
`MEDIA_SANDBOX_SNAPSHOT_ID`, then run the real Sandbox and `makaron chat` smoke
before promoting the ID to Production.
