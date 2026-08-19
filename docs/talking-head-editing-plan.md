# Makaron 口播剪辑：Skill + Tool 方案

状态：方案草案，尚未实现  
分支：`codex/talking-head-editing`  
基线：`dev@73724a7f`

> 2026-08-19 真实试剪修订：15 分钟阶段不新增本方案原先设想的四个
> transcript/edit-plan tool。先复用现有 `transcribe_audio`、`run_code`、
> `write_file`、`preview_frame`、`materialize_media`，并把 `talking-head`
> 作为 `video-ffmpeg-lab`、`content-repurpose`、`tiktok-video` 的编排层。
> 完整 transcript 通过 workspace artifact 补足模型输出截断。下文的四
> tool 设计仅保留为未来 1–2 小时、异步/分页场景的候选架构，不是当前实现。

## 1. 结论

这一版不做传统剪辑器，也不做一套新的复杂 GUI。产品入口继续是 Makaron CUI：用户放入一条 1–2 小时的口播素材，然后用自然语言完成三类任务：

1. 按 ASR 文本删口误、重复、废话和不需要的段落；
2. 在某句话或某个话题上插入图片 / 视频 B-roll；
3. 从长视频中找出最值得传播的金句，生成一个或多个短片。

建议只新增一个 canonical skill：`talking-head-edit`，内部包含 `rough-cut`、`b-roll`、`highlights` 三种模式；再新增四个原子 tool：

- `prepare_transcript`
- `read_transcript`
- `write_edit_plan`
- `render_edit_plan`

现有 `talking-head`、`content-repurpose`、`clip-factory`、`podcast-repurpose` 不再各自发展一套实现，而是作为入口或 adapter，最终转入同一个 canonical skill。

## 2. 为什么不能只改 SKILL.md

当前 `dev` 的视频创建接口仍限制最长 120 秒；现有 `transcribe_audio` 也会在处理普通视频 URL 时先下载完整视频，并把完整 word-level transcript 放进 `snapshot.video_meta` 和 Agent tool result。

对于 1–2 小时素材，这里有四个结构性问题：

- 原视频可能是数 GB，不能经过 Vercel request body，也不应为了 ASR 整体下载进 serverless 内存；
- ASR 只需要音频，不应把视频文件发送给 ASR provider；
- 两小时 word-level transcript 不适合直接塞入 JSONB 和 Agent 上下文；
- 一次长任务失败后不能整条重跑，必须支持分片重试和断点续跑。

因此，“只做 skill + tool”可以成立，但 tool 底下仍需要 Source Adapter、后台 ASR job、Transcript Artifact 和确定性 renderer。它们是 tool 的执行层，不是新的编辑 UI。

## 3. 用户体验

### 3.1 长口播粗剪

用户：

> 把重复表达和明显口误去掉，节奏紧一点，但不要改变我的观点。

Agent：

1. 调 `prepare_transcript` 建立语音索引；
2. 用 `read_transcript` 分章节读取，而不是读取整份转录；
3. 给出一份简短的删除建议（原时长、预计成片时长、主要删除类型）；
4. 用户确认后调用 `write_edit_plan`；
5. `render_edit_plan` 生成可编辑 Remotion 草稿；
6. 复核后使用现有 `materialize_media` 导出 MP4。

### 3.2 加 B-roll

用户：

> 讲到“第一次创业失败”时放这张旧办公室照片；讲到增长数据时放这段录屏。

Agent 用转录中的稳定 word-id 找到两句话，把图片和视频作为 visual overlay 写入同一份 Edit Plan。B-roll 视频默认静音，原口播音频连续播放。

### 3.3 剪金句

用户：

> 从这期一小时访谈里找 5 个最值得发的金句，每条 30–60 秒。

Agent 先读 transcript outline，再分章节做候选提取和全局排序。候选必须能脱离原视频独立成立，起止不能截断句子。选定后，每个候选都成为同一 Edit Plan 中的一个 deliverable；renderer 批量生成可编辑短片。

## 4. 总体架构

```mermaid
flowchart LR
  A[Local / URL / Cloud source] --> B[Source Adapter]
  B --> C[FFmpeg: audio only\n16 kHz mono]
  C --> D[Chunked ASR job]
  D --> E[Transcript Artifact\nword ids + timestamps + outline]
  E --> F[Talking-head-edit Skill]
  F --> G[Edit Plan\ncuts + B-roll + deliverables]
  G --> H[Deterministic Remotion renderer]
  H --> I[Editable preview]
  I --> J[Materialized MP4]
```

关键边界：

- 原视频始终由 Source Adapter 管理；ASR provider 只收到抽出的音频；
- Agent 只看到 outline 和按需读取的 transcript window，不看到两小时全文；
- Agent 只写结构化 Edit Plan，不手写几千行 JSX / FFmpeg 命令；
- renderer 根据 Edit Plan 生成标准化、可编辑、可重复渲染的 Remotion composition。

## 5. 长素材如何“放进来”

统一定义 `SourceHandle`，屏蔽素材到底在本机、对象存储还是远程 URL：

```ts
type SourceHandle = {
  sourceId: string
  kind: 'local' | 'cloud' | 'remote'
  uri: string
  durationMs: number
  width: number
  height: number
  audioStreams: number
  fingerprint: string
  seekable: boolean
}
```

推荐分两条接入路径：

### P0：Local-first / URL-first

- 本地素材只注册路径和 fingerprint，不复制、不上传原文件；
- 通过 loopback Range endpoint 为浏览器预览提供 `206 Partial Content`；
- Agent、FFmpeg、Remotion 本地 renderer 都引用同一个 SourceHandle；
- 远程可 seek URL 直接注册，不经过 Vercel body。

仓库已有未合入 `dev` 的 local-media 分支，可作为实现样本；实施时应先 rebase 到本 worktree 并逐项做内容级审查，不能直接把旧分支当成已完成能力。

### P1：Cloud resumable source

- Web 用户需要跨设备时，浏览器直接使用 multipart / TUS 上传到对象存储；
- Vercel 只签发上传会话和写入 metadata，不中转视频 body；
- 上传完成后得到同样的 SourceHandle；
- 原视频可设置“仅项目可见”和生命周期策略，但本版本不自动删除源文件。

P0 能最快解决 1–2 小时素材；P1 解决跨设备和云端后台执行。两者上层 tool contract 完全一致。

## 6. ASR Pipeline

### 6.1 音频抽取

对视频执行一次 FFmpeg 音频抽取：

```text
-map 0:a:0 -vn -ac 1 -ar 16000 -b:a 48k/64k
```

不把原视频传给 ASR。对于本地源，直接从本地文件抽取；对于 cloud / remote 源，由 worker 读取 seekable source。不得在失败后 fallback 成“把完整视频 base64 发给 provider”。

### 6.2 分片与重试

- 默认 20 分钟一片，前后保留约 2 秒 overlap；
- 每片独立 job、独立 retry，成功片段不重做；
- 合并时加上 chunk offset，并对 overlap 里的重复 words 去重；
- 最终校验 timestamps 单调、无负值、无跨片重复句；
- 1–2 小时只是首版验收上限，不把上限写死在 skill 里。

### 6.3 Transcript Artifact

长 transcript 不再内嵌进 `snapshot.video_meta`。建议存到 workspace / object storage：

```text
{projectId}/transcripts/{sourceId}/transcript-v1.json
{projectId}/transcripts/{sourceId}/outline-v1.json
```

`video_meta` 只保留指针和轻量状态：

```ts
type TranscriptRef = {
  transcriptId: string
  status: 'queued' | 'extracting' | 'transcribing' | 'indexing' | 'ready' | 'failed'
  artifactPath?: string
  outlinePath?: string
  language?: string
  durationMs?: number
  utteranceCount?: number
  wordCount?: number
  completedChunks?: number
  totalChunks?: number
  error?: string
}
```

每个 word / utterance 生成稳定 ID，例如 `c03-u018-w007`。后续剪辑锚定 ID，而不是让 Agent 猜秒数。

```ts
type TranscriptWord = {
  id: string
  text: string
  startMs: number
  endMs: number
  confidence?: number
  speaker?: string
}
```

## 7. 四个 Tool

### 7.1 `prepare_transcript`

职责：对长视频建立或复用 transcript index。

```ts
prepare_transcript({
  media_index: number,
  language?: string,
  force_refresh?: boolean
}) -> {
  transcript_id: string,
  status: string,
  progress: { completed: number, total: number },
  duration_ms?: number,
  outline?: TranscriptChapter[]
}
```

行为：

- cache key 使用 source fingerprint + language + ASR version；
- 短素材可同步返回，长素材进入后台 job；
- 重复调用只返回当前状态，不创建重复任务；
- tool progress 可以映射到现有 CUI background status。

现有 `transcribe_audio` 保留，继续服务短音频、配音验词和 narration cue；底层可以复用同一 ASR client，但不要在首版破坏它已有的同步返回 contract。

### 7.2 `read_transcript`

职责：让 Agent 有界地读取长 transcript，同时承担 status 查询。

```ts
read_transcript({
  transcript_id: string,
  mode: 'status' | 'outline' | 'range' | 'search',
  start_ms?: number,
  end_ms?: number,
  query?: string,
  cursor?: string,
  limit?: number,
  include_words?: boolean
}) -> {
  status: string,
  chapters?: TranscriptChapter[],
  utterances?: TranscriptUtterance[],
  next_cursor?: string
}
```

硬限制：一次最多返回固定数量 utterances / chars；Agent 必须分页。`search` 返回命中句及前后上下文，不返回全文。

### 7.3 `write_edit_plan`

职责：验证并持久化非破坏性剪辑决策。

```ts
write_edit_plan({
  source_media_index: number,
  transcript_id: string,
  title: string,
  cuts?: Array<{
    from_word_id: string,
    to_word_id: string,
    reason: 'mistake' | 'repeat' | 'filler' | 'content' | 'custom'
  }>,
  broll?: Array<{
    media_index: number,
    from_word_id: string,
    to_word_id: string,
    presentation: 'replace_visual' | 'overlay' | 'picture_in_picture',
    keep_source_audio?: boolean,
    fit?: 'cover' | 'contain'
  }>,
  deliverables?: Array<{
    id: string,
    title: string,
    from_word_id: string,
    to_word_id: string,
    aspect_ratio?: 'source' | '16:9' | '9:16' | '1:1'
  }>
}) -> {
  edit_plan_id: string,
  artifact_path: string,
  source_duration_ms: number,
  estimated_output_duration_ms: number,
  warnings: string[]
}
```

验证规则：

- 所有 word-id 必须属于同一 transcript；
- cut / deliverable 起止自动扩到干净的 utterance 边界，并保留可配置 audio handle；
- 禁止负时长、交叉范围、越界 B-roll；
- B-roll 默认 `keep_source_audio=true`；视频 B-roll 默认静音；
- edit plan 每次修改产生 revision，允许回退和比较。

### 7.4 `render_edit_plan`

职责：把 Edit Plan 编译为标准 Remotion composition，而不是让 Agent 自由手写 JSX。

```ts
render_edit_plan({
  edit_plan_id: string,
  deliverable_ids?: string[],
  mode: 'draft' | 'materialize'
}) -> {
  status: 'ready' | 'processing' | 'failed',
  snapshot_ids?: string[],
  design_paths?: string[],
  job_ids?: string[]
}
```

`draft` 只生成可编辑 composition；`materialize` 可复用现有 Remotion export / `materialize_media`。首版建议 Agent 默认先 draft、QA 后再导出。

## 8. Edit Plan v1

```ts
type TalkingHeadEditPlanV1 = {
  version: 1
  source: SourceHandle
  transcript: TranscriptRef
  revision: number
  cuts: TranscriptAnchoredCut[]
  broll: TranscriptAnchoredBroll[]
  deliverables: TranscriptAnchoredDeliverable[]
  resolved: {
    keptSourceRanges: Array<{ startMs: number; endMs: number }>
    timelineMap: Array<{
      sourceStartMs: number
      sourceEndMs: number
      outputStartMs: number
      outputEndMs: number
    }>
  }
}
```

`resolved.timelineMap` 是关键：删除任何前文后，B-roll 和字幕都通过 word-id 重新映射到新的 output time，不会因为“前面又删了 20 秒”而整体漂移。

## 9. Skill：`talking-head-edit`

### 9.1 模式

- `rough-cut`：去口误、重复、填充词、无价值岔题；
- `b-roll`：按语义为已有段落添加图片或视频；
- `highlights`：从长内容中选出多个独立成立的短片；
- 三种模式可以在同一 Edit Plan 中组合，不新建互相竞争的 skill。

### 9.2 编辑原则

- source speech 是事实来源，不能为了“更像金句”改写说话者原意；
- 默认保守删除：不确定的内容保留，并在 proposal 中标记；
- 粗剪优先删完整语义单元，不在字中间硬切；
- B-roll 用来解释名词、展示证据或覆盖必要 jump cut，不能无意义铺满；
- 情绪和个人表达最强的句子优先保留人脸，不用 B-roll 盖住；
- 所有修改先写 proposal，再写 Edit Plan；只有用户明确要求“直接剪”时可跳过确认。

### 9.3 金句排序

每个候选记录以下分数和理由：

- opening hook：开头是否立即抓人；
- standalone context：脱离原视频是否能理解；
- insight / emotion：是否有明确观点、反直觉、方法或情绪；
- information density：是否少铺垫、有 payoff；
- clean boundary：是否有自然开头和收尾。

硬规则：

- 不从半句话开始，不在结论前结束；
- 不靠标题补足缺失上下文；
- 候选之间不能只是同一句话的轻微重叠版本；
- 用户未指定时，首版默认建议 20–90 秒，而不是写死一种平台长度；
- 排名前的候选用 `preview_frame` 查看开头 / 中间 / 结尾代表帧，排除明显不可用画面；视觉检查只看小量帧，不做整视频视觉上传。

## 10. B-roll 规则

B-roll 来源可以是：

- 当前 Timeline / Media Index 中的用户图片或视频；
- 用户随后上传的素材；
- Agent 调 `generate_image` 生成的图片；
- Agent 调现有视频生成 tool 得到的短视频；
- 后续接 Scene 搜索，但不作为首版依赖。

首版确定性行为：

- 图片默认轻微 Ken Burns，时长跟随 transcript anchor；
- 视频默认静音，并保留主口播音轨；
- `replace_visual` 全屏覆盖主画面，`overlay` 保留主画面，`picture_in_picture` 为画中画；
- B-roll 出入点吸附到词 / 句边界；
- 原素材被删时，相应 B-roll 自动删除或返回 orphan warning，绝不漂移到另一句话上。

## 11. 不做什么

首版明确不做：

- 多机位同步、复杂音频混音和 DAW；
- 传统可拖拽多轨编辑器；
- 逐字 transcript GUI；
- 自动生成海量 B-roll；
- 一开始就做自动人脸追踪式 9:16 reframe；
- 把 1–2 小时视频发给视频理解模型；
- 用通用 `run_code` 让 Agent 每次临时发明一套剪辑实现。

现有 Timeline 仍用于预览、选择结果和必要的微调；CUI 是主入口，Edit Plan 是 source of truth。

## 12. 实施顺序

### Milestone A：长素材与 Transcript Index

- SourceHandle + local / remote source adapter；
- `prepare_transcript` / `read_transcript`；
- FFmpeg audio-only 分片、ASR 合并、artifact 存储；
- transcript job progress、cache 和 retry；
- 保持短音频 `transcribe_audio` contract 不变。

完成标准：2 小时素材可注册；原视频不进入 ASR payload；Agent 能按 outline / range / search 有界读取全文。

### Milestone B：文字粗剪 + B-roll

- Edit Plan schema / validator / revision；
- `write_edit_plan`；
- 标准 talking-head Remotion compiler；
- 图片 / 视频 B-roll；
- `render_edit_plan(draft)` 和 preview QA。

完成标准：通过对话删除指定句子、加入两种 B-roll；刷新后草稿仍可编辑；原口播音频连续。

### Milestone C：金句批量输出

- skill 的章节级候选抽取与全局排序；
- deliverables batch；
- 候选帧 QA；
- 批量 materialize 与结果命名。

完成标准：从一小时素材中给出有理由、有时间范围、互不重复的候选，并生成至少 5 条可解码 MP4。

### Milestone D：Cloud resumable（如果首发必须跨设备）

- browser direct multipart / TUS；
- 云端 SourceHandle；
- worker source cache；
- 上传中断续传和跨设备恢复。

## 13. 验收门槛

### 长素材

- 真实 1 小时和 2 小时 MP4 各一条；
- 本地注册不复制原视频，远程 / cloud source 不经过 Vercel body；
- 音频抽取、分片、失败片重试、时间码合并都有自动化测试；
- transcript 不被完整写进 Agent prompt 或 tool history。

### 粗剪

- 指定删除 10 处话语，导出后逐处听检；
- 输出时长与 resolved ranges 计算一致；
- `ffprobe`、整条 FFmpeg decode、音轨存在性通过；
- 预览和导出 source range 一致。

### B-roll

- 一张图 + 一条视频；
- 视频 B-roll 静音、主口播不断；
- 在前文继续删减后，B-roll 仍锚定原句；
- 被删原句的 B-roll 不会漂移。

### 金句

- 每条开头 / 结尾是完整语义；
- 逐条 ASR 回读，与原话一致；
- 候选无近重复；
- 实际下载 MP4 后完成 `ffprobe` 和全帧 decode。

## 14. 最小首发建议

建议首发只承诺：

- 单主讲人、单主视频；
- 最长 2 小时；
- 中文 / 英文 / 日文沿用现有 ASR 语言路由；
- 按文本粗剪；
- 图片 / 视频 B-roll；
- 一次生成 1 个 master 或最多 10 个 highlight clips；
- editable Remotion draft + MP4；
- 本地 source 和 seekable URL 优先，cloud resumable 视首发设备范围决定是否同批完成。

这是一个足够清晰、能验证价值的剪辑版本。最重要的产品判断不是“时间线够不够专业”，而是用户能否把两小时素材交给 Makaron，只通过几轮对话拿到可信、可追溯、可继续修改的初剪和金句包。
