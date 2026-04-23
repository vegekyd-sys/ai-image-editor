# Handoff: Agent 完全后端化

## 核心目标

Agent 完全脱离前端，作为独立后端服务运行。任何客户端（前端页面、Claude Code、MCP、API）都可以触发 agent，通过 DB 获取结果。前端变成纯"观察者"。

**不是目标**：用 Replay Engine 替代 loadProject。loadProject 读的是真实 DB 数据（snapshots + messages 表），是 source of truth。Replay Engine 用于回放展示和 reconnect，不替代数据加载。

## 当前状态（2026-04-16）

### 已完成

**Background Agent 核心（已合入 dev）**：
- `AgentDualWriter`：SSE + DB 双写，共享 ID（前端和服务端用同一个 snapshotId/messageId）
- `agent_runs` + `agent_events` 表：RLS + Realtime publication
- `useAgentRun` hook：检测 running run → 回放历史 events → Realtime/Polling 接续
- `makeAgentCallbacks` factory：SSE 和 reconnect 共享同一套 callback 逻辑
- Abort：`POST /api/agent/abort` → 标记 run aborted → 服务端每 ~10 events 检查
- 88 个 Vitest 单元测试

**Replay Engine（在 worktree 分支，未合入 dev，OPTIONAL）**：
- `ReplayEngine.buildState(events)` → 从 events 重建 ProjectState
- 仅用于未来"分享回放"功能，**不替代 loadProject**
- loadProject 读 snapshots + messages 表，是 source of truth
- 完全后端化后，前端只需 loadProject + polling，不需要 ReplayEngine
- 如果不做分享回放功能，可以不合入

**也在 worktree（可合入 dev）**：
- `projectEventLogger.ts`：前端写用户侧 events（给审计 + 未来回放用）
- `agent_events.project_id` 列（直接关联项目）
- DualWriter 1:1 存所有 SSE events（含 reasoning/coding/code_stream）

### 已知问题

1. **Realtime 不可靠**：Supabase Nano plan 的 Realtime WebSocket 经常不推送 events。已改为 2 秒 polling 作为主要机制（Realtime 保留但不可依赖）。

2. **Reconnect 时用户消息显示**：reconnect 回放 agent events 时，`user_message` events（`run_id=null`）不在当前 run 的 events 里，需要从 buildState 已加载的历史中保留。已删除 `onClearRunMessages`，但可能仍有 timing 问题。

3. **content 逐条存储的性能**：Phase 1 改为每个 content delta 单独存（为了 Replay 1:1 还原 SSE）。一个 agent turn ~200 条 content events。大项目可能有 3000+ events。当前用分页查询兜底，但 buildState 处理时间可能变长。

4. **并行 run 的 content 交错**：多图上传时系统并行启动 3 个分析 run。按 `run_id` 分组处理后已解决，但如果有其他并行场景可能需要类似处理。

5. **Design poster 截图**：DualWriter 写 design snapshot 时 `image_url=''`（poster 需要客户端 Remotion 渲染）。Editor 有 auto-capture effect 在加载时自动截图。完全后端化后需要服务端渲染替代方案。

## 架构概览

### 数据流

```
用户操作 ──→ projectEventLogger ──→ agent_events 表（project_id, type, data）
                                        ↑
Agent 执行 ──→ AgentDualWriter ────→ agent_events 表（run_id + project_id）
                  │                     ↓
                  ├──→ snapshots 表    buildState() → ProjectState
                  ├──→ messages 表     loadProject() → 同样的 ProjectState（fallback）
                  └──→ workspace storage（design JSON）
```

### 关键文件

| 文件 | 作用 | 行数 |
|------|------|------|
| `src/lib/agentDualWriter.ts` | 服务端双写引擎 | ~290 |
| `src/lib/agentCallbacks.ts` | 统一 callback factory | ~350 |
| `src/lib/replayEngine.ts` | buildState + playback | ~370 |
| `src/lib/projectEventLogger.ts` | 前端用户事件写入 | ~70 |
| `src/hooks/useAgentRun.ts` | 前端 reconnect hook | ~280 |
| `src/app/api/agent/route.ts` | Agent API（双写集成） | ~240 |
| `src/app/api/agent/abort/route.ts` | Abort API | ~35 |
| `src/components/Editor.tsx` | Editor（callback factory 调用点） | ~3500 |

### DB Schema

```sql
-- agent_runs: 每次 agent 调用的追踪
agent_runs (
  id uuid PK,
  project_id uuid FK,
  user_id uuid FK,
  status text,  -- running | completed | failed | aborted
  prompt text,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb  -- { locale, preferredModel, firstMessageId, ... }
)

-- agent_events: 每个 SSE event 的完整记录
agent_events (
  id uuid PK,
  run_id uuid FK (nullable),  -- null = user events
  project_id uuid FK,          -- 直接关联项目
  type text,
  data jsonb,
  seq integer,
  created_at timestamptz
)
```

### Event Types

**Agent events（DualWriter 写）**：
| type | data | 说明 |
|------|------|------|
| content | `{ text }` | 每个 token delta（1:1 SSE） |
| new_turn | `{ messageId }` | 新 assistant 消息 |
| image | `{ snapshotId, imageUrl, usedModel }` | 生成图片（已上传 Storage） |
| render | `{ code, width, height, props, animation, snapshotId, published }` | Design 输出 |
| tool_call | `{ tool, input }` | 工具调用（code 截断 2000 字符） |
| code_stream | `{ text, done }` | run_code 代码流式 |
| status | `{ text }` | 状态更新 |
| reasoning | `{ text }` | 思考过程 |
| coding | `{}` | 编码中心跳 |
| done | `{}` | 完成 |
| error | `{ message }` | 错误 |
| image_analyzed | `{ imageIndex }` | 分析完成 |
| nsfw_detected | `{}` | NSFW 标记 |
| animation_task | `{ taskId, prompt }` | 视频任务 |
| preview_frame_captured | `{ workspaceUrl }` | 截帧 |

**User events（projectEventLogger 写）**：
| type | data | 说明 |
|------|------|------|
| user_message | `{ messageId, content, hasImage }` | 用户发消息 |
| image_upload | `{ snapshotId, imageUrl, isOriginal }` | 图片上传 |
| tip_committed | `{ snapshotId, tipIndex, newSnapshotId, imageUrl }` | 接受 tip |
| project_named | `{ title }` | 项目命名 |

**尚未实现的 user events**：
| type | 说明 | 优先级 |
|------|------|--------|
| tips_generated | tips 生成完成 | P1 |
| video_completed | 视频渲染完成 | P2 |
| description_set | 描述更新 | P2 |
| tip_preview | tip 预览生成 | P3 |

## 下一步：Agent 完全后端化

### 目标

Agent 不再依赖前端 SSE 连接。可以被 Claude Code、MCP、API 等任何客户端触发。前端变成纯"观察者"——通过 Replay Engine 或 Polling 获取结果。

### 当前依赖前端的部分

1. **SSE 连接**：`/api/agent` 用 ReadableStream SSE。客户端 `streamAgent()` fetch + reader。
   - 后端化方案：改为 fire-and-forget。`POST /api/agent` 创建 run → 立即返回 `{ runId }`。Agent 在后台执行，结果全写 DB。

2. **前端回调**：`makeAgentCallbacks` 把 events 转为 React state 变更。
   - 后端化方案：所有状态变更通过 `agent_events` 传递。前端用 `ReplayEngine.buildState()` 或 polling 读取。

3. **Image upload**：用户选图 → 前端压缩 → 上传 Storage → 传 base64 给 agent。
   - 后端化方案：先上传到 Storage 获取 URL，然后传 URL 给后端 agent。

4. **Design 渲染**：Remotion 在浏览器渲染（`renderStillOnWeb`）。
   - 后端化方案：服务端 Remotion（`@remotion/renderer`）或 Remotion Lambda。

5. **Tips 生成**：`/api/tips` 由前端直接调用（不经过 agent）。
   - 后端化方案：agent 自己调 tips API，或作为 tool。

### 建议架构

```
External Client (Claude Code / MCP / API)
    │
    ├── POST /api/agent/run  { projectId, prompt, image? }
    │   → 创建 agent_run → 返回 { runId }
    │   → 后台执行 agent（不需要 SSE）
    │
    ├── GET /api/agent/run/:id/status
    │   → { status, eventCount }
    │
    ├── GET /api/agent/run/:id/events?after=seq
    │   → [events...] (polling)
    │
    ├── POST /api/agent/run/:id/abort
    │   → 标记 aborted
    │
    └── GET /api/project/:id/state
        → ReplayEngine.buildState(events) → ProjectState

Frontend (React)
    └── 纯观察者
        ├── 首次加载：GET /api/project/:id/state
        ├── 实时更新：polling /api/agent/run/:id/events
        └── 渲染：Editor 接收 ProjectState
```

### 关键改动

1. **分离 agent 执行与 SSE**：
   - 当前：`for await (event of runMakaronAgent()) { writer.processAndEnqueue(event) }`
   - 目标：`for await (event of runMakaronAgent()) { writer.writeToDb(event) }`（无 SSE）
   - DualWriter 已经有所有写 DB 的逻辑，只需要去掉 `tryEnqueue`（SSE 部分）

2. **前端从 "SSE consumer" 变为 "event poller"**：
   - 当前：`streamAgent()` → SSE → callbacks → React state
   - 目标：`pollEvents()` → events → `dispatchEvent()` → React state
   - `useAgentRun` 的 polling 机制已经实现了这个模式（每 2 秒 catch up events）

3. **`makeAgentCallbacks` 保留**：
   - 它已经是纯函数（events → state mutations），不依赖 SSE
   - polling 路径用它 dispatch events，跟 SSE 路径一样

4. **Design 渲染后端化**：
   - 最大的挑战。当前 Remotion 在浏览器跑。
   - 方案 A：Remotion Lambda（AWS）
   - 方案 B：`@remotion/renderer` 在 ECS/EC2
   - 方案 C：保持前端渲染，后端只存 design code，前端加载后渲染

### 分期建议

**Phase 1：Fire-and-forget API**
- 新 endpoint `POST /api/agent/run` — 创建 run，后台执行，立即返回 runId
- 前端改为：发消息 → POST run → polling events（已有基础）
- 保留 SSE 作为 optional 快速通道（前端可选择 SSE 或 polling）

**Phase 2：External agent API**
- API key 认证（已有 `api_keys` 表）
- `POST /api/v1/agent/run` — 外部调用
- `GET /api/v1/project/:id/state` — 获取完整项目状态
- Claude Code / MCP 通过这些 API 与 Makaron 交互

**Phase 3：服务端渲染**
- Design poster 服务端生成（Remotion Lambda 或 headless Chrome）
- Tips 集成到 agent workflow（不再需要独立 /api/tips）
- 完全不依赖浏览器

## Worktree 分支状态

分支：`worktree-background-agent-replay`
路径：`/Users/tianyicai/ai-image-editor/.claude/worktrees/background-agent-replay`

**未合入 dev 的 commits**（Phase 1-4 + fixes）：
```
a9a7554 fix: auto-create message for runs without initial new_turn
cf1069c fix: restore editPrompt from tool_call events in buildState
e2e33b2 fix: buildState handles parallel runs + pagination beyond 1000
e7dff53 feat: log image_upload events on initial photo upload
dc9bc2d feat: page.tsx tries ReplayEngine.buildState before loadProject
1c0e00e feat: ReplayEngine.buildState — instant project state from events
bceae9b feat: project event logger + user action events for Replay
4f46b5e feat: DualWriter stores ALL SSE events 1:1 (Replay fidelity)
f4fdd2a fix: reconnect — keep user messages + polling-driven catch-up
```

**已合入 dev 的 commits**（background agent 核心）：
```
f983409 ... (dev HEAD)
├── abort API + robust Realtime
├── makeAgentCallbacks factory + 88 tests
├── DualWriter + shared IDs
├── agent_runs + agent_events tables
└── all reconnect fixes
```

## 测试

### 单元测试
```bash
npx vitest run  # 88 tests (worktree) / 73 tests (dev)
```

### E2E 验证（手动）
1. 新建项目 → 上传图片 → 发消息 → agent 生图 → 刷新 → 数据完整
2. 发消息 → 刷新（agent 还在跑）→ reconnect → CUI 继续流式
3. Abort → agent 停止 → 可以发新消息
4. Design video → 刷新 → Remotion Player 加载

### 关键测试项目
- `f1d5acf6-6786-4202-b7df-8415722df621`：3 张图 + 多轮对话 + design video（2894+ events）
- `adaa7dc6-a4bb-411b-8ed0-c8e1d5ee7f16`：长期测试项目（fireworks, snow, stories, design）
