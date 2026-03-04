# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

| 环境 | URL | 部署方式 |
|------|-----|---------|
| 正式 | https://www.makaron.app | `npx vercel --prod` |
| 测试 | 每次生成新 preview URL（可登录） | `npx vercel` |

两个环境共享同一个 Supabase 数据库。Vercel 环境变量已配 Production + Preview 双份，preview 部署可正常登录。

**Vercel 环境变量设置必须用 `printf`，禁止用 `echo`**（echo 会在值末尾加 `\n`，导致值不匹配、API 请求失败等隐蔽 bug）：
```bash
printf 'value' | npx vercel env add NAME production --force
printf 'value' | npx vercel env add NAME preview --force
```

## i18n（多语言，2026-03-04）

**架构**：自定义 i18n，无第三方库。`src/lib/i18n.tsx`（LocaleProvider + useLocale + LocaleToggle）+ `src/lib/locales/zh.ts` + `src/lib/locales/en.ts`（~90 keys）。

**语言切换**：localStorage + cookie 双写。客户端用 `useLocale().t(key)` 读翻译；服务端 API 路由用 `req.cookies.get('locale')` 读语言（无需前端透传）。切换按钮在登录页右上角和项目列表页 Sign out 旁。

**Tips 英文**：`/api/tips` 读 cookie locale → `streamTipsByCategory(... locale)` → 在用户消息**最前面**插入 `IMPORTANT: You MUST output ALL "label" and "desc" fields in English only.`（必须放最前，放末尾会被中文 analysisStep 覆盖）。

**CUI 回复语言**：`agent.md` 改为 `Reply in the same language the user writes in.`（原来是 `Speak Chinese to the user.`）。这利用 LLM 自然语言跟随能力，用户说中文回中文，说英文回英文。AI-initiated 消息（teaser/reaction/analysis）通过 `api/agent/route.ts` 的 `isEn` 显式控制（中英文两套 prompt）。

**已翻译组件**：layout, login, projects, projects/[id], Editor, AgentStatusBar, AgentChatView, TipsBar, ImageCanvas, AnimateSheet, VideoResultCard。

### Prompt 层 i18n 改动（2026-03-04）

**核心原则**：所有 prompt base 改为英文，`withLocale(prompt, locale)` 控制输出语言。中文 base + "Reply in English." 不可靠（中文语言惯性太强），但英文 base + "Reply in Chinese." 完全可靠。

**`withLocale` 工具函数**（`agent.ts` 导出，`gemini.ts` 内也有一份）：
- `withLocale(prompt, 'en')` → `prompt + "\nReply in English."`
- `withLocale(prompt, 'zh')` → `prompt + "\nReply in Chinese."`
- `withLocale(prompt, undefined)` → `prompt`（不追加，用于 `generateEditPromptForTip`）

**Tips 生成（影响出图质量的核心路径）**：
- `buildCategorySystemPrompt`：英文中性 base，**不加 withLocale**（避免 "Reply in Chinese." 干扰 editPrompt）
- label/desc 语言由 `getJsonFormatSuffix(locale)` 控制（ZH/EN 两版 JSON format 示例）
- editPrompt 三道保障：system prompt `editPrompt: English`、JSON 示例 `(MUST be in English)`、`.md` 模板规则
- **`.md` 模板（enhance/creative/wild）零改动**，editPrompt 质量不受影响
- `captions.md` 仅删除"默认用中文"语言约束段落

**Agent CUI 消息（不影响出图）**：
- 4 个内联 prompt（teaser/nameProject/readyPrompt/reactionPrompt）全部改为英文 base + `withLocale`
- `ANALYSIS_PROMPT_INITIAL/POSTEDIT`：保持中文 base + `withLocale`（分析场景中文 base 可靠）
- `agent.md`：`[User request — detect language and reply in same language]` 标签让 CUI 对话跟随用户输入语言

## Current Status

Tips prompt 迭代到 V42，均分 7.3。V34 历史最高 8.03，V42 是 prompt 架构重构后首测（7.3）。当前生图和 tips 均走 OpenRouter `gemini-3.1-flash-image-preview`（从 `gemini-3-pro-image-preview` 切换，2026-02-27）。tips/preview 缩略图不走 MOCK_AI（已关闭）。

**模型对比测试结论（2026-03-01，v66-v71）**：生图确认用 `gemini-3.1-flash-image-preview`（reasoning: minimal），速度 ~19s，质量与 Pro 持平。Tips 创意用 Pro 或 Flash High 均可（均分 8.0 持平），Flash Min 出 tips 创意太差（5.3）。Flash High thinking 对生图无帮助（反而 2.6x 更慢）。详细数据见 `progress.md` 模型对比章节。`scripts/batch-test-compare.mjs` 为多模型对比测试工具。

**模型切换 gemini-3.1-flash-image-preview（2026-02-27）**：`IMAGE_MODEL` 环境变量控制生图模型（默认 `gemini-3-pro-image-preview`），tips 和生图共用同一模型。切换后 tips 速度从 20+s 首 tip 降至 ~3-5s 全部出齐（4x 提速）。新模型额外能力：输出分辨率控制（512px/1K/2K/4K）、超宽比例（1:4/4:1/1:8/8:1）、Thinking 级别（minimal/high）、图片搜索 Grounding、更多参考图（10 物品+4 人物）。

**Tips 速度 vs 质量（已解决，2026-02-27）**：gemini-3.1-flash-image-preview 同时解决速度和质量——tips 全部出齐 ~5s（之前 gemini-3-pro 首 tip 20+s），质量用户确认满意。`TIPS_PROVIDER` 可切换：`openrouter`（默认）/ `bedrock`（Sonnet）/ `google`。`TIPS_TEMPERATURE=0.9`。

**Prompt 架构（V42 重构）**：`.md` 文件是唯一真相来源，gemini.ts system prompt 极简化（2行），batch-test TIPS_SYSTEM_PROMPT 极简化（3行）。enhance.md 包含 7 个方向（A-F + G 净化场景）、FIRST cleanup 第一句约束、jawline 瘦脸条件、眼睛禁改。creative.md 升级 cleanup 为第一句。wild.md 保留原版详细四问自检。V42 遗留问题：wild 眼镜禁止陷阱仍突破、enhance 方向F 人物重新生成、creative 风格化重绘、tip 数量分类不稳定。

**图片传输 URL 优先（2026-02-27）**：所有 AI API 调用优先传 Supabase Storage URL（~100 bytes）而非 base64（~1-2MB）。`gemini.ts` 新增 `toImageContent()`（OpenRouter 路径，URL 直传）和 `ensureBase64Server()`（Google SDK 路径，服务端 fetch 转 base64）。`Editor.tsx` 新增 `getImageForApi(snapshot)` 返回 `imageUrl || image`。无 URL 时（刚上传、agent 新生图）fallback base64，agent 聊天额外用 `compressBase64` 兜底 Vercel 4.5MB 限制。前端渲染继续用 base64/内存缓存（零延迟显示），URL 仅用于 API 调用。**重要区分**：Tips 分析（`/api/tips`）只看图不生图，用 `compressBase64(img, 600_000)` 压缩到 600KB 即可；Preview 生图（`/api/preview`）需要高清原图（否则人脸变形），用 `getImageForApi(snap)` 取原始 URL/base64。Commit 后 tips 请求从 ~12MB 并发降到 ~2.4MB，速度接近首次上传。

**Tips Preview 按分类加载（2026-02-27）**：commit 后 `fetchTipsForSnapshot(snapId, img, 'none', tip.category)` 只自动 preview committed 分类的 tips。点击分类 tab 触发 `onCategorySelect` → `generatePreviewsForCategory` 补充其他分类。TipsBar auto-scroll 在 tip 开始生成（`generating`）或完成（`done`）时自动滚动。旧的 `'selective'` 模式（固定 1 enhance + 1 wild）已废弃。

Phase 1（认证）、Phase 2（数据持久化）和 Phase 3（项目列表）已完成。用户认证走 Supabase Auth（Email + Password），数据持久化走 Supabase Storage + Database。路由结构：`/` → `/projects` 项目列表 → `/projects/[id]` 编辑器页面。项目列表展示所有历史项目的 snapshot 缩略图，点击进入编辑器，编辑器顶部有返回按钮。新项目通过项目列表页上传图片创建。所有写入异步后台执行，编辑器体验零延迟。

**v0.6 Makaron Agent（主体完成）**：Claude Sonnet 4.6（Claude Agent SDK + AWS Bedrock）作为 agent 大脑，OpenRouter Gemini 作为生图工具。GUI/CUI 双模切换已实现：GUI = 图片画布模式，CUI = 全屏对话模式（Claude App 风格，无气泡 assistant 文字 + 深色 pill user bubble）。CUI 从右侧滑入，支持 PiP 缩略图、inline 图片（持久化后重进仍显示）。`analyze_image` tool 让 Agent 用 Sonnet 原生视觉看图。AgentStatusBar 常驻底部显示打招呼文字和 Chat 按钮。上传图片不再触发 AI 分析和 CUI 弹出，直接显示 GUI + tips。Agent 消息全量持久化到 Supabase，退出重进历史对话完整恢复。Token 级流式输出（includePartialMessages: true）。多 turn 内容分气泡（analyze 前/后分开）。iOS 右滑拦截（history.pushState）。

**v0.8 PiP 边缘收起**：去掉 72px small 模式（只保留 116/200px）。拖到边角后再推 60px 才收起（两步 UX）。收起后露出 28px peek + 箭头，tap 或 swipe 均可展开。左右两边均可收起。已知：左边收起后用 iOS 右滑手势会触发 back gesture（而非展开 PiP），用户接受 tap 展开作为 workaround。

**Agent 指令接受修复（2026-02-21）**：修复 agent 拒绝用户两类显式请求的问题。①人脸/表情修改：`agent.md` Face Preservation 从"绝对禁止"改为"Default Constraint"，自主生成时遵守，用户显式要求时直接执行。②Caption/文字：`generate_image_tool.md` 的 `"Do NOT add any text"` 加例外条款，用户要求文字时省略。已验证 skill 路由（wild/enhance/creative 均正确注入 .md 模板）及两类请求均可正常执行。

**v0.9 GUI↔CUI Hero 过渡动画**：点击 Chat 按钮时，canvas 图片飞入变成 PiP（GUI→CUI）；点击 PiP 时，PiP 放大飞回 canvas（CUI→GUI）。核心机制：`fixed z-[100]` Hero Overlay，在 canvas 图片位置和 PiP 位置之间做 CSS transition（380ms，cubic-bezier）。GUI→CUI 起点取图片的 1:1 中心裁剪正方形（用 `containRect` 计算后再取 `min(w,h)` 的正方形），因为两端都是正方形，img 直接用 `object-cover` 不做额外动画。CUI→GUI 起点是 PiP 真实 DOMRect，终点是 canvas 全区域，img 用 `coverRect`→`containRect` 绝对坐标动画，完美匹配 ImageCanvas 的 `object-contain` 渲染。hidePip prop 在动画期间隐藏真实 PiP（opacity:0）。PiP tap 改为返回 GUI（原来是切换尺寸）；尺寸切换移到右下角专属 resize handle（放大/缩小图标）。键盘打开时 tap PiP 会先 blur 等键盘收起（300ms）再执行动画。

**项目页重设计**：2 列 gallery 展示最新 snapshot，Makaron wordmark 800 字重，副标题"one man studio"（Caveat 手写体）。

**IndexedDB 本地缓存（2026-02-23）**：解决 Supabase 上传未完成时退出、重进图片消失的问题。`src/lib/imageCache.ts` 实现双层缓存：内存 Map（同步写入）+ IndexedDB（异步持久化）。版本 3，三个 store：`images`（图片 base64）、`project-data`（项目元数据 JSON）。5 处写入点：原图上传、agent 生图、commit tip draft、tip preview、pendingImage。`getCachedProjectDataSync()` 同步读内存 cache，在 `useState` 初始值里直接用——同 session 内回到项目完全无 spinner、无延迟。关键 bug 记录：DB 名 `makaron-images` 已存在 v1（store 叫 `"snapshots"`），版本号不触发 `onupgradeneeded`，写入全部静默失败——版本升到 2/3 修复。

**项目页导航性能修复（2026-02-23）**：根因是 middleware 每次导航调 `supabase.auth.getUser()`（服务端网络请求，~300-500ms），用户点击后冻结 3s 才有反应。修复：改为 `getSession()`（读 cookie，0 延迟）。同时：项目卡片从 `<div onClick>` 改为 `<Link href>`（`<a>` 标签，iOS touch 响应零延迟，`:active` 状态立即触发）；`<img>` 加 `pointer-events: none`（防止 img 拦截 touch 事件）；点击卡片瞬间触发 `page-slide-out` 动画（立即视觉反馈），编辑页用 `page-slide-in` 从右滑入；同 session 重进项目用内存缓存同步初始化，Editor 直接渲染无 spinner。

**v1.0 Snapshot 动画（2026-02-24，v2 重构完成）**：当项目有 ≥3 个 snapshot 时，timeline dots 末尾出现 ▶ 按钮（24px fuchsia 圆形）。

**核心架构**：`AnimationState` 接口提升到 Editor 层管理，AnimateSheet 和 CUI 共享状态。状态流：`idle` → `generating_prompt`（Agent 后台写脚本）→ `ready`（可编辑/提交）→ `submitting` → `polling`（渲染 ~3-5 分钟）→ `done`（视频完成）。

**视频 Timeline 条目**：视频生成后作为 timeline 最后一个条目（`__VIDEO__` sentinel），可滑动到达。Canvas 渲染 `<video>` 元素，用最后一个 snapshot 作为 poster（避免黑屏首帧），正中间播放按钮点击播放。无 videoUrl 时 fallback 显示最后真实 snapshot。

**VideoResultCard**：`isViewingVideo` 时替换 TipsBar 出现在 canvas 底部（桌面+移动端统一，不再是右侧面板）。设计完全镜像 TipsBar：`w-[200px]/w-[176px]` pill，`h-[72px]/h-[64px]`，`rounded-2xl`。每个 pill = 缩略图（时长 badge）+ 标题（脚本第一行）+ 状态行 + `>` 详情按钮。选中时外层 `<div>` 整体高亮（fuchsia border + ring）。底部加 `视频 · N 个` 行与 TipsBar 分类栏等高。`+ 新视频` 为横向宽按钮。无关闭按钮，视频入口时始终可见。

**AnimateSheet 交互**：底部 sheet（mobile maxHeight 66dvh，z-index 202 > VideoResultCard），支持两种 mode：`create`（创建视频）和 `detail`（查看详情，只读）。智能底部按钮：空 prompt → "✨ 生成脚本"，有 prompt → "🎬 生成视频"，generating/submitting → disabled。`detailAnimation` state 控制 detail 模式，`>` 按钮触发。时长选项：3s/5s/7s/10s/15s/智能。

**脚本生成**：统一用 Agent（Claude Sonnet via Bedrock）替代 Gemini `/api/animate/prompt`。Agent 后台运行不切 CUI，脚本流式写入 `animationState.prompt`，同时存入 CUI messages。`animPromptInFlightRef` 防重复调用。图片以 URL 传给 Bedrock（不传 base64，避免 5-10MB 上传）。`agent.md` 指示 Agent 只输出脚本、不调 `generate_animation` tool。

**状态持久化**：`useProject.loadProject` 查询 `project_animations` 表（completed + processing），重进项目恢复已完成视频或继续轮询进行中任务。`saveSnapshot` 上传完后通过 `onUploaded` 回调更新 `snapshot.imageUrl`（解决新 snapshot 无 URL 导致 ▶ 报错的问题）。

**StatusBar 进度**：`generating_prompt` → "正在写视频脚本..."，`polling` → "视频渲染中 M:SS"（每秒更新），`done` → "视频已生成"。

**视频保存**：Save 按钮通过 `/api/proxy-video` 服务端代理下载（绕过 CORS），iOS 弹出分享表可保存到相册。Save 按钮显示 spinner+"Saving" loading 状态，完成后弹"保存成功" toast（2 秒消失）。图片和视频保存通用。

**CUI 集成**："在 Chat 里看 ↗" 只切视图不触发 Agent。视频完成时自动添加 CUI 消息（含 .mp4 URL，AgentChatView 自动渲染 inline video player）。

**视频 API Provider**：默认 Kling 直连（`kling-v3-omni`，`sound: 'on'`，`<<<image_N>>>` 引用，$0.112/s）。设 `ANIMATE_PROVIDER=piapi` 可切回 PiAPI（`@image_N` 引用，$0.168/s，路由层自动转换格式）。两套代码共存（`piapi.ts` + `kling.ts`）。第一张图用 `type: 'first_frame'` 让 API 从图片自动检测 aspect ratio（支持 4:3、16:9 等任意比例），不再硬编码 9:16。轮询间隔 4 秒。

**放弃任务**：polling 状态下 AnimateSheet 显示"放弃"按钮，点击停止轮询、animationState 回到 ready（保留 prompt），DB 标记 `abandoned`。PiAPI 无 cancel API，服务端继续渲染但忽略结果。

**关键限制**：images 数组限 7 张（Kling v3-omni 上限），必须用 Supabase Storage URL。Agent 写脚本约 2 分钟（Bedrock Sonnet 多图 TTFT 慢）。时长支持 3-15s + 智能模式（不传 duration，API 自行决定）。

**项目页 badges**：每个项目卡片底部显示 `N snaps` badge（>1 时）+ ▶ 播放标志（有已完成视频时）。查询 `project_animations` 表 `status=completed`。

**Supabase 区域迁移（2026-02-24）**：从悉尼（`ap-southeast-2`）迁移到东京（`ap-northeast-1`），解决国内访问延迟问题（悉尼 150-250ms → 东京 40-80ms）。迁移方式：`postgres_fdw` 跨库 `INSERT...SELECT` 搬数据（166 projects + 423 snapshots + 1200 messages + 8 animations），Node.js 脚本批量搬 Storage（2374 文件，10 并发），auth user 连同密码哈希原样复制保持 user_id 不变。Vercel Function Region 同步改为 `hnd1`（东京），API routes 与 Supabase 同区域。旧项目 `usirwprbadrxmeuubitt` 待确认后删除。

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
- `IMAGE_MODEL` — 生图模型 ID（默认 `gemini-3-pro-image-preview`），tips 和生图共用。当前线上 `gemini-3.1-flash-image-preview`
- `OPENROUTER_API_KEY` — Required when `AI_PROVIDER=openrouter`
- `MOCK_AI` — Set to `'true'` to mock all AI calls in `gemini.ts` (chat returns mock text, tips returns hardcoded 6 tips, preview returns original image). 不需要测试 AI 功能时使用，节省 Gemini API 费用。仅在 `.env.local` 中设置，Vercel 线上不设置。

## Architecture

### Frontend (single-page client app)

`src/app/page.tsx` redirects to `/projects`. `src/app/projects/page.tsx` is the project gallery page (fetch projects + snapshots, new project creation via image upload). `src/app/projects/[id]/page.tsx` is the editor page that loads persisted data and renders `<Editor>`. `src/components/Editor.tsx` is the main client component managing all app state: messages, snapshots (image timeline), view index, loading states, and GUI/CUI view mode. It accepts optional persistence callbacks (`onSaveSnapshot`, `onSaveMessage`, `onUpdateTips`) and `onBack` from the project page. `viewMode` state controls GUI (image canvas) vs CUI (full-screen chat) rendering.

Key components in `src/components/`:
- **ImageCanvas** — Full-viewport image display with swipe/keyboard navigation, pinch zoom, long-press before/after comparison, draft preview mode
- **TipsBar** — Horizontal carousel with thumbnail previews (72x72), two-click interaction (preview → commit), ">" glow button for confirmation
- **AgentChatView** — CUI full-screen chat (Claude App style): PiP thumbnail, inline images, tool status cards, markdown rendering, slide-in/out animation
- **AgentStatusBar** — Agent activity indicator with "聊天" button to open CUI
- **ChatBubble** — Legacy bottom-right chat panel (kept but no longer rendered in Editor)
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
- **POST /api/upload** (`src/app/api/upload/route.ts`) — HEIC→JPEG conversion (uses macOS `sips`, Linux 上不可用) and Sharp-based compression (max 2048px, quality 90%). **仅作为 fallback**：iPhone 用户 iOS 自动转 JPEG，不经过此接口。只有桌面浏览器直接上传 `.heic` 文件才触发（线上会 500，非真实用户场景）。

### AI Layer

`src/lib/gemini.ts` is the core orchestration module:
- **Dual provider support**: Google Gemini SDK or OpenRouter HTTP proxy, selected by `AI_PROVIDER` env var（用于生图）
- **Tips provider 独立**: `TIPS_PROVIDER` env var 控制（`bedrock` 默认 / `openrouter` / `google`），与生图 provider 解耦
- **Image content helpers**: `toImageContent(image)` 统一构建 OpenRouter 图片内容（HTTP URL 直传，base64 fallback）；`ensureBase64Server(image)` 服务端 fetch URL 转 base64（Google SDK `inlineData` 需要）
- **Session management**: In-memory `Map<projectId, Session>` with 30-minute TTL auto-cleanup, keyed by project ID
- **`chatStreamWithModel`**: Async generator yielding `{type: 'content'|'image'|'done'}` chunks
- **`streamTips`**: Analyzes uploaded image against prompt templates, yields parsed Tip objects incrementally
- **`generatePreviewImage`**: Stateless one-shot image editing for thumbnail previews
- **Prompt templates**: Loaded from `src/lib/prompts/*.md` files (cached in production). Three-question self-check framework for each category.

`src/lib/agent.ts` is the Makaron Agent module (Claude Agent SDK):
- **MCP tools**: `generate_image` (calls Gemini via `generatePreviewImage`) and `analyze_image` (returns image content block for Sonnet's native vision)
- **`runMakaronAgent`**: Async generator yielding SSE events (`status`, `content`, `image`, `tool_call`, `done`, `error`)
- **Multi-turn context**: Editor prepends recent 6 messages to the prompt for conversation continuity
- **System prompt**: `src/lib/prompts/agent.md` — workflow: vague requests → analyze first, explicit requests → generate directly

### Persistence Layer

- **Supabase Auth**: Email + Password, middleware 路由保护, API 路由 401 校验
- **Supabase 区域**: `ap-northeast-1`（东京），项目 ref `sdyrtztrjgmmpnirswxt`（2026-02-24 从悉尼 `ap-southeast-2` 迁移）
- **Supabase Storage**: `images` bucket, 路径 `{userId}/{projectId}/{filename}`, 公开读
- **Database**: `projects`, `snapshots`（image_url + tips jsonb）, `messages`, `project_images`（预留）, `project_animations`, 全部 RLS 保护
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

- **Image format**: AI API 调用优先传 Supabase Storage URL（有 URL 时 ~100 bytes），无 URL 时 fallback base64 `data:image/jpeg;base64,...`。前端渲染始终用 base64/内存缓存（零延迟）
- **Client-side compression**: Canvas-based resize to max 2048px, JPEG quality 0.92。压缩完成后立即开始 tips 请求（不等服务端上传）。`compressBase64` 仅在 agent 聊天且无 URL 时兜底 Vercel 4.5MB 限制。`/api/upload` 仅作 HEIC fallback
- **Dark theme**: Black background with fuchsia/red accents, defined via CSS custom properties in `globals.css`
- **Mobile-first**: Touch swipe handling (40px threshold), safe area insets, no-zoom viewport
- **Path alias**: `@/*` maps to `./src/*`
- **Deployment**: Vercel, Function Region `hnd1`（东京），自定义域名 `makaron.app`

## Agent 开发原则（已验证）

### System Prompt vs 工具描述的职责分离
| 文件 | 放什么 |
|------|--------|
| `agent.md`（system prompt）| **路由层**：工作流判断、何时调哪个工具、用户意图识别 |
| tool description（`agent.ts` 里） | **工具层**：参数含义、图的角色、输出格式、边界条件 |

### 最佳实践
1. **工具描述自包含**：假设 Claude 只看工具描述，应该知道如何正确调用它。不要在 agent.md 里重复工具的参数细节。
2. **自检问题 > 规则清单**：`"先答：用户想 FIX 现在的，还是 START FRESH？"` 比 `"当用户说'重新做'时设 true"` 更健壮，让模型自己推理。
3. **把意图决策变成显式参数**：让 Claude 显式传参（如 `useOriginalAsBase`），不要让工具内部猜意图，职责清晰。
4. **Context injection 优于重复说明**：`[图片分析结果]`、`[对话历史]` 等 injected context 比在 system prompt 里重复描述图片信息更高效。

---

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

**CLAUDE.md 记录粒度原则**：只记"下次新对话需要第一时间知道的事"。架构变化、当前状态、设计决策 → 进 CLAUDE.md。**UI 细节（高度、间距、按钮样式、布局微调）、bug fix 过程、踩坑细节 → 只进 progress.md，不进 CLAUDE.md**。一句话概括不了的内容大概率不该进 CLAUDE.md。

### 何时读取 progress.md
- 优化 tips prompt → 先读最新 2 个版本章节
- 改 UI 交互 → 先读"产品优化"章节
- 不确定某个方向是否已试过 → 搜索 `progress.md`
