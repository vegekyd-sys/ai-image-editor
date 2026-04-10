# Handoff: Remotion Design 系统 — 问题已解决

## 当前分支
`dev`

## 问题 1：Design 截图缺图 ✅ 已解决

### 根因
Agent 生成的 JSX 用 `<img>`（HTML），不是 `<Img>`（Remotion）。Remotion 的 `<Img>` 内部用 `delayRender`/`continueRender` 阻塞 `renderStillOnWeb` 直到图片 decode 完成。普通 `<img>` 没有这个信号，`renderStillOnWeb` 立即截图，iOS Safari 上图片还没加载完就截了空。

### 修复
1. **agent.ts prompt**：示例从 `<img>` 改为 `<Img>`，加 IMPORTANT 说明
2. **design-harness.ts**：`autoFixImgTags()` 自动把 `<img` 替换为 `<Img`（兜底）
3. **RemotionRenderer.tsx**：提取 `captureDesignPoster()` 独立函数，不需要 DOM/Player
4. **Editor.tsx**：pendingDesign 到达后直接调 `captureDesignPoster()`，不经过 CUI Player
5. **AgentChatView.tsx**：CUI 只显示 poster 图片（统一 inline image 渲染），不 mount Player
6. **Poster 帧**：截第 30 帧（`frame: Math.min(30, durationInFrames - 1)`），避免黑色首帧

### 关键文件
| 文件 | 改动 |
|------|------|
| `src/lib/design-harness.ts` | `autoFixImgTags()` — `<img` → `<Img` |
| `src/components/RemotionRenderer.tsx` | `captureDesignPoster()` 导出函数 + 纯 Player 组件 |
| `src/components/Editor.tsx` | pendingDesign → `captureDesignPoster()` → `handleDesignPoster()` |
| `src/components/AgentChatView.tsx` | 统一 inline image，无 Player，无 autoCapture |

---

## 问题 2：iOS Safari SSE 断连 ✅ 已解决

### 根因
iOS Safari 在页面无 DOM 更新时会主动断开 SSE 连接（~30-40s 超时）。Agent 思考/写 code 期间可能 20-30 秒没有可见的前端更新。

### 修复（两层保活）
1. **route.ts `: heartbeat\n\n`** — 每 10 秒发 SSE 标准注释，强制 Vercel Edge proxy flush（wire 级别）
2. **Editor.tsx 计时器** — 每 1 秒更新 status bar（"Agent 正在思考... (15s)"），DOM 更新防止 iOS 判定页面 idle

### 额外改进
- **`X-Accel-Buffering: no` header** — 告诉 proxy 不缓冲 SSE
- **run_code code 分 chunk 发送** — `tool_call` 事件只含 100 chars 预览，完整 code 通过 `code_stream` 事件分 500 chars/chunk 发送（避免大 SSE 事件在 iOS 上 JSON.parse 失败）
- **agentStream.ts 错误日志** — JSON parse 失败时 console.warn（不再静默吞掉）

### 排除的方案
- `reasoningConfig`（Bedrock extended thinking）：开启后拖慢响应 2-3x，且保活已由心跳+计时器覆盖
- 纯 SSE 心跳（无 DOM 更新）：wire 上有数据但 iOS Safari 仍断连，需要 DOM 活动

### 关键文件
| 文件 | 改动 |
|------|------|
| `src/app/api/agent/route.ts` | `: heartbeat` 每 10s + `X-Accel-Buffering: no` |
| `src/components/Editor.tsx` | `agentTimerRef` + useEffect 每 1s 更新 status bar |
| `src/lib/agent.ts` | code_stream chunks, tool_call truncated code |
| `src/lib/agentStream.ts` | code_stream handler, JSON parse error logging |

---

## 经验总结

### Remotion `<Img>` vs `<img>`
- `<Img>` 用 `delayRender`/`continueRender`，`renderStillOnWeb` 会等图片加载
- `<img>` 无此信号，截图可能缺图（尤其 iOS Safari decode 较慢）
- `design-harness.ts` 自动修正作为安全网

### iOS Safari SSE 保活
- Wire 级心跳（`: comment\n\n`）不够——iOS Safari 还需要 DOM 更新
- 每秒更新一次 status bar 文字即可防止断连
- `X-Accel-Buffering: no` 确保 Vercel proxy 不缓冲 SSE

### 大 SSE 事件
- run_code 的 code 可能 5000-10000 chars，单个 JSON SSE 事件太大
- iOS Safari 的 JSON.parse 可能静默失败
- 解决：tool_call 只发 truncated preview，完整 code 分 chunk 发送
