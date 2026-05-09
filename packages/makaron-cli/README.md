# makaron-cli

Talk to **Makaron Agent** from the terminal — create projects, edit images, generate videos, and compose music.

Zero dependencies. Single file. Works with `npx`.

## Install

```bash
npx makaron-cli          # run directly (always latest)
# or
npm install -g makaron-cli
```

## Authentication

### API Key (recommended for agents)

Set the `MAKARON_API_KEY` environment variable. That's it — no login step needed.

```bash
export MAKARON_API_KEY=mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx makaron-cli list
```

Get your API key from the Makaron dashboard (Settings → API Keys), or ask your admin to generate one.

### Interactive login (humans)

```bash
npx makaron-cli login
# Enter email + password → token saved to ~/.makaron/auth.json
```

The CLI checks `MAKARON_API_KEY` first, then falls back to the saved session in `~/.makaron/auth.json`.

## Commands

### `chat` — Send a message to Makaron Agent

This is the main command. The Agent can edit images, generate videos, compose music, and create designs.

**Default mode (non-blocking poll):**

```bash
npx makaron-cli chat --project <id> "make it look cinematic"
```

The CLI submits the request and polls every 3s for results. No long-lived connection — you can Ctrl+C and come back later with `responses get`.

**Background mode — submit and exit immediately:**

```bash
npx makaron-cli chat --project <id> --background "make a 5s video"
# → prints runId and exits in <1s

# Later, check the result:
npx makaron-cli responses get <runId> --wait
```

**Structured JSON output (for programmatic use):**

```bash
npx makaron-cli chat --project <id> --json --background "edit the photo"
# → {"runId":"...","projectId":"...","projectUrl":"...","status":"running"}
```

**Legacy streaming mode (real-time SSE):**

```bash
npx makaron-cli chat --project <id> --stream "hello"
```

**Options:**
- `--project <id>` — target project (required)
- `--image <file>` — upload image to project before chatting
- `--background` / `-b` — submit and exit, print runId
- `--json` — structured JSON output
- `--stream` — legacy real-time SSE mode
- `--video-model kling|seedance` — preferred video model
- `--model <name>` — preferred image model

### `responses` — Query run status and results

```bash
# Get current status (single query)
npx makaron-cli responses get <runId>

# Poll until completed
npx makaron-cli responses get <runId> --wait

# Wait for video/music rendering too (not just Agent completion)
npx makaron-cli responses get <runId> --wait --wait-artifacts

# List runs for a project
npx makaron-cli responses list --project <id>
```

**Result JSON structure:**

```json
{
  "runId": "...",
  "projectId": "...",
  "status": "completed",
  "eventCount": 31,
  "result": {
    "text": "Agent's text response...",
    "images": [{ "snapshotId": "...", "imageUrl": "https://..." }],
    "designs": [{
      "snapshotId": "...",
      "imageUrl": "https://...",
      "width": 1080,
      "height": 1920,
      "animation": { "fps": 30, "durationInSeconds": 3 },
      "props": { "title": "..." },
      "code": "function Design(props) { ... }"
    }],
    "videos": [{ "taskId": "...", "status": "completed", "videoUrl": "https://..." }],
    "music": [{ "taskId": "...", "status": "completed", "audioUrl": "https://..." }]
  }
}
```

### `list` — Show all projects

```bash
npx makaron-cli list
```

### `create` — Create a new project

```bash
# From local image file(s)
npx makaron-cli create --image photo.jpg
npx makaron-cli create --image img1.jpg --image img2.jpg

# From URL(s)
npx makaron-cli create --image-url https://example.com/photo.jpg

# Empty project (for text-to-image)
npx makaron-cli create --title "My New Project"
```

### `abort` — Stop a running Agent

```bash
npx makaron-cli abort <runId>
```

### `edit` — AI image editing (direct MCP tool call)

Unlike `chat` (which uses the Agent with project context), `edit` directly calls the image generation model for one-shot results.

```bash
# Text-to-image (no input image)
npx makaron-cli edit "a cyberpunk cityscape at night, neon reflections"

# Edit an existing image
npx makaron-cli edit --image photo.jpg "add cinematic warm lighting"

# With model and skill
npx makaron-cli edit --image photo.jpg --model openai --skill captions "add elegant title"

# With reference images (up to 3)
npx makaron-cli edit --image photo.jpg --ref style1.jpg --ref style2.jpg "match this style"

# Specify output path and aspect ratio
npx makaron-cli edit --out result.jpg --aspect 9:16 "vertical poster design"
```

Options:
- `--image <file|url>` — input image (omit for text-to-image)
- `--model gemini|qwen|openai|pony|wai` — model selection (default: auto)
- `--skill enhance|creative|wild|captions` — activate skill template
- `--ref <file|url>` — reference image (repeatable, up to 3)
- `--aspect <ratio>` — target aspect ratio (e.g. `4:5`, `1:1`, `16:9`)
- `--out <path>` — output file path (default: `makaron-output-{timestamp}.jpg`)

### `video` — Video generation

```bash
# Write a video script from images
npx makaron-cli video script --image img1.jpg --image img2.jpg "cinematic story"

# Submit video rendering (images must be public URLs)
npx makaron-cli video create --script "Shot 1..." --image https://...img1.jpg --duration 10

# Check status
npx makaron-cli video status <taskId>
```

### `music` — Music generation

```bash
# Generate instrumental music
npx makaron-cli music create "gentle piano, warm strings, cinematic"

# With vocals and style
npx makaron-cli music create --vocals --style "lo-fi, ambient" "rainy day vibes"

# Check status
npx makaron-cli music status <taskId>
```

## Agent Integration Guide

For AI agents (Claude Code, OpenClaw, etc.) calling this CLI programmatically:

### Non-blocking workflow (recommended)

```bash
# 1. Submit task — returns immediately
RUN_ID=$(npx makaron-cli chat --project $PROJECT_ID --background "make a 5s video")

# 2. Do other work while Makaron processes...

# 3. Poll for result when ready
npx makaron-cli responses get $RUN_ID --wait
```

### JSON mode for structured parsing

```bash
# Submit
RESULT=$(npx makaron-cli chat --project $ID --json --background "edit the photo")
RUN_ID=$(echo $RESULT | jq -r .runId)

# Poll
npx makaron-cli responses get $RUN_ID --wait
```

### Sequential multi-turn

```bash
# Turn 1: edit image
npx makaron-cli chat --project $ID "make it cinematic"
# Wait for completion (default mode polls automatically)

# Turn 2: make video from the edited image
npx makaron-cli chat --project $ID "now make a 5s video from this"
```

Note: One project runs one Agent at a time. A new message while the previous is still running will interrupt the first.

### What the Agent can do

| Capability | Example prompt |
|-----------|---------------|
| Image editing | "make the sky more dramatic" |
| Style transfer | "convert to oil painting style" |
| Add elements | "add a cat sitting on the table" |
| Remove elements | "remove the person in the background" |
| Text-to-image | "generate a cyberpunk cityscape" (on empty project) |
| Video from image | "create a 5 second video" |
| Video with script | "make a video: camera slowly zooms in while leaves fall" |
| Background music | "add calm piano music" |
| Design/motion graphics | "create an Instagram story with animated text" |

### Output types in result

| Type | Field | Contains |
|------|-------|----------|
| Text | `result.text` | Agent's conversational response |
| Image | `result.images[].imageUrl` | Generated/edited image URL |
| Design (still) | `result.designs[].imageUrl` | Poster screenshot + code |
| Design (animated) | `result.designs[].animation` | fps + duration + code |
| Video | `result.videos[].videoUrl` | MP4 URL (after rendering) |
| Music | `result.music[].audioUrl` | MP3 URL (after generating) |

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `MAKARON_API_KEY` | API key (`mk_live_xxx`) | — |
| `MAKARON_URL` | API endpoint override | `https://www.makaron.app` |

## Viewing results

All generated content (images, videos, designs) is saved to the project and visible at:

```
https://www.makaron.app/projects/<project-id>
```

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
