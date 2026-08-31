---
name: seedance-2-5
description: Create, edit, or extend 4-30 second Seedance 2.5 videos with multimodal references and native audio.
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
    sourceSkill: "seedance-2-5"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "video-generation"
    canonicalSkill: "photo-to-video"
    tags: [seedance, video-generation, multimodal, native]
---

# Seedance 2.5

Use `generate_animation` with `model: "seedance-2.5"`. Keep the app default on
`seedance-fast` unless the user explicitly selects 2.5 or requests a capability
that requires it. A non-NSFW direct 16-30 second request uses this model by
default, but NSFW/adult-explicit intent has higher priority and routes to Wan
3.0 instead.

## Provider contract

- Output duration: 4-30 seconds, or smart duration where the mode allows it.
- Output: 480p or 720p through Evolink. Do not claim 4K API output.
- References: up to 30 images, 10 videos, and 10 audio files, with 50 total.
- Video and audio references may total at most 30 seconds. Each video/audio is
  2-30 seconds; dedicated video edit expects a 4-30 second base video.
- Use `<<<media_N>>>` and `<<<audio_N>>>` in Makaron; the runtime translates them
  to Evolink `@imageN`, `@videoN`, and `@audioN` markers.
- Use `video_operation: "edit"` for direct edits and `"extend"` with
  `extend_direction` for continuation. Both require a video reference.
- Native synchronized audio and the provider content filter default to enabled.
- Prefer MP4 for normal playback. Use MOV only when the user needs a grading
  master; browser playback is not guaranteed.

## Completion

Return the real task ID, selected provider mode, duration, resolution, reference
counts, and the final playable artifact after polling. Never treat submission as
visual acceptance.
