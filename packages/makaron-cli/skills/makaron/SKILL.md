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

Returns immediately:
```json
{"runId": "xxx", "projectId": "...", "projectUrl": "https://www.makaron.app/projects/...", "status": "running"}
```

### With additional images (existing project)

```bash
npx makaron-cli chat --project <id> --image ref1.jpg --image ref2.jpg -b "use these as style reference"
```

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

Supported formats: MP4, MOV, WebM. CLI local video uploads follow the same compatibility contract as the normal frontend flow: max 200MB, target max 15s with 0.5s metadata tolerance, and <=1080p / 2,086,876 frame pixels. The frontend can transcode oversized videos; the CLI rejects them so later Seedance editing does not fail. Videos are uploaded to the project timeline. The Agent can analyze scenes, edit content, compose multiple clips, extend duration, and add effects — all via natural language. Seedance video-reference editing is supported for ~15s videos that meet these upload limits; Kling remains the base/direct edit path.

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
npx makaron-cli edit --image photo.jpg --model openai --skill captions "add title"
npx makaron-cli edit --image photo.jpg --ref style.jpg "match this style"

# Output to file
npx makaron-cli edit --image photo.jpg --out result.jpg "make it dramatic"
```

Options: `--image`, `--model gemini|qwen|openai|pony|wai`, `--skill enhance|creative|wild|captions`, `--ref <file>` (up to 3), `--aspect <ratio>`, `--out <path>`

### `video` — Standalone video tools (no project timeline)

```bash
# 1. Write script from images
npx makaron-cli video script --image img1.jpg "cinematic story"

# 2. Analyze a video (standalone, no timeline write)
npx makaron-cli analyze --video input.mp4 "describe the key actions and pacing"

# 3a. Submit image-to-video rendering (images must be public URLs from step 1 or uploaded)
npx makaron-cli video create --script "Shot 1 (5s): <<<image_1>>> ..." --image https://...jpg --duration 5 --model kling

# 3b. Edit a video from a local file or public URL
npx makaron-cli video create --script "make it funny" --video input.mp4 --duration 5 --model seedance
npx makaron-cli video create --script "make it warmer and cinematic" --video https://example.com/input.mp4 --duration 5 --model seedance

# 4. Check status
npx makaron-cli video status <taskId>
```

`video create` returns a provider task id and does not create or update a Makaron project timeline. For project/timeline video editing, use:

```bash
npx makaron-cli chat --project <id|auto> --video input.mp4 -b "make it funny"
```

Options for `video create`: `--script "..."`, `--script-file <path>`, `--image <url>` (repeatable, up to 7), `--video <file|url>`, `--duration 3|5|7|10|15`, `--aspect 9:16|16:9|1:1`, `--model kling|seedance`

Video edit model behavior: `--model kling --video` uses Kling base/direct edit internally; `--model seedance --video` uses the Seedance video-reference path and requires target <=15s, <=1080p input. Tiny metadata padding up to 15.5s is accepted and output duration is clamped to 15s.

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
- One run at a time per project. New message interrupts previous run.
- Multi-image: `create --image a.jpg --image b.jpg` or `chat --image ref.jpg`.
- Videos take 2-5 minutes to render. Use `responses get <runId> --wait --json` for the default customer-service path.
- Music takes ~60 seconds. Appears in output when done.
- Images are typically ready in 15-30 seconds.
- stdout is always machine-readable JSON/text. Human-friendly logs go to stderr.
- Always use `chat` as the primary interface — even for single image edits.
- `edit`/`video`/`music` are fallback tools for when `chat` is unavailable or you need raw model access without project context.
