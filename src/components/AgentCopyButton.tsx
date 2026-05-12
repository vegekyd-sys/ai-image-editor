'use client'

import { useState } from 'react'

const AGENT_DOC = `# Makaron CLI — For AI Agents

makaron.app is for humans. makaron-cli is for AI agents.

Makaron is a multimodal AI creative agent. You talk to it via \`makaron chat\`, and it produces images, videos, music, and animated designs — all saved to a persistent project.

## Install & Auth

npm install -g makaron-cli
# or use directly: npx makaron-cli

export MAKARON_API_KEY=mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx makaron-cli list   # verify it works

## Core Workflow

# One-shot: create project + upload image + submit prompt
RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic and create a 5s video")

# Watch until all artifacts are ready
npx makaron-cli responses watch $RUN_ID --jsonl

## chat — Primary Command

Use \`chat\` for all creative tasks. The Agent decides how to execute.

# Submit (returns immediately with runId)
npx makaron-cli chat --project <id> --json -b "<prompt>"

# Auto-create project with images
npx makaron-cli chat --project auto --image photo.jpg --json -b "make it cinematic"
npx makaron-cli chat --project auto --image img1.jpg --image img2.jpg --json -b "combine these"

# Add reference images to existing project
npx makaron-cli chat --project <id> --image ref.jpg -b "use this style"

## responses — Track Results

# Check status
npx makaron-cli responses get <runId> --json

# Watch until done (streaming)
npx makaron-cli responses watch <runId> --jsonl

# Extract specific results
npx makaron-cli responses get <runId> --pick first_image_url
npx makaron-cli responses get <runId> --pick first_video_url
npx makaron-cli responses get <runId> --pick text
npx makaron-cli responses get <runId> --pick status

## Capabilities

| Task | Example prompt |
|------|---------------|
| Edit photo | "make it cinematic with warm tones" |
| Style transfer | "convert to oil painting style" |
| Add/remove elements | "add a cat on the table" / "remove background" |
| Text-to-image | "generate a cyberpunk cityscape" |
| Video from image | "create a 5 second video of her walking" |
| Video with model | "use seedance model, make a 5s video" |
| Background music | "add calm piano music" |
| Motion design | "create an Instagram story with animated text" |
| Multi-step | "edit the photo then make a video from it" |

## Fallback: Direct Tool Calls

# edit — One-shot image editing
npx makaron-cli edit --image photo.jpg "add cinematic warm lighting"
npx makaron-cli edit "a cyberpunk cityscape at night"   # text-to-image

# video — Video generation
npx makaron-cli video script --image img1.jpg "cinematic story"
npx makaron-cli video create --script "..." --image https://...jpg --duration 5
npx makaron-cli video status <taskId>

# music — Music generation
npx makaron-cli music create "gentle piano, warm strings, cinematic"
npx makaron-cli music status <taskId>

## Important Notes

- One project = one conversation thread. All history preserved.
- Videos take 2-5 minutes. Use \`watch\` to get URL when ready.
- Music takes ~60 seconds. Images typically 15-30 seconds.
- Always use \`chat\` as primary interface — even for single edits.
- stdout = machine-readable JSON/text. Human-friendly logs → stderr.

## Self-Registration (No Human Required)

AI agents can register themselves to get an API key and 500 welcome credits.

Step 1: Get Challenge
POST https://www.makaron.app/api/agent/register
→ { "challenge_id": "uuid", "challenge": "obfuscated math problem" }

Step 2: Solve & Verify
POST https://www.makaron.app/api/agent/register/verify
Body: { "challenge_id": "...", "answer": "34.5" }
→ { "api_key": "mk_live_...", "credits": 500, "quick_start": {...} }

Step 3: Start using the CLI
export MAKARON_API_KEY=mk_live_...
RUN_ID=$(npx makaron-cli chat --project auto --image photo.jpg -b "make it cinematic")
npx makaron-cli responses watch $RUN_ID --jsonl

## Let a Human Claim This Account

POST https://www.makaron.app/api/agent/claim
Header: Authorization: Bearer mk_live_your_key
→ { "claim_url": "https://www.makaron.app/claim?token=clm_..." }

Share claim_url with a human. They log in and link the API key to their account.

## Billing

- 500 welcome credits on registration
- Credits consumed per operation (varies by tool)
- Top up: https://www.makaron.app/dashboard

## Discovery API

GET https://www.makaron.app/api/agent/register
→ JSON with full registration flow, CLI commands, and capabilities
`

export default function CopyButton() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(AGENT_DOC)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = AGENT_DOC
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy page for agent"
      className="p-1.5 rounded-md text-gray-500 hover:text-white transition-colors"
    >
      {copied ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
