# Handoff: 后台 Agent（用户退出后继续运行）

## 背景

当前 agent 完全依赖前端 SSE 连接。用户关浏览器 → fetch 中断 → Vercel 杀掉函数 → 消息丢失。用户重进页面看不到 agent 正在做或已做完的事。

**目标**：用户关掉页面后 agent 继续运行，用户回来能看到结果。

**架构原理**：客户端断开后，Vercel 函数继续跑（最多 maxDuration=300s），直接写 DB。浏览器变成"观察者"而非"必要环节"。

```
正常时：  Agent → SSE stream → 浏览器
                → DB（同时写）

浏览器关了：Agent → DB（继续写，SSE enqueue 失败就忽略）

用户回来：  前端 → 从 DB 读取 agent_events → 回放
```

## 现状分析

### 当前消息持久化流程
- 消息**只在前端 `onDone` 回调里存 DB**（`Editor.tsx` line ~1582）
- `onSaveMessage` → `useProject.saveMessage()` → `supabase.from('messages').upsert()`
- 用户关浏览器 → `onDone` 不触发 → 所有内容丢失

### 当前 SSE 流程
- 前端 `streamAgent()`（`src/lib/agentStream.ts`）用 `fetch` + `AbortController`
- API route（`src/app/api/agent/route.ts`）用 `ReadableStream` + `controller.enqueue()`
- 客户端断开 → AbortController abort → 函数可能被 Vercel kill

### 关键文件
| 文件 | 作用 |
|------|------|
| `src/lib/agentStream.ts` | 前端 SSE 消费（fetch + reader） |
| `src/app/api/agent/route.ts` | API route，ReadableStream，maxDuration=300 |
| `src/lib/agent.ts` | Agent 核心，async generator yielding events |
| `src/components/Editor.tsx` | 前端状态管理，onDone 存 DB |
| `src/hooks/useProject.ts` | saveMessage/saveSnapshot 持久化 |

### Supabase Realtime
当前项目**未使用** Supabase Realtime。需要启用。

### 老数据
`agent_runs` 和 `agent_events` 是**新增表**，不改任何现有表。老的 `messages` 表保持不变，历史消息照常加载。方案是加法不是改法。

## 两个层面

### 层面 1：数据不丢（服务端实时持久化）

- 创建 `agent_runs` 表：追踪每次 agent 调用
- 创建 `agent_events` 表：存储每个 SSE 事件
- `/api/agent` route 双写：SSE stream + DB
- 前端重连时从 DB 回放

### 层面 2：函数不死（服务端长驻）

**推荐方案 A：Vercel `after()` + maxDuration 兜底**
- SSE enqueue 失败时 catch 住，继续跑 agent，只写 DB
- `after()` 确保最终 cleanup（标记 run 完成）
- 300s 硬上限，但当前 agent 大部分 turn < 60s，覆盖 90%+ 场景

**未来方案 B：独立 Worker**（如需超 300s）
- Agent 执行移到 AWS Lambda (15min) / ECS / fly.io
- `/api/agent` 只创建 run → 返回 runId
- 代价：额外基础设施

## 实现步骤

### Step 1: DB 迁移 — `agent_runs` + `agent_events` 表

```sql
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  user_id uuid references auth.users(id),
  status text default 'running', -- running, completed, failed
  prompt text,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table agent_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id),
  type text not null, -- content, image, design, tool_call, done, error
  data jsonb,
  seq integer not null,
  created_at timestamptz default now()
);

-- Index for fast replay
create index idx_agent_events_run_seq on agent_events(run_id, seq);

-- RLS
alter table agent_runs enable row level security;
create policy "Users see own runs" on agent_runs for select using (user_id = auth.uid());
create policy "Users insert own runs" on agent_runs for insert with check (user_id = auth.uid());
create policy "Users update own runs" on agent_runs for update using (user_id = auth.uid());

alter table agent_events enable row level security;
create policy "Users see own events" on agent_events for select 
  using (run_id in (select id from agent_runs where user_id = auth.uid()));
create policy "System insert events" on agent_events for insert 
  with check (run_id in (select id from agent_runs where user_id = auth.uid()));

-- Realtime
alter publication supabase_realtime add table agent_events;
```

### Step 2: `/api/agent` route — 双写（SSE + DB）

**文件**: `src/app/api/agent/route.ts`

改动要点：
1. 开始时创建 `agent_runs` 记录
2. stream 循环里双写：SSE enqueue（try/catch）+ DB insert
3. content 事件高频（每个 token），需要**批量处理**：累积 500ms 或 50 chars 合并成一条 DB 写入
4. image/design/tool_call/done/error 等关键事件**立即写**
5. 用 `after()` 标记 run 完成

```typescript
// 伪代码
const { data: run } = await supabase.from('agent_runs').insert({
  project_id: projectId, user_id: user.id, status: 'running', prompt
}).select().single();

let seq = 0;
let contentBuffer = '';
let contentFlushTimer: NodeJS.Timeout | null = null;

const flushContent = async () => {
  if (!contentBuffer) return;
  await supabase.from('agent_events').insert({
    run_id: run.id, type: 'content', data: { text: contentBuffer }, seq: seq++
  });
  contentBuffer = '';
};

for await (const event of runMakaronAgent(...)) {
  // SSE（可能失败）
  try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch {}
  
  // DB
  if (event.type === 'content') {
    contentBuffer += event.text;
    if (!contentFlushTimer) {
      contentFlushTimer = setTimeout(async () => {
        contentFlushTimer = null;
        await flushContent();
      }, 500);
    }
  } else if (['image', 'design', 'tool_call', 'done', 'error', 'new_turn'].includes(event.type)) {
    await flushContent(); // flush pending content first
    await supabase.from('agent_events').insert({
      run_id: run.id, type: event.type, data: event, seq: seq++
    });
  }
}

after(async () => {
  await flushContent();
  await supabase.from('agent_runs').update({ 
    status: 'completed', ended_at: new Date().toISOString() 
  }).eq('id', run.id);
});
```

### Step 3: 前端重连 — 读取 agent_events 回放

**文件**: `src/hooks/useProject.ts` 或新建 `src/hooks/useAgentRun.ts`

页面加载时：
```typescript
// 查最近活跃的 run
const { data: activeRun } = await supabase
  .from('agent_runs')
  .select('id, status')
  .eq('project_id', projectId)
  .eq('status', 'running')
  .order('started_at', { ascending: false })
  .limit(1)
  .single();

if (activeRun) {
  // 回放所有事件
  const { data: events } = await supabase
    .from('agent_events')
    .select('*')
    .eq('run_id', activeRun.id)
    .order('seq');
  
  replayEvents(events); // 重建 messages/snapshots 状态
  
  // 监听新事件（Supabase Realtime）
  supabase.channel(`run:${activeRun.id}`)
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'agent_events', 
      filter: `run_id=eq.${activeRun.id}` 
    }, (payload) => handleNewEvent(payload.new))
    .subscribe();
}
```

### Step 4: Supabase Realtime 启用

- Supabase Dashboard → Database → Publications → 添加 `agent_events`
- 或在迁移 SQL 里：`alter publication supabase_realtime add table agent_events;`

## 注意事项

- **content 批量写**：每个 token 一次 DB write 会严重拖慢 agent 响应。必须累积（500ms 或 50 chars）
- **前端 onSaveMessage 暂时保留**：双保险，等 agent_events 稳定后再移除
- **回放复杂度**：image/design 事件需要重建 snapshot 状态，不只是文本
- **Vercel Pro 限制**：maxDuration=300s。大部分 turn < 60s 够用。音乐轮询（2-3 min）也在范围内
- **Realtime 延迟**：Supabase Realtime 通常 100-500ms，可接受
- **老数据零影响**：新增表，不改现有 messages/snapshots 表

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `supabase/migrations/xxx_agent_runs.sql` | 新建 | agent_runs + agent_events 表 + RLS + Realtime |
| `src/app/api/agent/route.ts` | 修改 | 创建 run 记录 + 双写 SSE/DB + content 批量 + after() |
| `src/hooks/useAgentRun.ts` | 新建 | 查活跃 run + 回放 events + Realtime 订阅 |
| `src/components/Editor.tsx` | 修改 | 集成 useAgentRun，支持从 DB 回放重建状态 |

## 验证

1. 打开项目，发消息给 agent
2. Agent 开始回复时**关闭浏览器**
3. 等 30 秒，重新打开项目页面
4. 应看到 agent 之前的回复（从 DB 回放）
5. 如果 agent 还在运行，应看到**实时更新**（Realtime 推送）
6. Agent 完成后，状态正确标记为 completed
