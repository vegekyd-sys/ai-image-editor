# Grok Imagine Video reintegration experiment

## Goal

Re-evaluate xAI's current video surface from official documentation and real paid
outputs, then expose it in Makaron through the same provider-selection contract as
Seedance and Gemini Omni. Do not promote the branch or change the global default
until the real output and customer path pass acceptance.

## Official contract (2026-08-31)

Makaron presents one `grok` provider but routes to two xAI model contracts:

- `grok-imagine-video-1.5` for text-to-video, single-image-to-video, and
  reference-to-video. It supports 1-15 seconds, native audio, 480p/720p/1080p,
  up to 7 image references, and up to 3 preset voice IDs. Multi-reference output
  is capped at 720p. Single-image generation keeps the source aspect ratio because
  forcing a different ratio stretches the input.
- `grok-imagine-video` for video edit and extension. Edit accepts one MP4 up to
  8.7 seconds and retains source duration/aspect at up to 720p. Extension accepts
  one 2-15 second MP4 and adds 2-10 seconds (default 6); the returned MP4 is
  cumulative.

Current generation pricing is $0.08/s at 480p, $0.14/s at 720p, and $0.25/s at
1080p, plus $0.01 per input image. The base edit model charges $0.01/s of input
video and $0.05/s at 480p or $0.07/s at 720p output.

## Reproducible probes

The benchmark saves the submission, every observed status transition, total and
submit latency, provider cost, downloaded MP4, and ffprobe metadata.

On the current Mac, xAI is reached through the system proxy. Node 24 does not use
that proxy unless explicitly enabled, so prepend the benchmark commands with:

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:8118 HTTP_PROXY=http://127.0.0.1:8118
```

```bash
node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-xai-video.mjs \
  --image public/brand/makaron-app-icon-image2-source.png \
  --duration 6 --resolution 720p --label i2v-720

node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-xai-video.mjs \
  --image public/brand/makaron-app-icon-image2-source.png \
  --image public/brand/makaron-icon.png \
  --duration 4 --resolution 720p --label multi-ref-720 \
  --prompt '<IMAGE_1> and <IMAGE_2> remain recognizable while a small magenta spark travels between them.'

node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-xai-video.mjs \
  --video /path/to/source.mp4 --operation edit --label edit \
  --prompt 'Make the lighting warm gold. Preserve the subject, geometry, timing, camera motion, and all other details.'

node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-xai-video.mjs \
  --video /path/to/source.mp4 --operation extend --duration 2 --label extend \
  --prompt 'Continue the same camera motion and subject action naturally.'
```

## Acceptance gates

1. Decode every output end-to-end and verify actual resolution, duration, video
   codec, audio stream, and framing rather than trusting the task status.
2. Use identical source/prompt/duration for the 480p, 720p, and 1080p latency
   comparison. Record paid request latency rather than repeating a marketing ETA.
3. Visually inspect subject/logo fidelity, prompt adherence, motion stability,
   native audio, and whether edit preserves unrequested details.
4. Confirm multi-reference identity at 720p and reject 1080p before submission.
5. Confirm edit retains duration and extension returns source plus continuation.
6. Validate the Agent/CLI/MCP product path in the isolated worktree before merge.

## Observed results

### Paid provider matrix (2026-08-31)

All nine successful MP4s downloaded, decoded end-to-end, and contained one AAC
audio stream. One earlier attempt failed before submission because Node did not
inherit the Mac system proxy; it produced no request ID and incurred no provider
cost. Total provider cost for the successful matrix was $5.26.

| Mode | Request | Actual output | End-to-end | Provider cost |
| --- | --- | --- | ---: | ---: |
| Image-to-video | 6s 480p, square source | 544x544, 6.042s | 14.7s | $0.49 |
| Image-to-video | 6s 720p, matched input/prompt | 960x960, 6.042s | 26.8s | $0.85 |
| Image-to-video | 6s 1080p, matched input/prompt | 1440x1440, 6.042s | 34.2s | $1.51 |
| Text-to-video | 3s 480p, 16:9 | 848x480, 3.042s | 18.4s | $0.24 |
| Two-image reference | 4s 720p, square | 720x720, 4.042s | 31.1s | $0.58 |
| Distinct two-image reference | 4s 720p, 16:9 | 1280x720, 4.042s | 29.2s | $0.58 |
| Image + preset voice `eve` | 4s 480p, square | 480x480, 4.042s | 23.5s | $0.33 |
| Video edit | 6.042s square source | 960x960, 6.042s | 57.2s | $0.48 |
| Video extend | 6.042s source + 2s | 960x960, 8.042s | 29.1s | $0.20 |

The matched resolution series shows a useful latency/cost ladder: 480p was 14.7s,
720p was 26.8s, and native 1080p was 34.2s for the same 6-second clip. The 720p
result aligns closely with xAI's published approximately-25-second example. These
are one paid sample per size, not a P50/P95 benchmark.

### Visual and continuity read

- The matched 480p/720p/1080p runs all preserved the radial spark icon well and
  followed the requested gentle rotation/orbit. 480p showed a looser orbit and
  more shape drift; 720p and 1080p were cleaner.
- Edit successfully changed the background illumination to warm gold and kept
  the source timing, framing, main icon, camera motion, and orbiting spark. It
  also warmed some internal rays, so “change only the background” was not
  pixel-local; treat editing as generative, not masked/local editing.
- Extension returned the cumulative 8.042-second asset. Comparing its first
  6.042 seconds with the source produced SSIM 0.988975, and the final two seconds
  continued the same clockwise orbit and visual language. Preserve the source
  snapshot independently because the prefix is rewritten slightly.
- The first multi-reference probe used two closely related spark assets and
  incorporated both. The stronger distinct-identity probe kept the Pixel Wizard
  well but replaced the second source's radial spark emblem with an invented
  “M” badge. Therefore the endpoint and seven-reference plumbing are real, but
  exact multi-subject identity is not reliable enough to market as exact-instance
  preservation on this 1/1 distinct test.
- The preset `eve` request was accepted, completed, and produced an AAC track.
  This run proves preset-voice routing and audio generation; the exact spoken
  sentence was not independently transcribed, so semantic voice accuracy remains
  a separate acceptance check.

Artifacts are local and ignored under `artifacts/grok-imagine-video/`.

## Integration decision

- Ship the capability behind the existing `grok` selector in this branch, with
  internal 1.5 generation versus base-model edit/extend routing.
- Keep 480p as the existing product default for cheapest/fastest previews; expose
  720p and native 1080p, while rejecting 1080p for multi-reference requests.
- Expose edit and forward extension through the same `video_operation` contract
  used by Seedance 2.5 and Gemini Omni. Do not represent it as precise local or
  masked editing.
- Expose up to 7 references as a technical capability, but do not claim exact
  identity preservation until a broader fixed multi-subject benchmark passes.
- Do not change Makaron's global default model or merge/deploy from this worktree
  without the explicit promotion gate.
