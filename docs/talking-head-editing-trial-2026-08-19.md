# 口播剪辑真实试验：2026-08-19

## 样本

| Source | Duration | Size | Video | Audio |
| --- | ---: | ---: | --- | --- |
| `1633675047865481.mp4` | 339.42s | 23.2MB | H.264 640×368, 19fps | AAC 44.1kHz stereo |
| `1634266168734682.mp4` | 534.82s | 34.3MB | H.264 640×368, 17fps | AAC 44.1kHz stereo |

两条视频都超过旧的 120 秒上限，但低于新的 900 秒上限和 48MB H.264
直传阈值，因此可以验证“不做 local-first，只放宽时长”的路径。

## 基线试剪方法

这次先不增加剪辑 tool：

1. 现有 Volcengine ASR 从本地 MP4 抽取 mono 16kHz MP3；provider request
   只有 `audio.data`，没有原视频；
2. 复用 ASR 已有 `utterances[].startMs/endMs` 和
   `utterances[].words[].startMs/endMs`；
3. 只压缩大于约 0.95s 的无语音间隔，连接处各保留约 0.14s handle；
4. 第二条删除明确的现场旁白“屏蔽掉”段落；
5. 用 FFmpeg trim + concat 重新编码，随后 `ffprobe` 和完整 decode；
6. 再次用 audio-only ASR 回读成片。

## 结果

| Output | Source | Output | Removed | ASR |
| --- | ---: | ---: | ---: | --- |
| `1633675047865481-tight-cut.mp4` | 339.42s | 323.74s | 15.68s | 75 utterances, 1710 words |
| `1634266168734682-tight-cut.mp4` | 534.82s | 523.78s | 11.04s | 113 utterances, 2565 words |

- 两条 MP4 均通过 `ffprobe`、完整音视频 decode；
- 第二条成片 ASR 中不再包含被删除的现场旁白；
- 原视频已有的图标、截图、标题和字幕在代表帧中保持；
- 试剪输出仍低于 50MB Storage object limit；
- 这是一版保守的节奏收紧，不是内容重写。

### 金句试剪

另外用同一份 ASR 时间戳导出了四条独立短片：

| Clip | Duration | Boundary |
| --- | ---: | --- |
| 产品经理与“最好的艺术家抄袭” | 17.45s | 完整观点 |
| 小红点的增长心理 | 35.26s | 完整问题与结论 |
| 微信红包：300 人对 4000 人 | 86.82s | 完整案例与“四两拨千斤”结论 |
| 小程序误杀低频 App | 37.35s | 完整问题、例子与预测 |

四条均通过完整 decode 和 audio-only ASR 回读。第一次导出的“艺术家抄袭”
片段在结尾多带入了下一句的第一个“这”；根据 word timestamp 将出点从
38.20s 收回到 38.12s 后，回读结尾干净。这说明金句边界必须做逐字回读或
切点试听，不能只验证文件存在和大致时长。

## 从试验得到的产品结论

### 1. 不需要先发明新 ASR

现有 `transcribe_audio` 的行级和文字级时间戳已经足够完成粗剪和精确短句
定位。应该复用，不再创建另一套 cue/word id。

### 2. audio-only 必须成为硬约束

视频可以在 Makaron/worker 内被读取以抽音频，但 ASR provider request 只能是
音频 URL 或抽取后的音频 bytes，不能把视频作为 provider input，也不能在失败
后 fallback 到完整视频。

### 3. 当前真正的长视频阻塞是模型拿不到完整时间戳

第二条只有 8:55，却已有 112 utterances / 2582 words。现有
`formatTranscriptForModel` 只有约 24K 字符预算，后段 word timestamps 可能
被截断。解决方式是把原始 ASR JSON 写成 workspace transcript artifact，让
Agent 在需要后段时间码时读取；不重新 ASR。

### 4. 不能用“重复字检测”自动删口误

真实 transcript 同时包含 `这这`、`而而` 这类口误，也包含 `简简单单`、
`真真实实` 这类正确表达。判断必须结合 utterance 语义，不能按相邻字符相同
直接删除。

### 5. Cut-only 与 B-roll 应走两条既有执行路径

- 只有删减/拼接：复用 `video-ffmpeg-lab` 的 Node/FFmpeg 路径，快速得到 MP4；
- 有图片、视频 B-roll、字幕或品牌层：复用现有 Remotion composition，保留
  editable draft，再 materialize；
- 两条路径共享同一份 ASR source time，不共享一套新的编辑器 UI。

## B-roll 方案

B-roll 仍锚定 ASR 的 source timestamp；在前文删减后，通过 keep ranges 累计
得到 source→output map：

```text
source ASR time -> retained source range -> output composition time
```

- 图片：默认轻微 pan/scale；
- 视频：默认 muted；
- 主口播音频持续播放；
- anchor 所在原句被删除时，B-roll 成为 orphan，必须删除或提示，不能漂移；
- 具体素材优先复用 Timeline/Media Index；缺素材再生成；
- 情绪最强、最个人的句子保留讲述者画面，B-roll 优先解释产品、历史、数字、
  UI 和证据。

## 还需要补的功能

### 当前 15 分钟版本必须有

1. **完整 transcript artifact**：已实现，解决 inline timestamp 截断；
2. **切点 QA**：每个 join 前后都要预览，不能只看最终时长；
3. **B-roll orphan 检查**：剪掉 anchor 时明确报告；
4. **ASR audio-only regression test**：已实现；
5. **明确区分上传限制和模型 reference 限制**：上传可 15 分钟，不表示
   Seedance/Kling 可以一次接收 15 分钟 reference；
6. **大文件提示**：15 分钟只是 duration 上限，Web 仍有 200MB 输入和 50MB
   Storage object 限制。超过时必须给出“时长允许但文件过大”的准确提示。

### 未来 1–2 小时版本再做

1. transcript 分页/搜索，而不是一次读完整 artifact；
2. 异步 ASR job、分片失败重试和进度；
3. resumable cloud upload 或 local-first source adapter；
4. 多说话人 diarization；
5. 音频响度/语速与少量视觉帧共同辅助金句排序；
6. 自动 9:16 speaker tracking/reframe。

## 当前实现决定

- 复用并强化 `talking-head` skill；
- `talking-head` 条件读取 `video-ffmpeg-lab`、`content-repurpose`、
  `tiktok-video`；
- 保留现有 `transcribe_audio` tool 和 timestamp schema；
- 保留现有 `run_code` / Remotion / FFmpeg 执行层；
- 不合入 local-first；
- 不新增传统剪辑 GUI；
- 视频上传时长上限从 120s 调整为 900s，模型 reference 限制不变。

## 2026-08-20 Skill-first 收敛

真实新项目试剪暴露的主要成本不是缺少新 tool，而是 Agent 多轮返工：项目
边界错误、重复/慢 ASR、源视频 trim 被覆盖、漏字幕、字幕覆盖不完整，以及
多次 publish/materialize。当前路线因此收敛为现有工具上的 one-pass skill：

1. 锁定一个新项目和一个主视频；
2. 成功 ASR 一次，后续只读 transcript artifact；
3. 一次决定 keep ranges、字幕、B-roll 和品牌层；
4. 一次 `run_code` 生成完整 composition；
5. 在 publish 前机械检查 trim、字幕覆盖和 B-roll anchor；
6. `preview_frame` 一次，随后 publish 一次、materialize 一次。

目标耗时为 6–10 分钟。四个 transcript/edit-plan tool、分页 transcript、
异步分片 ASR、local-first、resumable upload、diarization、自动 reframe 和传统
时间线 GUI 均不是当前 roadmap；只有真实用户样本证明现有边界不够时才重开。
