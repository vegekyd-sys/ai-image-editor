# Makaron — AI Image Editor PRD

> Version: v1.2 (2026-03-12)
> Production: https://www.makaron.app
> Preview: `npx vercel` (auto-generated URL, shareable)

---

## 1. Product Positioning

### Core Value Proposition

**Makaron turns any ordinary photo into a "wow" moment — no Photoshop skills, no prompt writing needed.**

Upload a photo, and the AI understands its content, mood, and atmosphere, proactively offering 6 targeted editing suggestions — each designed specifically for that image, not generic templates. Users can also chat with the AI agent for precise control, generate videos from their edits, or rotate camera angles in 3D.

### Differentiation

| Dimension | Traditional Tools | AI Beauty Apps | Makaron |
|-----------|------------------|----------------|---------|
| Target | Pro photographers | Selfie users | Everyone who takes photos |
| Barrier | High (expert skills) | Low (but limited) | Minimal (AI suggests) |
| Output | Predictable | Cookie-cutter | Surprise & storytelling |
| Core Feel | Tool | Filter | "Wow, I didn't know this was possible" |

### Product Principles

- **Addition, not replacement**: High-quality edits add small elements while keeping 80%+ of the original untouched
- **Storytelling**: Every creative suggestion must explain in one sentence why it fits this specific image
- **Visual impact**: Enhance effects must be visible within 3 seconds — too subtle = no value
- **Zero-delay UI**: All persistence is async background; the user never waits for the server

---

## 2. Target Users

### Primary Persona

**"Loves taking photos but can't edit"**
- Captures many photos on phone (family, travel, food, daily life)
- Knows photos could be better, doesn't know how
- No time to learn Lightroom/PS
- Wants social media posts that get a second look

### Use Scenarios

1. **Family photos**: Mom wants warmth and story from daily shots with kids
2. **Travel memories**: Scenic portraits that deserve "cinematic feel" or "fun creative twist"
3. **Food captures**: Restaurant/kitchen scenes with playful elements that bring food alive
4. **Daily sharing**: Ordinary photos that need a "finishing touch" for social posts
5. **Video creation**: Turn a series of edits into a short animated video with AI-generated script

---

## 3. Core Features

### 3.1 Project Management

**Project Gallery (/projects)**
- 2-column masonry grid showing latest snapshot per project
- Optimized thumbnails via Supabase Image Transformations (400x400 WebP, ~16KB each)
- Snap count badge (when >1) + play icon (when video exists) per card
- Upload new image or type a text prompt to create project
- Drag-and-drop image support on desktop
- Brand: "Makaron" wordmark (800 weight) + "one man studio" subtitle (Caveat handwriting font)

**Data Persistence**
- All projects, snapshots, messages, animations persisted to Supabase
- IndexedDB local cache (dual-layer: memory Map + async IndexedDB) for instant restore within same session
- Close and reopen — full editing history and conversations restored
- All writes are fire-and-forget, never blocking UI

**Invite Code System**
- New users need invite code to register
- Waitlist for users without code
- Admin panel for code management

### 3.2 Authentication

- **Login**: Email + Password (Supabase Auth)
- Language toggle (zh/en) on login page
- All data isolated per user (Supabase RLS)
- Middleware route protection with `getSession()` (cookie-based, zero-latency)

### 3.3 Editor — GUI Mode (Image Canvas)

**Image Timeline**
- Each edit produces a snapshot, forming a swipeable horizontal timeline
- Long-press: before/after comparison with previous version
- Virtual Draft model: preview without committing to timeline
- Video entry appears as last timeline dot (when project has completed videos)
- Pinch zoom (1x-5x) + double-tap reset

**TipsBar (AI Suggestion Carousel)**
- Bottom horizontal card scroll, 6 AI suggestions per round
- Each card: emoji + title + description + thumbnail preview (72x72, auto-generated)
- **Two-step interaction**:
  - First tap: Preview (virtual Draft on canvas, not committed)
  - Tap ">" glow button: Commit (saves as new snapshot, loads next round of 6 suggestions)
- Category tabs: enhance / creative / wild — tap to switch, auto-generates previews for that category
- Draft preview transition: low-res thumbnail + shimmer animation, seamless swap when full image loads

**Three Suggestion Categories**

| Category | Definition | Typical Effects |
|----------|-----------|-----------------|
| **enhance** | Professional enhancement — lighting, color, texture. Must be visible in 3s | Cinematic lighting, golden hour, overcast-to-sunny, strong depth separation, scene cleanup |
| **creative** | Fun & story-driven — add elements with causal relationship to image content | Chameleon on shoulder, chicks watching roast duck, Tinker Bell casting spell near Disney scene |
| **wild** | Exaggerated transformation of existing objects in the frame | Sunglasses inflating giant, poster text running away, earrings turning into fairies |

**Preview Generation Strategy**
- After commit: auto-generate previews only for the committed category
- Tap another category tab: triggers on-demand preview generation for that category
- After CUI edit: text suggestions only, previews on user tap

**Paintbrush Annotation**
- Drawing mode: 6 colors + 3 brush sizes (S/M/L) + expandable panel
- Box tool for region marking
- Select, move, delete annotations
- Reference image attachment
- Annotations overlay sent with edit prompt to guide AI
- Text tool scaffolded (not yet shipped)

**Camera Rotate (3D Virtual Camera)**
- 3D preview panel with draggable camera (React Three Fiber)
- Azimuth (8 directions, 0-360) x Elevation (4 levels, -30~60) x Distance (3 levels, 0.6~1.4) = 96 combinations
- Generate button calls Qwen LoRA model via HuggingFace/fal.ai
- Result committed as new snapshot with fresh tips
- Desktop: side-by-side 720px centered; Mobile: stacked layout

**AgentStatusBar**
- Persistent bottom bar showing AI state / greeting
- Notification system: "See" button navigates to newly generated image/video
- Draft mode: "Like this? Tell me how to modify"
- Generating: "Generating image x/y"
- Video rendering: "Video rendering M:SS" (live timer)
- Chat button opens CUI

### 3.4 Editor — CUI Mode (Full-screen Chat)

**Chat Interface**
- Full-screen overlay, slides in from right, swipe-right to exit
- Claude App style: no-bubble assistant text + dark pill user messages
- PiP thumbnail (bottom-right): current editing image, tap returns to GUI
- PiP edge collapse: drag to edge → peek 28px + arrow, tap/swipe to expand
- Inline images: AI-generated images displayed in conversation flow
- Inline videos: completed .mp4 URLs auto-render as video players
- iOS back-swipe intercepted (history.pushState)

**GUI-CUI Hero Transition**
- Click Chat: canvas image flies into PiP position (380ms cubic-bezier)
- Click PiP: PiP expands back to canvas position
- CSS transition with fixed z-100 overlay, object-cover/contain matching

**Multi-turn Conversation**
- User describes any modification, AI understands intent and generates
- Conversation history: recent messages prepended for context continuity
- AI has original image reference: sends original + current version for face preservation
- Agent messages fully persisted to Supabase, restored on re-entry

**Conversation Strategy**
- Clear request ("add butterfly on shoulder") → generate directly
- Vague request ("make it better") → analyze image first, then generate
- Complex/unclear → ask one round, then generate
- Face complaint ("face changed") → use original as reference, regenerate
- Matches existing tip → recommend from TipsBar

**Input Box**
- Multi-line textarea, auto-expands
- Enter to send, Shift+Enter for newline

### 3.5 Video Generation (Animate)

**Entry Point**
- Play button on timeline (appears when project has 3+ snapshots)
- "Generate Video" button in AgentStatusBar
- "+ New Video" button in VideoResultCard

**AnimateSheet (Bottom Sheet)**
- Two modes: `create` (new video) and `detail` (view existing, read-only)
- Snapshot thumbnails with delete/reorder (@1 @2 @3...)
- AI script generation: Agent (Claude Sonnet) writes motion script from snapshots
- Manual script editing in textarea
- Duration options: 3s / 5s / 7s / 10s / 15s / smart (API decides)
- Smart bottom button: empty → "Generate Script", has script → "Generate Video"
- Drag-to-dismiss on mobile

**VideoResultCard (Pill Strip)**
- Mirrors TipsBar design: horizontal scroll of pill-shaped cards
- Each pill: thumbnail (duration badge) + title (first line of script) + status + ">" detail button
- Selected pill highlights with fuchsia border + ring
- Replaces TipsBar when viewing video timeline entry
- Bottom label: "Videos - N" matching TipsBar category bar height

**Video Rendering**
- Default: Kling v3-omni (sound on, $0.112/s), auto aspect ratio from first frame
- Alternative: PiAPI (switchable via `ANIMATE_PROVIDER`)
- Images limit: 7 per video (Kling v3-omni cap), must be Supabase Storage URLs
- Polling: 4-second interval during rendering
- Abandon: stop polling, mark DB `abandoned`, preserve script
- Completed videos persisted with URLs stored in Supabase Storage (prevent expiration)

**Video Playback**
- Canvas renders `<video>` element with last snapshot as poster
- Save button: server-side proxy download (bypasses CORS), iOS share sheet compatible
- Loading state + success toast on save

### 3.6 Desktop Responsive Layout

- Breakpoint: 1024px (`useIsDesktop` hook)
- Desktop: `flex-row` — GUI (flex-1) + CUI (w-340px side panel), both always visible
- Mobile: GUI/CUI mutually exclusive with slide animation
- No viewMode toggle, hero animation, or PiP on desktop
- Mouse interaction: mouseDown/Move/Up reuse touch logic for long-press comparison + swipe
- TipsBar: mouse drag horizontal scroll + wheel vertical→horizontal conversion
- Scaled-down sizes: CUI text 14px, TipsBar cards 156px, thumbnails 56px

### 3.7 Internationalization (i18n)

- Custom i18n (no 3rd-party library): `LocaleProvider` + `useLocale()` + ~90 keys
- Language switch: localStorage + cookie dual-write
- Toggle on login page + projects page (next to Sign Out)
- Server API routes read `req.cookies.get('locale')`

**Prompt-level i18n**:
- All prompt bases in English, `withLocale(prompt, locale)` controls output language
- English base + "Reply in Chinese" is reliable; Chinese base + "Reply in English" is not
- Tips: `getJsonFormatSuffix(locale)` controls label/desc language; editPrompt always English
- Agent CUI: follows user's input language naturally; AI-initiated messages (teaser/reaction/analysis) use explicit `isEn` control

---

## 4. User Journey

### Path A: New User

```
Open makaron.app
  → Login (email + password, with invite code)
  → Project gallery (empty state)
  → Upload photo or type text prompt
  → Enter editor
  → ~5s → 6 suggestions appear (text first, preview thumbnails generating)
  → Tap interesting suggestion → see preview (Draft)
  → Tap ">" → commit, enter next editing round
  → Repeat or use Chat for precise adjustment
  → Save to camera roll
```

### Path B: Chat-based Refinement

```
See an enhance effect in GUI
  → Overall good but face looks different
  → Tap StatusBar → enter CUI
  → Say "face changed, can you match the original?"
  → AI uses original as face reference, regenerates
  → Satisfied → return to GUI → tap ">" to confirm
```

### Path C: Create Video from Edits

```
Edit 3+ snapshots in a project
  → Tap play button on timeline
  → AnimateSheet opens → select snapshots
  → "Generate Script" → AI writes motion script (~2 min)
  → Review/edit script → choose duration
  → "Generate Video" → submit to Kling
  → StatusBar shows "Rendering M:SS" → wait 3-5 minutes
  → Video complete → play in canvas → Save
```

### Path D: Revisit History

```
Reopen makaron.app
  → Project gallery with cover thumbnails
  → Tap to enter (instant with IndexedDB cache)
  → Swipe timeline to view all versions
  → Long-press for before/after
  → Continue editing or save
```

---

## 5. AI Capabilities

### Tips Generation

- **Model**: Gemini 3.1 Flash Image Preview (via OpenRouter), `TIPS_TEMPERATURE=0.9`
- **Speed**: ~3-5s for all 6 text suggestions (3 parallel category calls)
- **Strategy**: `.md` template files (enhance.md / creative.md / wild.md) are the single source of truth
- **Quality**: V42 average 7.3/10; V34 historical best 8.03/10
- **Three-question self-check framework** (replacing banned-list approach, validated V8+):
  - Creative: Why this element? (causal) / Mood match? / Too generic?
  - Wild: What existing object changes? / Big enough? / Based on object properties or surface visual analogy?
  - Enhance: Visible improvement in 3s? / Style matches photo mood?

### Image Generation (Preview / Edit)

- **Model**: Gemini 3.1 Flash Image Preview (via OpenRouter), reasoning: minimal
- **Speed**: ~11-19s per image
- **Input**: Max 2048px (client-side compressed), prioritize Supabase URL over base64
- **Output**: JPEG (Sharp quality 95, converted from PNG via `ensureJpeg`)
- **Multi-image reference**: Original + current version sent together for face preservation
- **Face preservation rules** (validated):
  - Safe expressions: only "eyes glance slightly + eyebrows raise tiny amount"
  - Lip changes will break faces
  - Small faces (<10% of frame): no facial modifications, body language only
  - Conditional jawline slimming: only for adults with visible jaw, skip children/round faces

### Agent (Makaron Agent)

- **Model**: Claude Sonnet 4.6 (AWS Bedrock, Claude Agent SDK)
- **Tools**:
  - `generate_image`: Calls Gemini for image generation/editing
  - `analyze_image`: Returns image content block for Sonnet's native vision
  - `rotate_camera`: Calls HuggingFace/fal.ai for 3D camera rotation
- **Multi-turn context**: Recent messages prepended to prompt
- **Original image reference**: `snapshots[0]` passed as face reference on each generation
- **Token-level streaming**: `includePartialMessages: true`
- **System prompt**: `agent.md` — route layer (workflow, intent, when to call which tool)
- **Tool descriptions**: Self-contained (parameter meaning, image role, output format, edge cases)

### Video Script Generation

- **Model**: Claude Sonnet 4.6 (AWS Bedrock) — same Agent, background execution
- **Input**: Snapshot images (as URLs) + project context
- **Output**: Motion script streamed into AnimateSheet textarea + CUI messages
- **Duration**: ~2 minutes (Bedrock Sonnet multi-image TTFT is slow)

---

## 6. Technical Architecture

### Frontend

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, dark theme (black bg + fuchsia/red accents)
- **Mobile-first**: Touch swipe (40px threshold), safe area insets, no-zoom viewport
- **3D**: React Three Fiber + drei (for Camera Rotate)
- **Path alias**: `@/*` → `./src/*`

### Backend (API Routes)

| Route | Function | Max Duration |
|-------|----------|-------------|
| `POST /api/tips` | SSE stream of 6 Tips (Gemini Flash) | 60s |
| `POST /api/agent` | SSE stream agent conversation (Claude + Gemini) | 120s |
| `POST /api/preview` | Stateless single-shot image edit (Gemini) | 120s |
| `POST /api/rotate` | Camera angle rotation (HuggingFace/fal.ai) | 300s |
| `POST /api/upload` | HEIC→JPEG fallback (Sharp compression) | 30s |
| `POST /api/animate/*` | Video generation submit + polling (Kling) | 60s |
| `POST /api/proxy-video` | Server-side video download proxy (CORS bypass) | 60s |

### AI Layer

```
User Photo
    |
    v
Gemini 3.1 Flash (OpenRouter) ← Tips text + editPrompt generation
    |
    v
editPrompt (always English)
    |
    v
Gemini 3.1 Flash (OpenRouter) ← Image generation / editing
    |
    v
Edited Image (JPEG, Sharp quality 95)

Claude Sonnet 4.6 (Bedrock) ← Agent brain + video script generation
    |-- generate_image tool → Gemini
    |-- analyze_image tool → Sonnet native vision
    |-- rotate_camera tool → HuggingFace/fal.ai
```

### Data Layer

- **Auth**: Supabase Auth (Email + Password), middleware route protection
- **Region**: `ap-northeast-1` (Tokyo), project ref `sdyrtztrjgmmpnirswxt`
- **Storage**: `images` bucket, public read. Image Transformations enabled (Pro plan)
  - `getThumbnailUrl()` for responsive thumbnails (400x400, 144x144, 800px, etc.)
  - `getOptimizedUrl()` for canvas main image (width=2000, quality=95, PNG→WebP)
- **Database**: `projects`, `snapshots` (image_url + tips jsonb), `messages`, `project_animations`, all RLS
- **Local Cache**: IndexedDB (`makaron-images` v3) — `images` store + `project-data` store
- **Persistence**: `useProject` hook, all writes fire-and-forget via `Promise.resolve().then(async ...)`

### Deployment

- **Platform**: Vercel, Function Region `hnd1` (Tokyo)
- **Domain**: `makaron.app` (custom)
- **Environments**: Production (`--prod`) + Preview (auto-generated URLs, login works)
- **Key Env Vars**: `OPENROUTER_API_KEY`, `AWS_*` (Bedrock), `SUPABASE_*`, `HF_TOKEN`, `IMAGE_MODEL`, `ANIMATE_PROVIDER`

### Performance Optimizations

| Area | Before | After | Improvement |
|------|--------|-------|-------------|
| Project list transfer | 31.2 MB | 2 MB | -94% |
| Project list LCP | 1,553 ms | 1,091 ms | -30% |
| Editor image transfer (4 snaps) | 7.49 MB | 1.42 MB | -81% |
| AI output format | PNG ~2.5MB | JPEG ~0.7MB | -72% |
| Canvas main image | 1.76 MB PNG | 217 KB WebP | -88% |
| CUI inline images | ~2.3 MB each | ~70 KB WebP | -96% |
| TipsBar thumbnails | Full-size | 4 KB WebP | -99% |
| Navigation (middleware) | getUser() ~500ms | getSession() 0ms | Instant |

---

## 7. Current Metrics

### Tips Quality (V42)

| Metric | Value |
|--------|-------|
| Average score | 7.3 / 10 |
| >= 8 score ratio | 70% |
| enhance avg | 7.2 |
| creative avg | 7.4 |
| wild avg | 7.2 |
| Historical best avg | 8.03 (V34) |

### Speed

| Step | Current |
|------|---------|
| All 6 tip texts | ~3-5s |
| Single preview image | ~11-19s |
| All 6 preview images | ~30-60s (3 concurrent) |
| Agent image generation | ~19s (Gemini) + ~9s (Agent thinking) |
| Video script (Agent) | ~2 min |
| Video rendering (Kling) | ~3-5 min |
| Camera rotation | ~15-25s (warm) / ~150s (cold) |

### Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| Agent multi-image face preservation unstable | High | Documented |
| Wild: glasses-related ideas still break through | Medium | Documented |
| Enhance direction F (weather) sometimes regenerates people | Medium | Documented |
| Camera rotation speed varies (cold start 150s) | Medium | Accepted |
| Video script generation slow (~2 min, Bedrock TTFT) | Medium | Accepted |

---

## 8. Backlog

### P0 (Near-term)

1. **Text annotation tool**: Scaffolded in code (commented out), needs floating input, color panel integration
2. **Tips quality to 8.0+**: V42 at 7.3, historical best 8.03 — prompt iteration continues
3. **Agent face preservation stability**: Investigate Gemini multi-image reference mechanism

### P1 (Mid-term)

4. **Adaptive tips recommendation**: Adjust enhance/creative/wild ratio based on user click history and chat content
5. **Share feature**: Before/after comparison image, one-click social sharing
6. **Batch editing**: Apply same style to multiple photos from an album

### P2 (Long-term)

7. **AI outpainting**: Vertical→horizontal or vice versa for multi-platform publishing
8. **Style transfer series**: One photo x N styles (cyberpunk, ink painting, etc.)
9. **Local inpainting**: Finger-select region, edit only selected area

---

## 9. Design Specs

### Visual Style

- **Primary colors**: Black background (`#080808`) + fuchsia (`#c026d3` / `#e879f9`)
- **Dark glass feel**: UI elements with `rgba(255,255,255,0.08)` layering, backdrop-blur
- **Animation**: Spring cubic-bezier (`0.34, 1.56, 0.64, 1`), breathing dots, shimmer loading
- **Font sizes**: Mobile standard (min 11px, input 21px); Desktop scaled down (CUI 14px)

### Interaction Principles

- **Zero-delay**: All persistence async background, UI never waits
- **Progressive reveal**: Tip text first, preview thumbnails gradually load
- **Mobile-first**: 40px touch targets, safe area insets, single-hand operation
- **Desktop-aware**: Side-by-side layout, mouse drag, wheel scroll conversion

---

## 10. Tips Prompt Methodology (Validated)

### The 10-Score Formula
**Translucency + Character contour preservation + Foreground/background depth separation + Natural color tones = WOW**

### Enhance Directions (Stable 8-score)
A. Cinematic lighting | B. Golden hour | C. Overcast→sunny | D. Night/dusk atmosphere | E. Strong depth separation | F. Weather transformation (danger: face regeneration) | G. Scene cleanup

### Creative Success Formula
"Because [specific object X] is in the frame, adding [element Y] doing [interesting action Z] makes sense"
- X = specific visible thing (food/clothing/landmark), not scene type
- Y = causally related to X
- Z = element doing something interesting (not just "looking at person / standing")

### Wild Priority (by score)
C. Dead-object activation (10) > D. Function extremification (10) > A. Size extremification (8) > B. Material transformation (8)

### Absolute Prohibitions (Validated low-score)
- Terraced fields → cake (3, pure shape analogy)
- Glasses reflection/projection (3, too small to see)
- Modify eye size/shape (causes face regeneration)
- Style redraw (ghibli, ink painting) unless scene extremely matches
- Enhance too subtle ("can't see difference" = 3)
- Scary animals without humor context
