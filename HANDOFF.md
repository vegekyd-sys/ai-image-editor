# Handoff: Remotion Design 系统 — 已解决问题记录

## 当前分支
`dev`

## 架构概览

Agent 的 `run_code` tool 可以返回 `{ type: 'design', code, width, height, duration? }` 类型的结果。`code` 是 React JSX 字符串，由前端的 Remotion Player 渲染。

### 显示
- **Canvas（GUI）**：`designsMap`（`src/components/Editor.tsx`）收集所有有 `design` 字段的 snapshot，ImageCanvas 检测后渲染 Player
- **CUI（聊天）**：`msg.image` 有值时显示 poster 静态图（点击跳 GUI），无 poster 时不显示 Player

### 截图（poster）
- `captureDesignPoster(design)` — 独立函数，不需要 DOM/Player
- 内部：`resolveCodeUrls`（预取 URL → data URL 绕 CORS）→ `evalRemotionJSX` → `renderStillOnWeb`（frame 30）
- **Remotion `<Img>` 的 `delayRender` 保证图片加载完才截图**
- Editor.tsx 收到 pendingDesign 后直接调此函数，poster 设到 snapshot.image + msg.image

### 编译
- Sucrase（~1MB，bundle 内）优先
- Babel CDN（`@babel/standalone`）按需 fallback
- 服务端 harness（`src/lib/design-harness.ts`）在发给前端前做编译检查 + **自动 `<img>` → `<Img>` 转换**

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/components/RemotionRenderer.tsx` | `captureDesignPoster()` 独立截图函数 + Player 纯播放组件 |
| `src/components/Editor.tsx` | designsMap, pendingDesign → captureDesignPoster, handleDesignPoster |
| `src/components/AgentChatView.tsx` | CUI 里 design 消息显示 poster 图（统一 inline image 渲染） |
| `src/components/ImageCanvas.tsx` | Canvas 里 animatedDesigns → Player |
| `src/lib/design-harness.ts` | 服务端 harness：编译 + 图片引用 + URL 有效性 + `<img>`→`<Img>` 自动修复 |
| `src/lib/evalRemotionJSX.ts` | Sucrase/Babel 编译 + Remotion scope（含 `Img`） |
| `src/lib/agent.ts` | run_code design 结果处理, SSE heartbeat |

---

## 已解决问题 1：Design 截图缺图（2026-04-10）

### 根因
Agent 生成的 JSX 用 `<img>`（HTML），没有 Remotion 的 `delayRender` 信号。`renderStillOnWeb` 不等图片加载就截图。Chrome 桌面 decode 快碰巧能截到，iOS Safari decode 慢就截空。

### 修复
1. **Agent prompt**：示例改为 `<Img>`，加说明 "Use `<Img>` instead of `<img>`"
2. **design-harness**：`autoFixImgTags()` 自动把 `<img` 替换成 `<Img`（兜底）
3. **`captureDesignPoster()`**：从 RemotionRenderer 抽出为独立函数，不需要 DOM/Player
4. **Editor.tsx**：pendingDesign 到了直接调 `captureDesignPoster`（不经 CUI Player）
5. **AgentChatView**：统一 inline image 渲染（design 和 generate_image 共用），CUI 不 mount Player
6. **Frame 30**：poster 截第 30 帧（30fps 下约 1s），避免动画首帧黑屏

### 关键知识
- Remotion `<Img>` 内部用 `delayRender`/`continueRender`（`Img.js:97,141-165`），`renderStillOnWeb` 等所有 `delayRender` 完成才截图
- `resolveCodeUrls` 解决 CORS（URL→data URL），`<Img>` 解决加载时序
- Data URL 在浏览器中仍然异步 decode，所以即使 CORS 解决了，没有 `delayRender` 仍会截空

---

## 已解决问题 2：iOS Safari SSE 断连（2026-04-10）

### 根因
两层问题：
1. **Vercel Edge proxy idle timeout**：Agent 思考/写 code 时 20-30 秒无 SSE 数据 → proxy 断连
2. **iOS Safari 页面 idle**：即使 wire 上有数据，页面无 DOM 更新时 iOS Safari 也会断 SSE（~30-40s）

### 修复（两层保活）
1. **SSE 标准心跳**（`route.ts`）：`setInterval` 每 10s 发 `: heartbeat\n\n`（SSE 注释，客户端自动忽略，但强制 proxy flush）+ `X-Accel-Buffering: no` header
2. **Status bar 计时器**（`Editor.tsx`）：`useEffect` + `setInterval` 每 1s 更新 status bar 显示 "Agent is thinking... (15s)"，触发真实 DOM 更新

### SSE 事件补充
- `reasoning-delta` → yield `{ type: 'reasoning' }` heartbeat（如果 extended thinking 开启）
- `tool-input-delta` → yield `{ type: 'coding' }` heartbeat（仅 `run_code` 时显示 "正在生成代码..."）
- `tool_call` 里 run_code 的 code 被 truncate 到 100 chars，完整 code 通过 `code_stream` 分 500 char chunks 发送

### 已验证的结论
- `reasoningConfig`（extended thinking）会拖慢响应，已移除
- SSE 心跳 + DOM 计时器缺一不可：只有心跳撑不过 40s，只有计时器没有心跳也不行
- `tool-input-delta` 在 `fullStream` 中存在，通过 `tool-input-start.toolName` 区分是哪个 tool

---

## 经验总结

### 关于 renderStillOnWeb
- 它是 Remotion 自研的 DOM-to-Canvas 引擎，**不是浏览器原生渲染**
- **必须用 Remotion `<Img>` 而非 HTML `<img>`**——这是 `delayRender` 的唯一来源
- `resolveCodeUrls` 解决 CORS，`<Img>` 解决加载时序，两者缺一不可
- Chrome 上 `<img>` 偶尔能 work（decode 快），但 iOS Safari 必崩

### 关于 iOS Safari SSE
- iOS Safari 对 SSE 有两层超时：网络层（proxy flush）和页面层（DOM idle）
- `: comment\n\n` 是 SSE 规范的标准心跳，所有 proxy 必须 flush
- 前端必须有真实 DOM 更新（`setAgentStatus` 每秒）才能防止页面 idle 断连
- `X-Accel-Buffering: no` 告诉 Vercel/nginx 不要缓冲 SSE response

### 关于 ctx.snapshotImages
- 统一用 Supabase Storage URL（不是 base64）
- 首次上传后 URL 可能还没就绪——`handleAgentRequest` 里有最多 5s 等待逻辑
- Agent 在 code template literal 里用 `${ctx.snapshotImages[N]}`，不用 props 传图片

### 关于 design harness
- `src/lib/design-harness.ts` 在服务端检查 Agent 输出
- 编译失败 / 字符串字面量 / 大 base64 / 空 URL → 返回错误让 Agent 重试
- **自动 `<img>` → `<Img>` 转换**——Agent 不听话时的安全网
