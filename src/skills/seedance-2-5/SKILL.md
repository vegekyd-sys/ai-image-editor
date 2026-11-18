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

Use `generate_animation` with `model: "seedance-2.5"` for Eco generation and its longer duration,
higher reference limits, or edit/extend capabilities. A non-NSFW direct 21-30
second request with no explicit model uses this model by default, but NSFW/adult-explicit intent has
higher priority and defaults to Wan 3.0 Prime instead.

## Native 4K cost policy

Native 4K is expensive. Use it only when the user explicitly asks for native 4K
or explicitly selects Native + 4K. Ordinary video, vague “HD/high quality” and
failed tasks keep their existing routing; never upgrade or retry on native 4K.
The capability registry exposes high-cost resolutions and usage conditions.
For native 4K, first call `generate_animation` without `max_credits` to obtain a
no-charge quote for the actual output and measured video inputs. Show the total
Makaron credits before submitting the identical request with that ceiling.
An already authorized generation needs disclosure, not another permission loop.
If price or inputs exceed the ceiling, obtain and disclose the new quote first.
Supplier USD, supplier credits and Makaron credits are distinct; live quotes use
the configured price and markup. There is no automatic provider/Eco fallback.

## Provider contract

- Output duration: 4-30 seconds, or smart duration where the mode allows it.
- Native output: explicitly use `model: "seedance-2.5-native"` at 480p (default),
  720p, 1080p or 4k through EvoLink. Native 4K uses the same generation model IDs
  with `quality: "4k"`; it is not Eco enhancement. Native1080p/4k MP4 uses10bit
  HEVC and needs a compatible player. Seedance2.5 Flash remains480p/720p.
- Unqualified Seedance2.5 remains Eco480p generation followed by enhancement.
  Keep defaults unchanged. Native high-resolution generation needs its explicit
  configured rate; never downgrade, upscale or switch providers as a fallback.
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
