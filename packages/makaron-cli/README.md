# Makaron CLI — Agent Integration Skill

> **makaron.app** is for humans. **makaron-cli** is for AI agents.

Makaron is a multimodal AI creative agent. You talk to it via `makaron chat`, and it produces images, videos, music, and animated designs — all saved to a persistent project.

## Setup

```bash
npm install -g makaron-cli
# or use directly: npx makaron-cli
```

### Get your API key

**Option A: Human login**
1. Go to [makaron.app](https://makaron.app) and log in
2. Open the menu (top-right)
3. Click **Get API Key**
4. Copy your `mk_live_...` key

**Option B: Agent Self-Registration (no human required)**
```bash
# Step 1: Get challenge
npx makaron-cli register --json
# → { "challenge_id": "...", "challenge": "...", "expected_format": "numeric, round to 2 decimal places" }

# Step 2: Solve the math problem and verify
npx makaron-cli register --verify --challenge-id <id> --answer 34.5
# → Key saved to ~/.makaron/auth.json
# → { "api_key": "mk_live_...", "credits": N, "claim_url": "..." }
```

After registration, the key is saved locally — no need to export `MAKARON_API_KEY`.

Discovery endpoint (returns full registration flow + CLI usage as JSON):
```bash
curl https://www.makaron.app/api/agent/register
```

Docs: [makaron.app/agent](https://www.makaron.app/agent)

```bash
export MAKARON_API_KEY=mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Verify: `npx makaron-cli list` should show projects.

### Let a human claim your account

After registering, generate a link for a human to link your API key to their account:
```bash
npx makaron-cli claim
# → { "claim_url": "https://www.makaron.app/claim?token=clm_..." }
```
Share the `claim_url` with a human. They log in and the API key gets linked to their account. Claim links are valid for 7 days. Run `claim` again anytime to get a new link.

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

```bash
npx makaron-cli chat --help
```

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

### Common workflows

| What you want | Example |
|--------------|---------|
| Edit an image | `npx makaron-cli chat --project <id> --image photo.jpg "remove the person in the background"` |
| Generate an image | `npx makaron-cli chat --project auto "generate a cinematic poster of a rainy Tokyo alley"` |
| Make a video from the current project | `npx makaron-cli chat --project <id> "make this into a 5 second cinematic video"` |
| Fix one moment in a video from a screenshot | `npx makaron-cli chat --project <id> --image screenshot.png "@4 this frame should be Paris; only fix this moment"` |
| Cut or assemble video | `npx makaron-cli chat --project <id> --video clip.mp4 "cut out the dead air and keep the best 20 seconds"` |
| Add music | `npx makaron-cli chat --project <id> "add calm piano background music"` |
| Create motion design | `npx makaron-cli chat --project <id> "make an animated Instagram story with this image"` |

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

### With video input (MP4/MOV/WebM)

```bash
# Upload a video and ask the agent to edit it
npx makaron-cli chat --project auto --video clip.mp4 -b "put Iron Man armor on me in this video"

# Combine video + image references
npx makaron-cli chat --project <id> --video party.mp4 --image kid.jpg -b "make this kid appear in the party"

# Multiple videos (for composition / continuation)
npx makaron-cli chat --project <id> --video clip1.mp4 --video clip2.mp4 -b "splice these into one seamless video"
```

Video files are uploaded via signed URL. CLI local video uploads support `.mp4`, `.mov`, or `.webm`, max 50MB, max 120s with 1s metadata tolerance, and <=1080p / 2,086,876 frame pixels. The frontend can transcode larger videos before upload; the CLI uploads directly to Storage and rejects videos above those limits.
The agent understands video content natively — it can analyze scenes, edit, extend, and compose videos. Seedance video-reference editing is still limited to ~15s provider references, so longer uploaded videos should be split/prepared by the agent before model submission; Kling remains the base/direct edit path.
Use `chat --project <id|auto> --video ...` for any project/timeline video work. Direct `video create` is standalone and does not write timeline entries.

### Fix one video moment from a screenshot

When a video is mostly good but one moment needs a local fix, attach a screenshot of the problem frame and describe the correction in normal language:

```bash
npx makaron-cli chat --project <id> \
  --image screenshot.png \
  "@4 this frame should be Paris, keep the same style and only fix this moment"
```

Makaron can locate the screenshot in the video, regenerate only the nearby segment, and then print a `Next steps` command when the new clip should be stitched back into the full MP4.

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

# With model/reference
npx makaron-cli edit --image photo.jpg --ref style.jpg "match this style"

# Output to file
npx makaron-cli edit --image photo.jpg --out result.jpg "make it dramatic"
```

Options: `--image`, `--model gemini|qwen|openai|pony|wai`, `--ref <file>` (up to 3), `--aspect <ratio>`, `--out <path>`

### `video` — Standalone video tools (no project timeline)

```bash
# 1. Write script from images
npx makaron-cli video script --image img1.jpg "cinematic story"

# 2. Analyze a video (standalone, no timeline write)
npx makaron-cli analyze --video input.mp4 "describe the key actions and pacing"

# 3a. Submit image-to-video rendering (images must be public URLs from step 1 or uploaded)
npx makaron-cli video create --script "Shot 1 (5s): <<<image_1>>> ..." --image https://...jpg --duration 5 --model kling
npx makaron-cli video create --script "Shot 1 (5s): <<<image_1>>> slow cinematic push-in with native ambience" --image https://...jpg --duration 5 --model grok

# 3b. Edit a video from a local file or public URL
npx makaron-cli video create --script "make it funny" --video input.mp4 --duration 5 --model seedance-fast
npx makaron-cli video create --script "make it warmer and cinematic" --video https://example.com/input.mp4 --duration 5 --model seedance --video-resolution 1080p

# 4. Check status
npx makaron-cli video status <taskId>
```

For project/timeline video editing, use:

```bash
npx makaron-cli chat --project <id|auto> --video input.mp4 -b "make it funny"
```

Options for `video create`: `--script "..."`, `--script-file <path>`, `--image <url>` (repeatable, up to 7), `--video <file|url>`, `--duration <seconds>`, `--aspect 9:16|16:9|1:1`, `--model seedance-fast|seedance|kling|grok`, `--video-resolution auto|480p|720p|1080p|4k`. Default model is `seedance-fast`. SeeDance accepts integer output duration 4-15s (default 5s); Kling supports 5-15s; Grok 1.5 supports 1-15s single-image-to-video only. For `--model grok`, forced `--aspect` is ignored to avoid xAI stretching the source image; pad/create the image at the target shape first or use another model.

Video edit model behavior: `--model kling --video` uses Kling base/direct edit internally; `--model seedance-fast --video` or `--model seedance --video` uses the SeeDance video-reference path and requires target <=15s, <=50MB, width/height 300-6000px, aspect ratio 0.4-2.5, and frame pixels 409,600-2,086,876. Tiny metadata padding up to 15.5s is accepted and output duration is clamped to 15s. Grok does not support video references.

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
  | { id: string; type: "video"; status: "queued"|"rendering"|"completed"|"failed"; task_id: string; snapshot_id?: string; url?: string; elapsed_seconds?: number; width?: number; height?: number; error?: string; completion_actions?: CompletionAction[] }
  | { id: string; type: "music"; status: "queued"|"rendering"|"completed"|"failed"; task_id: string; url?: string; elapsed_seconds?: number }

type CompletionAction = {
  label: string
  prompt: string
  description?: string
  policy?: "confirm" | "auto"
}
```

## Polling Rules

1. Poll while `incomplete: true` or `status` is `"in_progress"`
2. Use `next_poll_after_ms` as interval (default 5000ms)
3. Stop when `status` is `"completed"`, `"failed"`, or `"aborted"`
4. Top-level `status: "completed"` means ALL artifacts are ready (including rendered videos)
5. If an async video fails, top-level `status` is `"failed"` and the failed video may include `completion_actions` for a safe retry or diagnosis. Agents can surface these as the next user-confirmed step.

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
| Real MP4 edits | `--video clip.mp4 "trim this to the best 20 seconds and preserve audio"` |
| **Edit video** | **"put Iron Man armor on me in this video"** |
| **Compose videos** | **"combine @1 and @2 into one party video"** |
| **Extend video** | **"continue the story for 10 more seconds"** |
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
- Most videos take 3-5 minutes; Grok is usually around 30-40 seconds. Use `responses get <runId> --wait --json` for the default customer-service path.
- Music takes ~60 seconds. Appears in output when done.
- Images are typically ready in 15-30 seconds.
- stdout is always machine-readable JSON/text. Human-friendly logs go to stderr.
- Always use `chat` as the primary interface — even for single image edits.
- `edit`/`video`/`music` are fallback tools for when `chat` is unavailable or you need raw model access without project context.
- The CLI checks npm for updates at most once per day and prints update notices to stderr. Set `MAKARON_DISABLE_UPDATE_CHECK=1` to disable it.

## Admin: Skill Marketplace Operations

Admin commands require an API key with admin privileges. Ask your admin to run `makaron admin set-admin <your-email>` to grant access.

### List all marketplace skills

```bash
npx makaron-cli admin skills
```

### Upload assets to Storage

```bash
# Upload cover image (3:4 aspect ratio recommended)
npx makaron-cli admin upload cover.jpg marketplace/covers/skill-name.jpg

# Upload before photo
npx makaron-cli admin upload before.jpg marketplace/before/before-name.jpg

# Upload skill zip
npx makaron-cli admin upload skill-name.zip marketplace/skills/skill-name.zip
```

Storage paths follow this convention:
- Covers: `marketplace/covers/<skill-name>.jpg` (or `.mp4` for video covers)
- Before images: `marketplace/before/<name>.jpg`
- Skill zips: `marketplace/skills/<skill-name>.zip`

### Add a new skill to marketplace

```bash
npx makaron-cli admin skills add '{
  "labels": {"zh": "中文名", "en": "English Name"},
  "image": "https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/marketplace/covers/skill-name.jpg",
  "prompt": "Default prompt shown to users",
  "skill_path": "https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/marketplace/skills/skill-name.zip",
  "image_count": 2,
  "sort_order": 10,
  "is_active": true,
  "before_images": ["https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/marketplace/before/before-name.jpg"]
}'
```

### Update / delete a skill

```bash
npx makaron-cli admin skills update <id> '{"sort_order": 5, "is_active": false}'
npx makaron-cli admin skills delete <id>
```

### Download skill from share link

```bash
# From share code
npx makaron-cli admin fetch-skill 4c4cbd57

# From full URL
npx makaron-cli admin fetch-skill https://www.makaron.app/s/4c4cbd57

# → Creates ./skill-name/ directory with SKILL.md + assets/
```

### End-to-end skill launch workflow

0. **Get skill from share link** — `npx makaron-cli admin fetch-skill <code>`
1. **Read SKILL.md** — understand the skill's variables, prompt template, and output format
2. **Generate before photo** — use Makaron MCP `makaron_edit_image` to generate a plain selfie (no phone in frame, natural light)
3. **Generate cover photo** — use `makaron_edit_image` following the SKILL.md variables/style closely. Match gender pairing (female idol → male fan, male idol → female fan)
4. **Package zip** — `zip skill-name.zip SKILL.md` (video reference URLs go in SKILL.md metadata, not in the zip)
5. **Upload all assets**:
   ```bash
   npx makaron-cli admin upload cover.jpg marketplace/covers/skill-name.jpg
   npx makaron-cli admin upload before.jpg marketplace/before/skill-name-before.jpg
   npx makaron-cli admin upload skill-name.zip marketplace/skills/skill-name.zip
   ```
6. **Add to marketplace**:
   ```bash
   npx makaron-cli admin skills add '{"labels":{"zh":"...","en":"..."},"image":"<cover_url>","skill_path":"<zip_url>","before_images":["<before_url>"],"image_count":2,"sort_order":10,"is_active":true}'
   ```
7. **Verify** — visit https://www.makaron.app/home and confirm the skill appears, can be clicked, and works

### Cover image guidelines

- Target aspect ratio: **3:4** (marketplace cards use `object-fit: cover`)
- 16:9 images will be severely cropped — resize or stack two 16:9 images vertically
- Video covers (`.mp4`) are supported — auto-play in the card
- Before photo should match the person in the cover (hair, clothing, accessories)
