---
name: makaron
description: Use Makaron CLI to generate AI images, videos, music, and motion designs. Trigger when user needs creative media production — photo editing, video generation, music composition, or design creation. Requires `npx makaron-cli` and MAKARON_API_KEY env var.
---

# Makaron CLI — Agent Integration Skill

> **makaron.app** is for humans. **makaron-cli** is for AI agents.

Makaron is a multimodal AI creative agent. You talk to it via `makaron chat`, and it produces images, videos, music, and animated designs — all saved to a persistent project.

## Setup

### Get your API key

**Option A: Human login**
1. Go to [makaron.app](https://makaron.app) and log in
2. Open the menu (top-right) → **Get API Key**
3. Copy your `mk_live_...` key

**Option B: Self-Registration (no human required)**
```bash
# Step 1: Get challenge
npx makaron-cli register --json
# → { "challenge_id": "...", "challenge": "...", "expected_format": "numeric, round to 2 decimal places" }

# Step 2: Solve and verify
npx makaron-cli register --verify --challenge-id <id> --answer 34.5
# → Key saved to ~/.makaron/auth.json
# → { "api_key": "mk_live_...", "credits": N, "claim_url": "..." }

# (Optional) Let a human claim this account
npx makaron-cli claim
# → { "claim_url": "..." } — share with human to link key to their account (valid 7 days)
```

Discovery endpoint: `GET https://www.makaron.app/api/agent/register` — returns full registration flow + CLI usage as JSON.

After self-registration the key is saved locally — no need to export `MAKARON_API_KEY`.

```bash
export MAKARON_API_KEY=mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Verify: `npx makaron-cli list` should show projects.

Check the current credit balance and subscription:
```bash
npx makaron-cli credits
npx makaron-cli credits --json
```

## Core Workflow

```bash
# One-shot: create project + upload image + submit prompt — all in one command
RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic and create a 5s video")

# Wait for the final customer-ready result
npx makaron-cli responses get $RUN_ID --wait --json
```

Or with an existing project:
```bash
RUN_ID=$(npx makaron-cli chat --project $PROJECT_ID -b "make a 5s video")
npx makaron-cli responses get $RUN_ID --wait --json
```

## Primary: `chat` (Agent-driven creative work)

Use `chat` for all creative tasks. Makaron Agent decides how to execute — it can edit images, generate videos, compose music, and create designs in a single conversation.

### Submit a request

```bash
# With existing project
npx makaron-cli chat --project <id> --json -b "<prompt>"

# Auto-create project (with or without images)
npx makaron-cli chat --project auto --image photo.jpg --json -b "make it cinematic"
npx makaron-cli chat --project auto --image img1.jpg --image img2.jpg --json -b "combine these"
```

`chat` routes image and video models automatically. Use `--agent-model` only when the user explicitly asks to select or compare the reasoning/tool-calling Agent LLM. Accepted values are `auto`, the base model IDs (`gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.6-luna`, `grok-4.5`, `deepseek-v4-pro`), and the personal-plan routes (`gpt-5.6-terra-codex-subscription`, `gpt-5.6-sol-codex-subscription`, `gpt-5.6-luna-codex-subscription`). For the configured owner, `auto` uses GPT-5.6 Terra through the personal Codex plan; base GPT-5.6 IDs select Azure API, while suffixed IDs explicitly select the personal plan. Never put an image or video model ID in `--agent-model`.

```bash
npx makaron-cli chat --project auto --agent-model deepseek-v4-pro --json -b "make a 20s badminton video"
npx makaron-cli chat --project auto --agent-model gpt-5.6-sol-codex-subscription --json -b "reply with the active model"
```

Returns immediately:
```json
{"runId": "xxx", "projectId": "...", "projectUrl": "https://www.makaron.app/projects/...", "status": "running"}
```

### With additional images (existing project)

```bash
npx makaron-cli chat --project <id> --image ref1.jpg --image ref2.jpg -b "use these as style reference"
```

### Inspect existing timeline media

Before starting a follow-up run on an existing project, list the current timeline media so you know what assets are available and which `<<<media_N>>>` references to use:

```bash
npx makaron-cli project media <projectId> --json
```

This is project-scoped. `responses get <runId> --pick output` only returns artifacts from one run; `project media` returns the whole project timeline: original uploads, references, generated images, video snapshots, and editable compositions.

Publish typed external images and video intervals directly into that Media List without uploading the original media:

```bash
npx makaron-cli project media add <projectId> --type image --source-url "https://cdn.example.com/product.jpg" --description "Hero product image"
npx makaron-cli project media add <projectId> --type video --source-url "https://cdn.example.com/source.mp4" --start 12.5 --end 19 --description "Racket frame molding"
npx makaron-cli project media add <projectId> --input media.json --json
```

The JSON input may be an array or `{ "clips": [...] }`. Every item declares `type` as `image` or `video`. Images have `source_url + type + description` and no time range. Videos have `source_url + type + start + end + description`; `start` and `end` are seconds. Array order is edit order and `source_url` is opaque. Do not add or request provider-specific identity fields. Put existing media understanding (summary, editorial purpose, scene evidence, confidence, and limitations) in `description`. Makaron reads that provider-neutral Media List field before deciding whether any additional image/video analysis is needed.

For one-call orchestration, use `chat --project auto --media-manifest plan.json`. Makaron validates the manifest, creates the project, imports its media, and starts the Agent. If an upstream service returns multiple plans, the caller should start one independent Makaron task per plan instead of passing the provider-specific batch response into Makaron.

```bash
npx makaron-cli chat --project auto --media-manifest set-01.json --json -b "Make a 30-second 9:16 TikTok with English VO and captions"
```

### Export editable Remotion compositions

Animated Remotion compositions are saved as editable timeline/code artifacts first. To materialize one into an MP4 that CLI, V, or another service can read, call the backend export worker:

```bash
npx makaron-cli materialize --project <projectId> --media <N> --pick url
npx makaron-cli materialize --project <projectId> --design-json composition.json --pick url
npx makaron-cli composition export --project <projectId> --media <N> --wait
npx makaron-cli composition export --project <projectId> --snapshot <snapshotId> --wait
npx makaron-cli composition status <jobId> --wait
```

`materialize` is the preferred high-level command for Remotion-to-MP4. It defaults to `--wait`, `--publish`, and the `fast_720p` profile (short side 720, no upscale), so the completed MP4 is also added back to the project timeline like CUI. Use `--no-publish` only when you need a file URL without a new timeline video. Use `--profile source` only when full source resolution is required.

For a run that produced an animated composition, materialize before picking the video URL:

```bash
npx makaron-cli responses get <runId> --materialize --wait --pick first_video_url
npx makaron-cli responses get <runId> --export-compositions --wait --pick first_video_url
```

To turn a Makaron Remotion design JSON file directly into an MP4, use `--design-json`. The JSON must be a Makaron/Remotion composition payload, not a provider-video task response. Always pass the destination project because published exports and storage paths are project-scoped:

```bash
npx makaron-cli materialize --project <projectId> --design-json composition.json --pick url
cat composition.json | npx makaron-cli materialize --project <projectId> --design-json - --pick url
```

This JSON-to-MP4 path uses the same defaults as timeline materialize: `--wait`, `--publish`, and `fast_720p`. Add `--no-publish` only when another agent needs the MP4 URL but should not add a timeline video.

The completed export reports `duration_seconds`, `render_seconds`, and `realtime_ratio` so agents can compare video length against export time. Do not apply provider-video ETA rules to Remotion materialize; with a warm exporter it is often near video length to tens of seconds, while cold starts can be longer.

In production, run the exporter as a separate warm worker:

```bash
REMOTION_EXPORT_INLINE_AFTER=false npm run worker:remotion-export:check
REMOTION_EXPORT_INLINE_AFTER=false npm run worker:remotion-export
```

Keeping this worker warm avoids paying sandbox cold-start cost on every CLI or service call.

### With video input (edit, compose, extend)

```bash
# Upload a video and transform it — Agent understands video content natively
npx makaron-cli chat --project auto --video selfie.mp4 -b "put Iron Man armor on me"

# Combine a person's photo with a video scene
npx makaron-cli chat --project <id> --video party.mp4 --image kid.jpg -b "make this kid join the party"

# Multiple videos — compose or splice
npx makaron-cli chat --project <id> --video clip1.mp4 --video clip2.mp4 -b "combine into one seamless video"

# Video URL (public, downloadable)
npx makaron-cli chat --project auto --video https://example.com/dance.mp4 -b "extend this to 15 seconds"
```

Supported formats: MP4, MOV, WebM. CLI local video uploads support max 50MB, max 900s (15 minutes) with 1s metadata tolerance, and <=1080p / 2,086,876 frame pixels. The frontend can transcode larger videos before upload; the CLI uploads directly to Storage and rejects videos above those limits. Videos are uploaded to the project timeline. The Agent can analyze scenes, edit content, compose multiple clips, extend duration, and add effects — all via natural language. Seedance reference-video limits remain provider-specific, so longer uploaded videos should be split/prepared by the agent before model submission; Kling remains the base/direct edit path.

Use `chat --project <id|auto> --video ...` for any project/timeline video work. Direct video commands are standalone raw-tool calls.

### Check status (single query)

```bash
npx makaron-cli responses get <runId> --json
```

### Advanced: stream incremental events

```bash
npx makaron-cli responses watch <runId> --jsonl
```

Outputs one JSON per line as artifacts appear:
```
{"event":"output.added","item":{"id":"out_1","type":"image","status":"completed","url":"https://..."}}
{"event":"output.added","item":{"id":"out_2","type":"video","status":"rendering","task_id":"xxx"}}
{"event":"output.updated","item":{"id":"out_2","type":"video","status":"completed","url":"https://..."}}
{"event":"done","status":"completed"}
```

### Extract specific results

```bash
npx makaron-cli responses get <runId> --pick first_image_url
npx makaron-cli responses get <runId> --pick image_urls        # all images (JSON array)
npx makaron-cli responses get <runId> --pick first_video_url
npx makaron-cli responses get <runId> --pick video_urls        # all videos
npx makaron-cli responses get <runId> --pick project_url
npx makaron-cli responses get <runId> --pick text              # agent's text reply
npx makaron-cli responses get <runId> --pick output            # full output array
npx makaron-cli responses get <runId> --pick status
```

## Fallback: Direct tool calls (no project context)

Use these only when `chat` is unavailable or you need raw model access without project/conversation context.

### `edit` — One-shot image editing

```bash
# Edit an existing image
npx makaron-cli edit --image photo.jpg "add cinematic warm lighting"

# Text-to-image (no input)
npx makaron-cli edit "a cyberpunk cityscape at night"

# With model/skill/reference
npx makaron-cli edit --image photo.jpg --image-model openai --skill captions "add title"
npx makaron-cli edit --image photo.jpg --ref style.jpg "match this style"

# Output to file
npx makaron-cli edit --image photo.jpg --out result.jpg "make it dramatic"

# Strict transparent output through GPT Image 2
npx makaron-cli edit --image-model openai --background transparent --out sticker.png "a magenta star sticker"
```

Options: `--image`, `--image-model gemini|gemini-lite|qwen|openai|pony|wai`, `--skill enhance|creative|wild|captions`, `--ref <file>` (up to 3), `--aspect <ratio>`, `--background auto|opaque|transparent`, `--out <path>`. Transparent output routes strictly to GPT Image 2 and fails instead of returning an opaque fallback.

### `video` — Standalone video tools (no project timeline)

```bash
# 1. Write script from images
npx makaron-cli video script --image img1.jpg "cinematic story"

# 2. Analyze a video (standalone, no timeline write)
npx makaron-cli analyze --video input.mp4 "describe the key actions and pacing"

# 3a. Submit image-to-video rendering (images must be public URLs from step 1 or uploaded)
npx makaron-cli video create --script "Shot 1 (5s): <<<image_1>>> ..." --image https://...jpg --duration 5 --video-model kling

# 3b. Native SeeDance or MiniMax H3 text-to-video (no image required)
npx makaron-cli video create --script "Shot 1 (5s): A neon one-person studio wakes at dawn" --duration 5 --video-model seedance-fast --aspect 16:9
npx makaron-cli video create --script "Shot 1 (15s): A premium creative editor comes alive" --duration 15 --video-model minimax-h3 --aspect 16:9

# 3c. Edit a video from a local file or public URL
npx makaron-cli video create --script "make it funny" --video input.mp4 --duration 5 --video-model seedance
npx makaron-cli video create --script "make it warmer and cinematic" --video https://example.com/input.mp4 --duration 5 --video-model seedance

# 4. Check status
npx makaron-cli video status <taskId>
```

`video create` returns a provider task id and does not create or update a Makaron project timeline. For project/timeline video editing, use:

```bash
npx makaron-cli chat --project <id|auto> --video input.mp4 -b "make it funny"
```

`chat` intentionally has no video model or resolution flags. State both in the chat message so the Agent selects a compatible provider and resolution together. Use `video create` only when you explicitly need direct provider controls.

Options for `video create`: `--script "..."`, `--script-file <path>`, `--image <url>` (repeatable), `--video <file|url>` and `--audio <file|url>` (repeatable where supported), `--voice <xai-preset-id>` (repeatable, Grok only), `--duration <seconds>`, `--aspect 9:16|16:9|1:1`, `--video-model seedance-fast|seedance-mini|seedance|seedance-2.5|kling|grok|google-omni|minimax-h3|sync-lipsync-v3`, `--video-resolution auto|480p|720p|768p|1080p|2k|4k`. SeeDance accepts native text-to-video with no image and integer output duration 4-15s (default 5s); MiniMax H3 accepts native text-to-video, 4-15s output, public 768p/2k resolution, and up to 9 image, up to 3 video, and up to 3 audio references through Makaron Agent/chat. Grok generation supports text, up to 7 image references, 1-15s, native audio, and 480p/720p/1080p (multi-reference capped at 720p); Grok edit/extend uses the base model internally. `sync-lipsync-v3` requires exactly one video plus one MP3/WAV. Kling supports 5-15s.

For Seedance 2.5, use `--video-model seedance-2.5`; it supports 4-30s, 480p/720p, up to 30 image + 10 video + 10 audio references, and repeatable local-file/URL flags. Typed modes use `--video-operation generate|edit|extend`, with `--extend-direction`, `--output-format mp4|mov`, and optional `--web-search`. Evolink does not expose 4K for this route.

Video edit model behavior: `--video-model kling --video` uses Kling base/direct edit internally; `--video-model seedance-fast --video`, `--video-model seedance-mini --video`, or `--video-model seedance --video` uses the Seedance video-reference path and requires target <=15s, <=50MB, width/height 300-6000px, aspect ratio 0.4-2.5, and frame pixels 409,600-2,086,876. Tiny metadata padding up to 15.5s is accepted and output duration is clamped to 15s. `--video-model minimax-h3 --video` uses H3 feature/reference mode: up to 3 video references totaling <=15s. `--video-model grok --video --operation edit` accepts one MP4 up to 8.7s; `--operation extend` accepts one 2-15s MP4 and adds 2-10s. Grok edit/extend output is capped at 720p.

### `music` — Music generation

```bash
npx makaron-cli music create "gentle piano, warm strings, cinematic"
npx makaron-cli music create --vocals --style "lo-fi" "rainy day vibes"
npx makaron-cli music status <taskId>
```

Options: `--vocals` (include vocals), `--style "genre"`

## Response Schema

```typescript
type MakaronRunResponse = {
  id: string
  status: "in_progress" | "completed" | "failed" | "aborted"
  incomplete: boolean                // true = keep polling
  project_id: string
  project_url: string
  next_poll_after_ms?: number        // suggested poll interval
  output: MakaronOutput[]
}

type MakaronOutput =
  | { id: string; type: "text"; status: "completed"; content: string }
  | { id: string; type: "image"; status: "completed"; url: string; snapshot_id: string }
  | { id: string; type: "design"; status: "completed"; url: string; width: number; height: number; animated: boolean; duration?: number }
  | { id: string; type: "video"; status: "queued"|"rendering"|"completed"|"failed"; task_id: string; snapshot_id?: string; url?: string; elapsed_seconds?: number; width?: number; height?: number }
  | { id: string; type: "music"; status: "queued"|"rendering"|"completed"|"failed"; task_id: string; url?: string; elapsed_seconds?: number }
```

## Polling Rules

1. Poll while `incomplete: true` or `status` is `"in_progress"`
2. Use `next_poll_after_ms` as interval (default 5000ms)
3. Stop when `status` is `"completed"`, `"failed"`, or `"aborted"`
4. Top-level `status: "completed"` means ALL artifacts are ready (including rendered videos)
5. `responses get --wait` reconciles pending video output against completed Project Media with the same `snapshot_id` or `task_id`. A lagging Run row therefore does not block delivery after the durable project video is ready.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (completed) or valid in-progress response |
| 1 | Failed, aborted, or HTTP error |
| 2 | Timeout (partial response still printed to stdout) |

## What Makaron Agent Can Do

| Task | Example prompt |
|------|---------------|
| Edit photo | "make it cinematic with warm tones" |
| Style transfer | "convert to oil painting style" |
| Add/remove elements | "add a cat on the table" / "remove background person" |
| Text-to-image | "generate a cyberpunk cityscape" |
| Video from image | "create a 5 second video of her walking" |
| Video with model | "use seedance model, make a 5s video" |
| Background music | "add calm piano music" |
| Motion design | "create an Instagram story with animated text" |
| Multi-step | "edit the photo then make a video from it" |

## Recommended Pattern: Service Flow (Feishu/OpenClaw/Group Chat)

When serving end-users in a chat environment (Feishu, Slack, Discord), use this proactive message pattern:

```bash
# 1. Immediately acknowledge the user
send_message "Got it! Working on it now..."

# 2. Create project + submit (one command)
RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic and create a 5s video")

# 3. Send project link proactively
PROJECT_URL=$(npx makaron-cli responses get $RUN_ID --pick project_url)
send_message "Project created: $PROJECT_URL"

# 4. Wait for the final customer-ready result
RESULT=$(npx makaron-cli responses get $RUN_ID --wait --json)
IMAGE_URLS=$(echo "$RESULT" | jq -r '[.result.images[]?.imageUrl, .output[]? | select(.type == "image") | .url] | map(select(. != null)) | unique | .[]')
VIDEO_URLS=$(echo "$RESULT" | jq -r '[.result.videos[]?.videoUrl, .output[]? | select(.type == "video") | .url] | map(select(. != null)) | unique | .[]')

for URL in $IMAGE_URLS; do
  send_image "$URL"
done
for URL in $VIDEO_URLS; do
  send_video "$URL"
done
send_message "All done!"
```

**Key principles for service agents:**
- **Proactive, not silent**: Acknowledge immediately, send the project link early, then send the final customer-ready media when the run completes.
- **Media over links**: When possible, send images/videos as native media in the chat (download URL and upload as attachment), not just paste the URL.
- **Immediate acknowledgment**: Reply within 1 second of receiving user request. Don't make users wait for project creation.
- **Project link early**: Send the project URL right after creation so users can check anytime.
- **Use `get --wait --json` as the default service path**: reserve `watch --jsonl` for advanced streaming or debugging integrations that explicitly need incremental events.

## Important Notes

- One project = one conversation thread. All history is preserved.
- One active Agent Run at a time per project. A new message received while it is active is appended to that same Agent Run and processed at a durable work-unit boundary; it does not interrupt the execution or create a second owner for an in-progress Studio workflow.
- Multi-image: `create --image a.jpg --image b.jpg` or `chat --image ref.jpg`.
- Provider-generated videos can take 2-5 minutes; Grok is usually shorter. Remotion compositions should be converted with `materialize` / `responses get --materialize`, and timing should be read from `duration_seconds`, `render_seconds`, and `realtime_ratio`.
- Music takes ~60 seconds. Appears in output when done.
- Images are typically ready in 15-30 seconds.
- stdout is always machine-readable JSON/text. Human-friendly logs go to stderr.
- Always use `chat` as the primary interface — even for single image edits.
- `edit`/`video`/`music` are fallback tools for when `chat` is unavailable or you need raw model access without project context.
