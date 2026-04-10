# Handoff: Remotion Design 系统 — 待解决问题

## 当前分支
`dev`

## 架构概览

Agent 的 `run_code` tool 可以返回 `{ type: 'design', code, width, height, duration? }` 类型的结果。`code` 是 React JSX 字符串，由前端的 Remotion Player 渲染。

### 显示
- **Canvas（GUI）**：`designsMap`（`src/components/Editor.tsx:340`）收集所有有 `design` 字段的 snapshot，ImageCanvas 检测后渲染 Player
- **CUI（聊天）**：`msg.design` 存在时渲染 `<RemotionRenderer>`，当前是 live Player（不截图不销毁）

### 截图（poster）
- 用途：`snapshot.image`（持久化、刷新恢复）、tips 生成、CUI 缩略图
- 当前方案：`renderStillOnWeb` + `resolveCodeUrls`（预取 code 中的 HTTP URL 为 data URL，绕 Canvas CORS）
- **问题**：iOS Safari 上截图缺图（详见下方）

### 编译
- Sucrase（~1MB，bundle 内）优先
- Babel CDN（`@babel/standalone`）按需 fallback
- 服务端 harness（`src/lib/design-harness.ts`）在发给前端前做编译检查

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/components/RemotionRenderer.tsx` | Player 渲染 + renderStillOnWeb poster + resolveCodeUrls + autoCapture |
| `src/components/Editor.tsx` | designsMap, pendingDesign 流程, handleDesignPoster |
| `src/components/AgentChatView.tsx` | CUI 里 design 消息渲染 Player |
| `src/components/ImageCanvas.tsx` | Canvas 里 animatedDesigns → Player |
| `src/lib/design-harness.ts` | 服务端 harness：编译 + 图片引用 + URL 有效性 |
| `src/lib/evalRemotionJSX.ts` | Sucrase/Babel 编译 + Remotion scope |
| `src/lib/agent.ts` | run_code design 结果处理, ctx 更新 |

---

## 待解决问题 1：CUI 截图时机 + Player 销毁时机

### 背景

CUI 里的 design 需要截图（poster）用于 snapshot 持久化和 tips。同时 Player 不能一直存在（多个 Player 会卡）。

### 已验证的事实

1. **Canvas（GUI）的 Player 图片始终正常**——因为 Player 在可见 DOM 中，浏览器正常加载图片
2. **`renderStillOnWeb` 截图在 iOS Safari 上缺图**——即使 `resolveCodeUrls` 预取了 URL，Canvas taint 问题仍偶发
3. **`html-to-image`（toJpeg）截图效果不好**——截出来尺寸不对（Player 容器的渲染尺寸 ≠ design 原始尺寸），导致大片黑色
4. **CUI 里 live Player 图片完美**——用户能看到完整内容
5. **多个 Player 同时存在 DOM 会导致卡顿**——每个 Player 持续渲染帧，消耗 CPU

### 推荐方案

**Player 先显示 → 确认帧渲染完成 → 截图 → 替换成 poster 图片 → 销毁 Player**

截图时机方案（按可靠性排序）：

**方案 A：seekTo(0) + `seeked` 事件 + 短延时**
```ts
playerRef.current?.seekTo(0);
playerRef.current?.pause();
playerRef.current?.addEventListener('seeked', () => {
  setTimeout(async () => {
    // 截图
  }, 1500); // 保险延时让图片加载
});
```
- PlayerRef 支持 `seeked` 事件（`node_modules/@remotion/player/dist/esm/index.mjs` 里有 `seeked: []`）
- 也支持 `frameupdate` 事件但它不保证图片加载完

**方案 B：监听所有 `<img>` 的 onLoad**
- Player mount 后，遍历容器内所有 `<img>` 元素
- 等所有 `img.complete` 或 `img.onload` → 截图
- 更精确但实现复杂

**方案 C：`renderStillOnWeb` 继续用但修复 CORS**
- 在 `resolveCodeUrls` 里用 `fetch` + `mode: 'no-cors'` 或服务端代理
- 不推荐——`renderStillOnWeb` 的 Canvas taint 是底层限制

### Player 销毁时机

截图成功后，用 `posterUrl` state 替换 Player：
```tsx
if (posterUrl) return <img src={posterUrl} />;
return <Player ... />;
```

### 需要的改动

1. `RemotionRenderer.tsx`：改 `autoCapture` 逻辑——用 seeked + 延时替代固定 3s
2. `AgentChatView.tsx`：恢复 `autoCapture=true`（当前是不截图不销毁的临时方案）
3. `Editor.tsx`：`handleDesignPoster` 回调更新 snapshot + message

---

## 待解决问题 2：Vercel 上 iOS 用户 Agent 静默断掉

### 现象

在 Vercel preview/production 上，iOS Safari 用户发 design 请求后，Agent 回了文字开始思考，到出 code 的时候 **SSE 流静默断掉**——没有错误提示，没有超时消息。PC Chrome 上同样请求正常。

本地 dev server（`http://192.168.1.23:3000`）不复现——PC 和 iOS 都正常。

### 已排除的原因

| 猜测 | 排除原因 |
|------|---------|
| Vercel maxDuration 超时 | 已升到 300s（Pro plan），静默发生在 <60s |
| Opus 4.6 太慢 | 本地同模型正常，且思考阶段有文字输出 |
| Babel/Sucrase 编译问题 | 本地同代码正常 |
| renderStillOnWeb CORS | 这是截图问题不是 SSE 断掉 |

### 可能的原因

1. **Vercel Edge proxy idle timeout**：Opus 4.6 写 code 时可能有 20-30 秒没有 SSE token 输出（思考中）。Vercel Edge proxy 可能有独立的 idle timeout（不受 maxDuration 控制），没数据就断连。本地没 Edge proxy 所以不复现。

2. **SSE payload size**：design code 可能 5000-10000 chars，加上 JSON 编码后单个 SSE event 很大。Vercel 对单个 SSE event data 可能有缓冲区限制。

3. **Bedrock tool name validation error**：Opus 4.6 偶发生成非法 tool name（包含非 `[a-zA-Z0-9_-]` 字符）。已在 iOS 上看到过此错误。但用户说"不是这个"——可能还有其他原因。

### 排查方向

1. **Vercel Logs**：在 Vercel Dashboard → Logs → 筛选 `POST /api/agent` → 看 status code 和 duration。504/502 = 超时，200 但 duration 短 = Edge proxy 断掉。

2. **SSE 心跳**：在 Agent SSE 流里加心跳（每 10 秒发一次空 event），防止 Edge proxy 判定 idle。代码位置：`src/lib/agent.ts` 的 `runMakaronAgent` async generator。

3. **chunked encoding**：确认 `src/app/api/agent/route.ts` 的 Response 使用了 `Transfer-Encoding: chunked`（默认应该是）。

### 需要的改动

如果确认是 idle timeout：
- 在 `agent.ts` 的 event loop 里加心跳 timer：Agent 思考时每 10 秒 `yield { type: 'status', text: '...' }`
- 或在 `route.ts` 的 ReadableStream 层加 keep-alive comment event

---

## 经验总结（给接手 agent 的提示）

### 关于 renderStillOnWeb
- 它是 Remotion 自研的 DOM-to-Canvas 引擎，**不是浏览器原生渲染**
- Canvas 加载外部图片有 CORS 限制——即使预取为 data URL，iOS Safari 仍然偶发 taint
- **不要指望它在 iOS Safari 上可靠渲染外部图片**
- Chrome 上基本没问题

### 关于 Remotion Player
- Player 是真实浏览器 DOM 渲染，**外部图片加载没有 CORS 问题**
- Player 在可见 DOM 中时图片一定能加载
- Player 在 off-screen（`left: -9999` 或 `opacity: 0`）时，**iOS Safari 会延迟加载图片**——必须可见
- 多个 Player 同时存在会导致卡顿——需要控制数量

### 关于 ctx.snapshotImages
- 统一用 Supabase Storage URL（不是 base64）
- 首次上传后 URL 可能还没就绪——`handleAgentRequest` 里有最多 5s 等待逻辑
- Agent 应该在 code template literal 里用 `${ctx.snapshotImages[N]}`，不用 props 传图片

### 关于 design harness
- `src/lib/design-harness.ts` 在服务端检查 Agent 输出
- 编译失败 / 字符串字面量 / 大 base64 / 空 URL → 返回错误让 Agent 重试
- harness 通过不代表前端一定能渲染——前端还有 CORS、CSS 支持等问题
