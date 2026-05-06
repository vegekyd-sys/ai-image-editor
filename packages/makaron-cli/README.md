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

### `list` — Show all projects

```bash
npx makaron-cli list
```

Output:
```
📁 12 projects

  abc123def  My Photo                        3 snaps  2h ago
  xyz789ghi  Sunset Edit                     5 snaps  1d ago
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

Output:
```
✅ Project created
   ID: abc123def456
   Images: 1
   [1] https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/...
   URL: https://www.makaron.app/projects/abc123def456
```

### `chat` — Send a message to Makaron Agent

This is the main command. The Agent can edit images, generate videos, compose music, and create designs.

```bash
npx makaron-cli chat --project <id> "make it look cinematic"
```

The Agent streams its response in real-time:
- **Text** → stdout (pipe-friendly)
- **Status/progress** → stderr
- **Images, videos, music** → URLs printed to stderr

```bash
# Add extra reference images to the project before chatting
npx makaron-cli chat --project <id> --image ref.jpg "use this style"
```

After the Agent finishes, the CLI automatically polls for any pending video/music tasks until they complete.

### `abort` — Stop a running Agent

```bash
npx makaron-cli abort <runId>
```

Press `Ctrl+C` during `chat` to abort automatically.

## Example: Full workflow

```bash
# 1. Login (once)
npx makaron-cli login

# 2. Create a project from a photo
npx makaron-cli create --image my-photo.jpg
# → ID: proj_abc123

# 3. Edit the image
npx makaron-cli chat --project proj_abc123 "add dramatic lighting and film grain"

# 4. Generate a video from the result
npx makaron-cli chat --project proj_abc123 "make a 5 second cinematic video"

# 5. Add background music
npx makaron-cli chat --project proj_abc123 "add epic orchestral background music"
```

## Agent Integration Guide

For AI agents (Claude Code, Cursor, etc.) calling this CLI programmatically:

### Setup (one-time)

```bash
export MAKARON_API_KEY=mk_live_your_key_here
npx makaron-cli list   # verify it works
```

### Best practices

1. **Always capture the project ID** from `create` output — you need it for all `chat` commands
2. **One instruction per `chat` call** — the Agent handles complex requests, but single clear instructions work best
3. **Check results via the URL** — every project has a web URL at `https://www.makaron.app/projects/<id>`
4. **Video generation takes 2-5 minutes** — the CLI auto-polls and prints the URL when done
5. **Music generation takes ~60 seconds** — also auto-polled

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

### Output parsing

- **stdout** = Agent's text response (markdown)
- **stderr** = progress, tool calls, result URLs
- Key patterns in stderr:
  - `🖼️  Image: <url>` — generated/edited image URL
  - `🎬 Video done (<seconds>s): <url>` — completed video URL
  - `🎵 Music done (<seconds>s): <url>` — completed music URL
  - `🎨 Design published: <description>` — motion graphic/design created
  - `🔗  <url>` — project web URL (always last)

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

Open this URL in a browser to see the timeline of all edits, play videos, and download assets.

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
npx makaron-cli admin upload skill.zip marketplace/skills/skill-name.zip
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
