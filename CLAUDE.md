# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered image editor built with Next.js 16. Users upload photos, receive AI-generated editing tips (via Google Gemini), and apply AI transformations through a chat interface. Images are streamed as base64 data URLs; tips and chat responses use SSE streaming.

## Commands

- `npm run dev` — Start dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm run lint` — ESLint (runs `eslint` with Next.js + TypeScript config)

No test framework is configured.

## Environment Variables

- `GOOGLE_API_KEY` (required) — Google Gemini API key
- `AI_PROVIDER` — `'google'` (default) or `'openrouter'`
- `OPENROUTER_API_KEY` — Required when `AI_PROVIDER=openrouter`

## Architecture

### Frontend (single-page client app)

`src/app/page.tsx` is the main client component managing all app state: messages, snapshots (image timeline), view index, loading states, and chat panel visibility. It uses refs for snapshots and viewIndex to avoid stale closures in callbacks.

Key components in `src/components/`:
- **ImageCanvas** — Full-viewport image display with swipe/keyboard navigation across the snapshot timeline
- **TipsBar** — Horizontal carousel of AI-generated tips grouped by category (enhance/creative/wild)
- **ChatBubble** — Bottom-right chat panel with markdown rendering
- **ImageUploader** — File input with client-side compression and drag-and-drop

### Backend (API routes)

- **POST /api/chat** (`src/app/api/chat/route.ts`) — SSE stream for chat with image editing. Events: `content`, `image`, `error`. Max duration 120s.
- **POST /api/tips** (`src/app/api/tips/route.ts`) — SSE stream of 6 Tip objects (2 enhance + 2 creative + 2 wild) followed by `[DONE]`. Max duration 60s.
- **POST /api/upload** (`src/app/api/upload/route.ts`) — HEIC→JPEG conversion (uses macOS `sips`) and Sharp-based compression (max 1024px, quality 85%).

### AI Layer

`src/lib/gemini.ts` is the core orchestration module (~530 lines):
- **Dual provider support**: Google Gemini SDK or OpenRouter HTTP proxy, selected by `AI_PROVIDER` env var
- **Session management**: In-memory `Map<sessionId, Session>` with 30-minute TTL auto-cleanup
- **`chatStreamWithModel`**: Async generator yielding `{type: 'content'|'image'|'done'}` chunks
- **`streamTips`**: Analyzes uploaded image against prompt templates, yields parsed Tip objects incrementally
- **Prompt templates**: Loaded from `src/lib/prompts/*.md` files (cached in production). System prompts are in Chinese and define face preservation rules, editing constraints, and tip evaluation rubrics.

### Data Model

Defined in `src/types/index.ts`:
- **Snapshot** `{id, image, tips, messageId}` — Immutable timeline entries; each AI edit creates a new snapshot
- **Message** `{id, role, content, image?, timestamp}`
- **Tip** `{emoji, label, desc, editPrompt, category, aspectRatio?}`

### Streaming Pattern

Both tips and chat use the same SSE pattern:
- Backend: async generators → `ReadableStream` → `TextEncoder` → `Response`
- Frontend: `fetch` → `reader.read()` loop → split on `\n\n` → parse `data: {JSON}` events
- Tips use incremental JSON parsing to emit individual Tip objects before the full response completes

## Key Conventions

- **Image format**: All images are transmitted as base64 `data:image/jpeg;base64,...` URLs
- **Client-side compression**: Canvas-based resize to max 1024px, JPEG quality 0.85 before upload
- **Dark theme**: Black background with fuchsia/red accents, defined via CSS custom properties in `globals.css`
- **Mobile-first**: Touch swipe handling (40px threshold), safe area insets, no-zoom viewport
- **Path alias**: `@/*` maps to `./src/*`
- **Deployment**: Vercel (`.vercelignore` excludes test assets)
