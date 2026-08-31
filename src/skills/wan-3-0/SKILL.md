---
name: wan-3-0
description: Generate cost-efficient 2-30 second Wan 3.0 videos through Evolink with text, image, video, or audio references.
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
    tags: [wan, video-generation, multimodal, native, evolink]
---

# Wan 3.0

Use `generate_animation` with `model: "wan-3.0"` only when the user explicitly
selects or requests Wan 3.0. Keep the app default on `seedance-fast` otherwise.

## Provider contract

- Output duration: 2-30 seconds.
- Output resolution: 480p, 720p (default), or 1080p through Evolink.
- References: up to 10 images, 5 videos, and 5 audio files, with 20 total.
- Use `<<<media_N>>>` and `<<<audio_N>>>` in Makaron. The runtime translates
  them to Wan's `Image N`, `Video N`, and `Audio N` provider markers.
- Zero references routes to `wan3.0-text-to-video`; one image routes to
  `wan3.0-image-to-video`; other reference mixes route to
  `wan3.0-reference-video`.
- Use `video_operation: "generate"` with feature references. Wan 3.0 does not
  expose typed direct edit or extend operations in Makaron.
- Native synchronized audio is available. Evolink does not document a Wan 3.0
  content-filter switch, so do not pass or imply one.

## Completion

Return the real task ID, provider route, duration, resolution, reference counts,
and the final playable artifact after polling. Never treat submission alone as
visual acceptance.
