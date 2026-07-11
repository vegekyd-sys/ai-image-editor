# OpenMontage Full Skill Migration

Source snapshot: `calesthio/OpenMontage@de348f1`.

Makaron preserves OpenMontage's production intent without copying its Python
orchestration or adding HyperFrames. Existing Makaron tools, workspace files,
Studio Run, Remotion, FFmpeg, and provider routes remain the execution layer.

## Coverage

| Source surface | Total | Native | Adapted | Excluded | Unavailable |
| --- | ---: | ---: | ---: | ---: | ---: |
| `.agents/skills` | 78 | 37 | 23 | 8 | 10 |
| `pipeline_defs` | 13 | 3 | 9 | 0 | 1 |
| Combined catalog | 91 | 40 | 32 | 8 | 11 |

The 72 supported source names are materialized as built-in Makaron skills.
Source names remain CLI-addressable even when several map to one maintained
Makaron workflow.

### Explicit exclusions

- `hyperframes`
- `hyperframes-animation`
- `hyperframes-cli`
- `hyperframes-core`
- `hyperframes-creative`
- `hyperframes-media`
- `hyperframes-registry`
- `remotion-to-hyperframes`

### Not applicable yet

- `agents`: real-time interactive ElevenLabs voice-agent hosting is not a
  Makaron media-production capability.
- `setup-api-key`: Makaron owns provider credentials server-side.
- `framework-smoke`: OpenMontage's test-only pipeline is not a product recipe.
- `gsap-*`: Makaron does not install or expose GSAP. Remotion can reproduce
  some motion patterns, but prompt-only translation is not a GSAP runtime.

## Product Surface

The CUI selector stays focused. It adds three genuinely new user choices:

- `avatar-spokesperson`
- `music-to-video`
- `website-to-video`

Existing `character-animation`, `screen-demo`, and `localization-dub` remain
visible. Provider and craft adapters such as `threejs-shaders`, `ffmpeg`, and
`doubao-tts` are available by exact CLI skill name but are hidden
from the UI selector and the per-run skill manifest.

## Runtime Mapping

| OpenMontage family | Makaron execution |
| --- | --- |
| image/provider craft | `generate_image`, existing Gemini/Qwen/Pony/WAI routes |
| generated video | `generate_animation`, Seedance/Kling/Grok/Google Omni |
| voice/music/SFX | voiceover, transcription, audio, and music tools |
| exact media editing | Node `run_code` plus FFmpeg/FFprobe |
| motion/Manim/Lottie craft | deterministic Remotion composition |
| GSAP | unavailable until the runtime is installed and renderer-tested |
| Three.js | injected `THREE` namespace inside DynamicDesign |
| complete production | Studio Run plus editable composition and reviewed MP4 |

Adapted provider skills never claim that an unavailable external vendor was
used. They preserve the creative intent and announce the Makaron-native route.

## Speed Path

- Internal adapters do not enter the normal system prompt.
- `studio_run start` returns all eight stage schemas in one response, avoiding
  separate schema tool calls.
- Auto-approved runs can persist Brief through Assets with one
  `studio_run.put_artifacts` call while emitting one CUI event per stage.
- Studio Run compositions use the compact `studio-remotion-fast-path` instead
  of loading three overlapping generic guides.
- Existing project assets and local code are preferred over paid generation.
- Compositions use one build, three parallel frame previews, one publish, and
  one materialization pass.
- Media is probed once and SHA is not computed unless explicitly requested.

In two equivalent six-second audio-led acceptance runs, this reduced agent time
from 380.9s to 337.0s, steps from 16 to 14, and model input from 879,580 to
621,480 tokens. Export calls remain fingerprint-idempotent, so waiting on a
queued composition does not render it twice.

## Renderer Parity

`THREE` is injected into the shared `DynamicDesign` runtime. Preview and final
Lambda export must use bundles built from the same source revision. Provision a
new isolated Lambda site with:

```bash
npm run ops:remotion-lambda-provision -- --site-name <site-name>
```

Set the returned URL as `REMOTION_LAMBDA_SERVE_URL` in the target environment.
The provision command never changes Vercel environments or deletes an existing
site. Rebuild `REMOTION_SNAPSHOT_ID` with `scripts/create-remotion-snapshot.mjs`
when the Remotion runtime changes.

## Acceptance

```bash
npm test -- --run __tests__/openMontageFullMigration.test.ts
npm test -- --run __tests__/studioRun.test.ts __tests__/agentDualWriter.test.ts

MAKARON_URL=http://localhost:3039 \
  node packages/makaron-cli/bin/makaron.mjs \
  skills list --built-in --openmontage --json
```

Representative live acceptance must cover at least:

1. one local composition craft (`threejs-*`, motion, diagram, or Manim adapter),
2. one source/audio-led workflow,
3. one generated/provider-led workflow,
4. exact Studio Run stage persistence and final MP4 probing.

### Accepted on 2026-07-11

- Three.js craft: real `THREE.BoxGeometry`, `EdgesGeometry`,
  `PerspectiveCamera`, and `Vector3`; three preview frames plus Lambda export;
  H.264, 640x360, 30fps, 6.000s.
- Music-to-video: all eight Studio Run stages completed, Brief through Assets
  emitted separately from one batch, editable composition plus H.264/AAC MP4;
  640x360, 30fps, 48kHz stereo, 6.037s.
- Seedance 2.0 provider: exact hidden skill activation, native text-to-video,
  one `seedance-mini` submission; H.264, 864x496, 24fps, 4.096s.
- Coverage/API/CLI: all 91 upstream entries accounted for, 72 supported source
  names CLI-addressable, 8 HyperFrames entries excluded, and only six migrated
  end-to-end workflows visible in the product selector.
- Automated suite: 437 of 438 repository tests pass. The sole failure is the
  pre-existing iOS login source-shape assertion in
  `iosAppStoreReadiness.test.ts`; all migration, Studio Run, Remotion, CLI,
  lint, and TypeScript checks pass.
