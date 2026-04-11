# Handoff: Music GUI — MusicPicker + Remotion 编辑集成

## 背景

音乐配乐 v2 已完成 CUI 路径和后端基础设施。用户可以在 CUI 里让 Agent 生成配乐，看到 MusicCard 试听和选择。现在需要 GUI 侧的入口和展示。

## 已完成（可直接复用）

### 后端
- `project_music` 表（Supabase）：id, project_id, suno_task_id, track_index, audio_url, duration, title, tags, status, selected
- `/api/music` POST — 创建 Suno 任务
- `/api/music/[taskId]` GET — 查状态 + 自动持久化到 DB（传 `?projectId=xxx`）
- `/api/music/select` POST — 标记选中的 track
- `src/lib/sunoapi.ts` — FIRST_SUCCESS (~85s) 提前返回第一首，不等第二首

### Agent
- `generate_music` tool — Agent 分析内容写 prompt，调 Suno
- `music_task` SSE 事件 → 前端收到后开始 polling

### CUI
- `Editor.tsx`: musicTaskId state + polling useEffect（10s 间隔）
- `AgentChatView.tsx`: MusicCard 组件（播放/暂停 + 标题时长 + Insert 按钮）
- Message.musicTracks 字段承载 track 数据

### 注入
- 用户点 Insert → 发 agent 请求 → Agent 用 run_code 读 design + 加 `<Audio>` → 重渲染

## GUI 需要做的

### 1. 🎵 按钮入口
- **位置**：animated design（有 duration）的播放控件附近
- **触发**：点击后直接调 `/api/music` POST（自动写 prompt，基于当前 design 内容）
- **状态**：生成中显示 loading spinner / 进度

### 2. MusicPicker 组件
- **位置**：Design 下方 inline（类似 TipsBar 的位置）
- **内容**：
  - 每首歌：标题 + 时长 + 播放/暂停按钮 + 选择按钮
  - 最多 2 首（Suno 每次返回 2 首）
  - 选中时 fuchsia border 高亮（和 TipsBar 一致）
- **交互**：
  - 选择后调 `/api/music/select` 标记 DB
  - 然后发 agent 请求注入 `<Audio>`（复用 CUI 的 handleMusicSelect 逻辑）

### 3. 和 Remotion 编辑功能集成
- MusicPicker 是 Remotion design 的编辑功能之一，和文字修改、控件位置修改等统一设计
- 已有音乐的 design 应该显示当前选中的曲名（从 `project_music` where selected=true 查）
- 切换音乐 = 重新选择 + 重新注入

### 4. 已有音乐恢复
- `loadProject` 时查 `project_music` where project_id=xxx and status=completed
- 有数据时 GUI 显示已有的音乐信息（不需要重新生成）

## 数据流

```
GUI 🎵 按钮 → POST /api/music → taskId
              → Editor.tsx setMusicTaskId → polling useEffect
              → GET /api/music/[taskId]?projectId=xxx
              → completed → setMusicTracks → MusicPicker 展示
              → 用户选择 → POST /api/music/select + agent 注入
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/types/index.ts` | Message.musicTracks 类型定义 |
| `src/components/Editor.tsx` | musicTaskId, musicTracks state, polling, handleMusicSelect |
| `src/components/AgentChatView.tsx` | MusicCard 组件（可复用样式） |
| `src/lib/skills/get-music-status.ts` | MusicTrack 接口定义 |
| `src/app/api/music/` | 所有 API 端点 |
