---
name: wan-3-0
description: Generate 2-30 second Wan 3.0 Standard, Prime, or Pro videos through MuleRouter with text, image, video, or audio references.
allowed-tools: read_file analyze_image analyze_video generate_animation transcribe_audio run_code write_file
metadata:
  makaron:
    icon: "▶"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "makaron"
    sourceSkill: "wan-3-0"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "video-generation"
    canonicalSkill: "photo-to-video"
    tags: [wan, video-generation, multimodal, native, mulerouter, 4k]
---

# Wan 3.0

Use `generate_animation` with `model: "wan-3.0"` when the user explicitly
selects Wan 3.0 Standard or the video request is NSFW/adult-explicit. The Agent
must make this semantic choice itself; NSFW routing overrides the normal 16-30
second Seedance 2.5 duration default. Use `model: "wan-3.0-pro"` for explicit
Pro, super-resolution, 2K, or 4K requests. Use `model: "wan-3.0-prime"` when
the user explicitly asks for Prime, Fast, or lower latency. Keep the app default on
`seedance-fast` for other requests.

## Provider contract

- Output duration: 2-30 seconds.
- With video references, combined reference-video duration + output duration must
  be 30 seconds or less. Output duration is a whole number, so use
  `floor(30 - referenceDuration)`; a 5.04s reference permits at most 24s.
- Standard output: 480p, 720p, or 1080p (default) through MuleRouter
  `carrothub/w3.0-video`.
- Prime output: faster 480p, 720p, or 1080p (default) through MuleRouter
  `carrothub/w3.0-video-prime`.
- Pro output: 1080p (default), 2K, or 4K through MuleRouter
  `carrothub/w3.0-video-pro`. Historical Berry tasks continue polling
  `carrothub/berry-1.0-pro` because the two aliases use distinct task types.
- References: up to 10 images, 5 videos, and 5 audio files, with 20 total.
- Use `<<<media_N>>>` and `<<<audio_N>>>` in Makaron. The runtime translates
  them to Wan's `Image N`, `Video N`, and `Audio N` provider markers.
- Zero references uses text-to-video. Any media input—including one image—uses
  MuleRouter reference mode. Do not treat a single image as `first_frame`.
- Use `video_operation: "generate"` with feature references. Wan 3.0 does not
  expose typed direct edit or extend operations in Makaron.
- The runtime preflight rejects over-budget duration combinations before credit
  reservation and before MuleRouter submission. Do not retry the same values.
- Native synchronized audio is available. MuleRouter does not document a Wan 3.0
  content-filter switch, so do not pass or imply one.

## Completion

Return the real task ID, provider route, duration, resolution, reference counts,
and the final playable artifact after polling. Never treat submission alone as
visual acceptance.
