# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Status

Tips prompt 迭代到 V14，均分 7.4（历史最高），≥8 分占 83%。Enhance 稳定 8.0，Creative/Wild 主要瓶颈是小脸保真和执行质量。交互模型已重构为 Virtual Draft（预览→确认两步流程）。当前使用 Google API 直连。

Phase 1（认证）、Phase 2（数据持久化）和 Phase 3（项目列表）已完成。用户认证走 Supabase Auth（Google OAuth + Magic Link），数据持久化走 Supabase Storage + Database。路由结构：`/` → `/projects` 项目列表 → `/projects/[id]` 编辑器页面。项目列表展示所有历史项目的 snapshot 缩略图，点击进入编辑器，编辑器顶部有返回按钮。新项目通过项目列表页上传图片创建。所有写入异步后台执行，编辑器体验零延迟。

## Verified Conclusions（已验证的硬结论）

### Tips Prompt 方法论
- **三问自检框架 >> 禁止清单**：禁止清单是打地鼠（V6 明确禁了梯田变蛋糕还是出现），自检框架让模型学会自己判断（V8 均分 6.2→7.2）
- **加法而非替换**：高分都是往画面加入小元素（变色龙趴肩膀、小鸡站盘边），低分都是替换大面积区域。原图 80% 以上保持不变
- **"与画面无关"是最大杀手**：每个创意必须能一句话解释为什么跟这张图有关

### 三个类别的正确定义
- **enhance** = 专业增强（电影感光影、胶片质感、景深优化），稳定 7-8 分
- **creative** = 有趣有故事（加入与画面内容有因果关系的幽默道具/角色），不是"好看"
- **wild** = 让画面中已有物品发生夸张变形，不是加小道具（那是 creative），不是换场景

### 人脸保真（最大技术约束）
- **安全的表情模板**：只有 "eyes glance slightly + eyebrows raise tiny amount" 是安全的
- **lips part slightly 必崩脸**：V14 实验验证，嘴型变化会导致面部重新生成
- **小脸（<10% 画面）是系统性问题**：小脸场景下任何面部微调都会崩，只能用身体语言反应
- **OpenRouter 人脸变形比 Google 直连严重**：温度调低(0.4)对 enhance 有帮助但对表情变化无效

### 质量信号
- 通透感 + 人物轮廓保真 + 前后景深变化 + 自然色调 = WOW（10 分公式）
- 简陋卡通道具 = 廉价感（写实风道具更安全）
- Enhance 必须一眼看出变化（变化太微妙 = 3 分）
- Enhance 风格必须匹配照片情绪（搞笑表情配阴天 = 4 分）
- Prompt 太长会稀释模型注意力，精简优于详尽

## Commands

- `npm run dev` — Start dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm run lint` — ESLint (runs `eslint` with Next.js + TypeScript config)

No test framework is configured.

## Environment Variables

- `GOOGLE_API_KEY` (required) — Google Gemini API key
- `AI_PROVIDER` — `'google'` (default) or `'openrouter'`
- `OPENROUTER_API_KEY` — Required when `AI_PROVIDER=openrouter`
- `MOCK_AI` — Set to `'true'` to mock all AI calls in `gemini.ts` (chat returns mock text, tips returns hardcoded 6 tips, preview returns original image). 不需要测试 AI 功能时使用，节省 Gemini API 费用。仅在 `.env.local` 中设置，Vercel 线上不设置。

## Architecture

### Frontend (single-page client app)

`src/app/page.tsx` redirects to `/projects`. `src/app/projects/page.tsx` is the project gallery page (fetch projects + snapshots, new project creation via image upload). `src/app/projects/[id]/page.tsx` is the editor page that loads persisted data and renders `<Editor>`. `src/components/Editor.tsx` is the main client component managing all app state: messages, snapshots (image timeline), view index, loading states, and chat panel visibility. It accepts optional persistence callbacks (`onSaveSnapshot`, `onSaveMessage`, `onUpdateTips`) and `onBack` from the project page.

Key components in `src/components/`:
- **ImageCanvas** — Full-viewport image display with swipe/keyboard navigation, pinch zoom, long-press before/after comparison, draft preview mode
- **TipsBar** — Horizontal carousel with thumbnail previews (72x72), two-click interaction (preview → commit), ">" glow button for confirmation
- **ChatBubble** — Bottom-right chat panel with markdown rendering
- **ImageUploader** — File input with client-side compression and drag-and-drop

### Tip Interaction Model (Virtual Draft)

1. 上传图片 → snapshots[0] = 原图
2. Tips 生成后自动并发生成 6 个预览缩略图
3. 点击 tip → 创建虚拟 Draft（不在 snapshots 数组中，通过计算追加到 timeline）
4. 再次点击 → Commit（Draft 变为正式 snapshot，加载新 tips）
5. 长按 → Before/After 对比

### Backend (API routes)

- **POST /api/chat** (`src/app/api/chat/route.ts`) — SSE stream for chat with image editing. Events: `content`, `image`, `error`. Max duration 120s.
- **POST /api/tips** (`src/app/api/tips/route.ts`) — SSE stream of 6 Tip objects (2 enhance + 2 creative + 2 wild) followed by `[DONE]`. Max duration 60s.
- **POST /api/preview** (`src/app/api/preview/route.ts`) — Stateless preview generation, one-shot (no session), returns edited image.
- **POST /api/upload** (`src/app/api/upload/route.ts`) — HEIC→JPEG conversion (uses macOS `sips`) and Sharp-based compression (max 1024px, quality 85%).

### AI Layer

`src/lib/gemini.ts` is the core orchestration module:
- **Dual provider support**: Google Gemini SDK or OpenRouter HTTP proxy, selected by `AI_PROVIDER` env var
- **Session management**: In-memory `Map<projectId, Session>` with 30-minute TTL auto-cleanup, keyed by project ID
- **`chatStreamWithModel`**: Async generator yielding `{type: 'content'|'image'|'done'}` chunks
- **`streamTips`**: Analyzes uploaded image against prompt templates, yields parsed Tip objects incrementally
- **`generatePreviewImage`**: Stateless one-shot image editing for thumbnail previews
- **Prompt templates**: Loaded from `src/lib/prompts/*.md` files (cached in production). Three-question self-check framework for each category.

### Persistence Layer

- **Supabase Auth**: Google OAuth + Magic Link, middleware 路由保护, API 路由 401 校验
- **Supabase Storage**: `images` bucket, 路径 `{userId}/{projectId}/{filename}`, 公开读
- **Database**: `projects`, `snapshots`（image_url + tips jsonb）, `messages`, `project_images`（预留）, 全部 RLS 保护
- **`useProject` hook**: 核心持久化，所有写入 fire-and-forget（`Promise.resolve().then(async ...)`），错误只 console.error
- **Auth**: `AuthProvider` → `useAuth()` hook, server-side `createClient()` for API routes

### Data Model

Defined in `src/types/index.ts`:
- **Project** `{id, userId, title, coverUrl, createdAt, updatedAt}` — User project container
- **Snapshot** `{id, image, tips, messageId, imageUrl?}` — Immutable timeline entries; `imageUrl` is the persisted Storage URL
- **Message** `{id, role, content, image?, timestamp, projectId?}`
- **Tip** `{emoji, label, desc, editPrompt, category, aspectRatio?, previewImage?, previewStatus?}`
- **DbSnapshot** / **DbMessage** — Database row types for Supabase queries

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

## Memory Protocol（记忆协议）

### 文件职责
| 文件 | 作用 | 何时读取 |
|------|------|---------|
| `CLAUDE.md`（本文件） | 架构 + 当前状态 + 已验证结论 + 记忆协议 | 每次对话自动读取 |
| `progress.md` | 详细实验日志（V1-V14+），含完整评分数据和推理过程 | 按需读取相关章节 |

### 更新规则
每次对话如果产生了以下内容，**结束前必须更新对应文件**：
1. **架构/交互模型变更** → 更新本文件的 Architecture 章节
2. **实验结果（跑了 batch-test）** → 追加到 `progress.md`
3. **新的已验证结论**（用户评分确认的规律） → 更新本文件的 Verified Conclusions
4. **当前状态变化**（均分变了、瓶颈变了） → 更新本文件的 Current Status
5. **重要 bug 修复或 UI 变更** → 追加到 `progress.md` 的相关章节

### 何时读取 progress.md
- 优化 tips prompt → 先读最新 2 个版本章节
- 改 UI 交互 → 先读"产品优化"章节
- 不确定某个方向是否已试过 → 搜索 `progress.md`
