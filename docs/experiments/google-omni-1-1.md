# Gemini Omni 1.1 Flash integration experiment

## Goal

Compare the retiring `gemini-omni-flash-preview` endpoint with
`gemini-omni-1.1-flash` on identical owned inputs before promoting 1.1.

## Official contract delta

- Stable model ID: `gemini-omni-1.1-flash`.
- The old preview endpoint is scheduled to stop on 2026-09-30.
- Base clips remain 3-10 seconds, 16:9 or 9:16, with native generated audio.
- Output resolutions are 360p, 720p (default), 1080p upscale, and 4K upscale.
- New controls include first/last-frame interpolation and tail extension. Extension
  uses up to 10 seconds of prior context and can reach 40 seconds cumulatively.
- Uploaded audio references and voice editing remain unsupported.

## Reproducible A/B

Run from this worktree with the existing local key file. This command submits
the same source, prompt, duration, aspect ratio, and 720p resolution to both
model IDs and saves the final MP4s plus response/ffprobe metadata:

```bash
node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-google-omni-1-1.mjs \
  --image public/landing/trial-selfie-poster.jpg \
  --duration 5 \
  --aspect-ratio 9:16 \
  --resolution 720p
```

First/last-frame interpolation is a separate 1.1-only probe:

```bash
node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-google-omni-1-1.mjs \
  --model gemini-omni-1.1-flash \
  --image /path/to/first.png \
  --last-image /path/to/last.png \
  --duration 5 \
  --resolution 360p
```

## Acceptance gates

1. Both 720p A/B outputs download and decode; compare actual resolution, duration,
   audio stream, latency, face/subject fidelity, text/detail preservation, motion,
   temporal stability, and prompt adherence.
2. 360p is treated as a draft. 1080p and 4K are labeled as upscaled, never native.
3. Product adapter handles URI delivery for outputs above 4 MB.
4. Keep the current one-video-reference Makaron boundary; multi-video extension
   remains out of scope.
5. Promote extension only after its Refs-style input, persistence, billing, and
   recovery paths have regression coverage and a real provider probe succeeds.

## 2026-08-29 observed results

### Safety boundary

The first planned A/B used the repository's synthetic stadium portrait. Google
rejected it before generation with its recognizable-person/likeness safety rule.
No comparable output was produced, so the actual A/B moved to owned Makaron brand
art with no person.

### Matched 720p A/B

Source: `public/brand/makaron-app-icon-image2-source.png`. Both calls used the
same 5-second, 16:9, single-shot prompt and final 720p output.

| Metric | Old preview | Omni 1.1 |
| --- | ---: | ---: |
| End-to-end | 61.9s | 49.6s |
| Container | MP4 / H.264 + AAC | MP4 / H.264 + AAC |
| Video | 1280x720, 24fps | 1280x720, 24fps |
| Audio | AAC, 48kHz, stereo | AAC, 48kHz, stereo |
| Duration | 5.013s | 5.013s |
| File size | 1,197,387 bytes | 1,121,913 bytes |

Visual read: 1.1 followed the requested small camera orbit and retained the
rounded-square silhouette more closely. The old preview invented a stronger
glass extrusion and larger camera move. 1.1 also introduced a stronger pink wash.
This is one matched sample: it supports migration/API compatibility, not a claim
that 1.1 is universally higher quality.

Artifacts are kept locally under the ignored directory
`artifacts/google-omni-1-1/2026-08-29T14-21-33Z/`.

### 360p first/last-frame interpolation

The 1.1 request completed twice at 640x360, 24fps, H.264 + AAC, 48kHz stereo.
The first attempt used square images directly and revealed aggressive cropping.
After padding both inputs to 16:9, framing was materially more stable. The padded
run completed in 40.5 seconds and produced a 5.013-second, 408,478-byte MP4.

The last decoded frame was visually close to the requested standalone spark but
was not pixel-identical (SSIM 0.478 against the resized target). Product copy must
describe this as first/last-frame guidance or interpolation, not exact frame lock.
Local artifacts: `artifacts/google-omni-1-1/2026-08-29T14-26-17Z/`.

### Resolution and billing probes

The paid API response reports video output tokens by modality. Combined with
Google's `$17.50 / 1M video output tokens` rate, the observed per-second table is:

| Requested | Actual output | Video tokens/s | Video cost/s | Observed latency |
| --- | --- | ---: | ---: | ---: |
| 360p | 640x360 | 1,931 | $0.0337925 | 40.5s (5s interpolation probe) |
| 720p | 1280x720 | 5,792 | $0.10136 | 49.6s (5s matched A/B probe) |
| 1080p upscale | 1920x1080 | 8,688 | $0.15204 | 62.5s |
| 4K upscale | 3840x2160 | 17,376 | $0.30408 | 122.0s |

The 4K artifact was 4,437,174 bytes, so it also proves the product's URI delivery
and authenticated download path above the 4 MB inline-response boundary. The
capability table uses these measured rates for Credit estimation; text/image input
and thought tokens remain small additional provider costs outside this output-
video-second estimate. Extension input-video cost is measured separately below.

High-resolution artifacts remain local under
`artifacts/google-omni-1-1/2026-08-29T14-33-23Z/` and
`artifacts/google-omni-1-1/2026-08-29T14-34-33Z/`.

### Refs-style 10-second video extension

The extension probe reused the completed 5.013-second 720p Omni 1.1 clip as the
only video reference. The prompt asked the camera to continue its slow clockwise
orbit while preserving the existing Makaron icon, glass material, pink-purple
palette, lighting, and ambient audio. The provider task was explicitly `extend`
with a requested continuation duration of 10 seconds.

| Metric | Observed result |
| --- | ---: |
| Source duration | 5.013s |
| Returned MP4 duration | 15.018s |
| Added duration | about 10s |
| End-to-end latency | 65.568s |
| Output | 1280x720, 24fps, H.264 + AAC 48kHz stereo |
| File size | 3,126,851 bytes |
| Source-prefix SSIM | 0.994055 |
| Input video usage | 27,840 tokens |
| Output video usage | 57,920 tokens |
| Provider video cost | $1.0136 output + about $0.0417 source input |

The returned asset is cumulative: it contains the original source followed by the
continuation, rather than only a detached 10-second tail. Visual inspection found
strong continuity in the icon subject, glass material, color palette, lighting,
and clockwise camera motion. The continuation added a pedestal and resolved to a
centered ending, which is consistent with the requested next beat.

The first 5.013 seconds are not byte-identical to the source, but their decoded
SSIM of 0.994055 shows only a slight provider-side seam rewrite. Product behavior
therefore treats extension as a new, non-destructive video snapshot and preserves
the original snapshot independently.

The probe also revealed billable input-video tokens. Makaron now estimates those
at `$0.0083303411 / source second` in addition to the 10-second output estimate.
At the existing 2x markup, this specific 5s-to-15s request reserves 212 Credits;
a full 10-second source plus 10-second continuation reserves 220 Credits. Text and
thought tokens are a small additional provider cost outside this estimate.

Reproduction command:

```bash
node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
  scripts/benchmark-google-omni-1-1.mjs \
  --model gemini-omni-1.1-flash \
  --video artifacts/google-omni-1-1/2026-08-29T14-21-33Z/gemini-omni-1.1-flash-720p.mp4 \
  --operation extend \
  --duration 10 \
  --resolution 720p \
  --aspect-ratio 16:9 \
  --prompt "After the current ending, continue the same slow clockwise camera orbit while preserving the icon, glass material, pink-purple palette, lighting, and ambient audio."
```

Local artifacts are under
`artifacts/google-omni-1-1/2026-08-29T15-14-43Z/`, including the returned MP4,
source/output contact sheets, provider response, usage, and ffprobe metadata.

## Decision

- Proceed with the core 1.1 migration and resolution plumbing in this worktree.
- Keep 720p as the product default. Expose 360p as draft and label 1080p/4K as
  upscaled finals.
- Do not switch Makaron's global default away from Seedance Fast on this evidence.
- Enable one-video forward extension through the same Refs mental model already
  used by Seedance: reference a timeline video, choose `video_operation: "extend"`,
  describe the next beat, and save the cumulative result as a new snapshot.
- Default Omni extension to 10 seconds, preserve the source snapshot, and reject
  backward or multi-video extension.
- Reuse the stored Google interaction lineage when an Omni-generated result is
  extended again, avoiding re-upload of cumulative videos over 10 seconds and
  allowing 10-second continuations up to the official 40-second total.
- Stateful follow-ups must omit `generation_config.video_config.task`; Google
  rejects combining `previous_interaction_id` with an explicit video task.
- Keep first/last-frame interpolation behind experiment/product-design work until
  its media-role UI and real customer path have dedicated tests.
