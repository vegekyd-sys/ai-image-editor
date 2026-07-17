# OpenMontage-Informed Studio Recipes

This migration uses OpenMontage's source tree as an architecture reference:
meta directors, creative craft knowledge, pipeline stage directors, and typed
review artifacts. The wording and implementation here are Makaron-native; the
AGPL source text is not copied into the product.

## What Moved

The highest-leverage ideas became shared Makaron director contracts:

| OpenMontage source area | Makaron adaptation |
| --- | --- |
| `meta/video-reference-analyst` | reference analysis plus keep/change and sample-first rules |
| `meta/taste-direction` + `meta/bespoke-composition` | subject-specific art direction and distinctness review |
| `meta/voice-performance-director` + `creative/sound-design` | voice, source speech, music, and timing contract |
| `meta/reviewer` | stage review, slideshow risk, source fidelity, and final MP4 review |
| pipeline checkpoint protocol | existing durable Studio Run stages, approvals, resume, and invalidation |

## User-Facing Choice Map

| OpenMontage production choice | Makaron choice | Status |
| --- | --- | --- |
| animated explainer | `explainer-video` | existing, full Studio Run |
| animation / motion graphics / data visualization | `motion-design-video` | added |
| cinematic | `cinematic-video` | added |
| reference-video entry point | `reference-video-studio` | added |
| talking-head | `source-video-studio` / `talking-head` mode | added |
| hybrid | `source-video-studio` / `hybrid` mode | added |
| documentary montage | `source-video-studio` / `documentary-montage` mode | added |
| screen demo | `screen-demo` | added |
| clip factory | `content-repurpose` / `clip-batch` mode | added |
| podcast repurpose | `content-repurpose` / `podcast-video` mode | added |
| localization dub | `localization-dub` | added |
| character animation | `character-animation` | added, local proof first |
| avatar spokesperson | `avatar-spokesperson` | added; precise lip sync is capability-gated |
| music-led video | `music-to-video` | added; original audio drives the edit |
| website showcase | `website-to-video` | added; real capture/screenshot evidence required |
| long-form craft guidance | `long-video-director` | existing; not forced into the 10-minute Studio Run limit |
| exact phoneme lip sync | provider capability gate | never implied by the adapter when the selected route lacks it |

The consolidation is intentional: users keep meaningful production choices,
while closely related batch/source modes share one maintained skill instead of
drifting into several near-duplicate prompts.

## Current Tool Mapping

Makaron reuses its existing primitives:

- OpenMontage selectors map to `generate_image`, `generate_animation`, voice,
  music, and audio tools already exposed to the Makaron agent.
- transcript and media review map to `analyze_video`, `analyze_image`, and
  `transcribe_audio`.
- composition and inspection map to `run_code`, `write_file`, `preview_frame`,
  and `materialize_media`.
- checkpoint and artifact persistence map to `studio_run`.

OpenMontage-specific Python tool names are not placed in Makaron skill
`allowed-tools` because the agent cannot call them here.

## CLI Acceptance

Discover the built-in recipes:

```bash
makaron skills list --built-in --json
makaron skills show cinematic-video --built-in --json

# Inspect every OpenMontage source-name adapter, including internal craft skills
makaron skills list --built-in --openmontage --json
```

Start a guided smoke without paid asset generation:

```bash
RUN_ID=$(makaron chat --project auto --skill cinematic-video --background \
  "做一条 15 秒产品预告片。先完成 brief 和 proposal，使用 guided approval，不生成付费资产。")
```

Wait for the agent turn, then assert that it entered the expected recipe:

```bash
makaron responses get "$RUN_ID" --wait --pick studio_recipe
# expected: cinematic-video

makaron responses get "$RUN_ID" --pick studio_run
# expected JSON includes recipe, current_stage, status, and all stage states
```

For a full preauthorized run, use a real project and state the approval policy
in the prompt. Materialize the composition from the same run:

```bash
makaron responses get "$RUN_ID" --materialize --wait --pick first_video_url
```

## Acceptance Conditions

1. Every added skill is discoverable through `/api/skills` and CLI.
2. Every skill exposes a machine-readable `studioRunRecipe` equal to its name.
3. Source-led skills declare `sourceMediaRequired: true`.
4. A CLI chat with `--skill` starts the matching Studio Run recipe.
5. `responses get --pick studio_recipe` returns the exact recipe without parsing
   human-readable text.
6. Guided runs stop at approval; auto runs persist all eight stages.
7. Final delivery requires an editable composition, materialized MP4, sampled
   frame review, and a passing delivery-promise check.
