# Google Agentic Video Understanding 对 Makaron Analyze Video 的替换评估

核对日期：2026-09-03（Asia/Shanghai）。代码基线：`dev@733b387e`。
独立 worktree：`/Users/tianyicai/ai-image-editor-agentic-video-analysis`；分支：`codex/agentic-video-analysis`。

## 结论

**技术上可以接入；建议作为 Analyze Video 的可选分析模式，暂不全量替换。**

当前账号已成功调用 Gemini 3.7 Flash 的 agentic video，返回两组 `processing_call` / `processing_result`，确认功能实际生效。一次 57.2 秒公开实拍样片对照中，同模型 agentic 比 static 慢约 97%，总 token 多约 1.8%，按公开价格估算成本高约 50%。输出更细，但本次未做盲评或逐镜头真值评分，不能宣称质量胜出。

建议优先试验长视频中的定向检索、异常定位、截图找时刻；上传短视频后的全片预分析先保留 static。截图定位之后的真实抽帧复核、精确字幕转录和编辑工具继续承担各自职责。长视频收益仍需 Makaron 素材验证。

本次交付是研究报告、可复跑探针和真实 API 结果。没有修改产品代码、依赖、线上配置、数据库或客户 credits；Google 的三次推理使用现有 API key，会产生供应商侧正常推理费用。

## 1. 你看到的发布是什么

Google 在 2026-09-01 发布 **Agentic Video Understanding**。它让 Gemini 按问题主动选择片段和模态，而非只按固定 FPS 读取整片。官方上限数字为 token 减少 88%、成本减少 66%、准确度提升 7%；这些是厂商特定评测结果，不是对 Makaron 的保证。发布支持 3.7 Flash、3.6 Flash、3.5 Flash-Lite，按标准 token 计费，无额外功能费。[Google 发布原文](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-agentic-video-in-gemini/)

已从 X 索引定位到 [Google DeepMind 原帖](https://x.com/GoogleDeepMind/status/2094840179676660097)。本次直接访问 X 返回 403，技术结论以 Google 官方文档及实际 API 响应为依据。发帖日期由索引发现，并与官方文章日期交叉核对。

截至本次核对，文档和账号模型列表已出现 3.8 Flash；本轮选择发布文章明确举例的 **3.7 Flash**，以隔离“新模型”和“新处理模式”两个变量。未测试 3.8 的质量或性能，不把本报告当成最新 Gemini 模型排名。

## 2. 当前 Analyze Video 的真实实现

| 路径 | 当前行为 | 替换影响 |
| --- | --- | --- |
| `src/lib/gemini.ts:1634`，`analyzeVideoContent` | Google SDK `generateContent`；固定 `gemini-3-flash-preview`；URL 优先，异常后下载为 base64；下载后检查 38.5 MB 上限；硬编码 MP4 MIME | 最集中的后端接入点；当前没有 agentic 配置、Files 生命周期或 usage 返回值 |
| `src/lib/agent-context.ts:138`，上传预分析 | 缺少有效 description 时，并行分析视频，在 Agent 开始规划前等待；保存约 900 字符的证据描述 | 全量改成 agentic 会影响首次回复；额外长输出还可能被压缩掉 |
| `src/lib/agent-tools.ts:2171`，`analyze_video` | 单片 / 批量 describe；独立 `locate_frame` 模式 | 保持现有一个工具入口，内部选择处理模式即可 |
| `src/lib/gemini.ts:1555`，截图定位 | 图 + 视频返回定位 JSON；Agent 抽出真实候选帧，再用 `verifyFrameImageMatch` 复核 | 新模式即使找得准，也不能直接删除复核；当前低置信度或复核失败会降为 uncertain |
| `src/lib/agent-tools.ts:868`，来源片段 | prompt 限定 `source_range`，要求原片时间基准；目前未物理裁片 | 接入时必须测试时间偏移、越界以及重复画面；不能把裁片相对时间直接当原片时间 |
| `src/lib/skills/analyze-video.ts` → `src/mcp/server.ts:449` → CLI | 同一分析 helper；MCP 返回文本；CLI 本地文件先上传，URL 直接使用 | 应统一分析后端和 usage，避免只升级 App |
| `src/app/api/mcp/route.ts:78` | 有 usage 按 token 扣费，否则按工具价格；analyze_video 完成回调当前未传 usage/model，也未给 helper 传 userId | 本次只确认代码路径，没有读取数据库实际定价；不能声称 App/CLI 当前账单完全一致 |

现有架构已经把视频理解和 Agent 主模型分开。因此无需替换 Agent 大脑、Timeline 或整套视频编辑工作流。

## 3. 官方 API 与工程接缝

Developer API 用 `interactions` 的视频输入 `processing: "agentic"`。文档建议短于 5 分钟且重延迟/全片精度的任务可继续 static；定向检索和长视频适合 agentic。确认生效应看 processing steps。大文件应走 Files API；裁片区间/FPS 自定义仅支持 static。多轮可用 `previous_interaction_id` 或保留完整 steps；本次使用无状态 `store: false`。[视频 API 文档](https://ai.google.dev/gemini-api/docs/video-understanding)

Cloud 路径另有 `generateContent` + `mediaProcessing: "AGENTIC"`，要求 `v1beta1`，该功能标为 Preview。这是另一套 endpoint/auth 合同，不能把示例字段直接套进现有 API-key SDK 路径。[Google Cloud 文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/video-understanding#agentic-video-understanding)

本地安装的 `@google/genai` 为 1.40.0，`VideoContent` 类型没有 `processing`；npm 查询的 latest 为 2.21.0。本轮使用独立 REST 探针，没有升级全仓共享 SDK。后续可先增加窄 REST adapter，再独立评估 SDK 大版本迁移，避免连带影响生图、Tips、转录等现有调用。

`Interactions` 返回 `steps` 和 `usage`，不能沿用 `result.text` / `usageMetadata` 的读取方式。还需要区分 completed、失败、无文本、截断，以及处理模式未生效的情况。[Interactions API](https://ai.google.dev/api/interactions-api)

## 4. 真实请求结果

材料：[Google 公开 Pixel 8 样片](https://storage.googleapis.com/cloud-samples-data/generative-ai/video/pixel8.mp4)。下载 4,951,975 bytes；FFprobe：57.208005 秒、1280×720、H.264、AAC、30000/1001 FPS。SHA-256、完整问句、响应正文、usage 和步骤类型保存在 [results.json](./results.json)。

问句直接复用当前上传预分析的英文 prompt，要求按时间顺序描述 subjects、setting、actions、scene changes、text、framing、mood、useful moments。每个方案仅运行一次。

| 方案 | 请求耗时 | 输入 + 工具输入 | 输出 + thinking | 总 token | 估算供应商成本 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 当前 3 Flash Preview static | 22.279 s | 5,238 | 965 | 6,203 | $0.005514 |
| 3.7 Flash static | 18.479 s | 5,227 | 800 | 6,027 | $0.006920 |
| 3.7 Flash agentic | 36.387 s | 4,217 | 1,920 | 6,137 | $0.010363 |

3.7 两组使用相同 bytes、prompt、inline transport、`thinking_level=medium`、4096 输出上限、`store=false`。当前方案复现现有 helper 的 URL-first 路径，首次 URL 调用即成功；因此旧/新比较同时包含模型和 transport 差异，只有两组 3.7 是处理模式对照。没有运行 App 或 CLI 的完整用户请求。

表中耗时是完整 API 请求到响应的时间，含本机网络、请求传输和供应商处理；不代表纯推理时间。公共样片下载另花 3.488 秒，未计入表格。串行运行、缓存/负载差异、样本量 1 均限制结论，不能推出 P50/P95。

agentic 共 2 组 processing call/result；static 没有。agentic 的初始输入仅 116 token，但工具加载另有 4,101 token、thinking 949 token，不能只比较初始 input 宣称节省 98%。总量与四项和相符。相对同模型 static，总 token +1.83%，请求耗时 +96.91%，估算成本 +49.75%。

图像抽查：用 FFmpeg 每 5 秒提取代表帧，确认夜景、人物介绍、巷道、手机拍摄、招牌和水面反射等主体证据存在。agentic 提到了人物标签和屏底声明等额外细节，与抽查帧部分吻合。但没有逐秒核对、音轨人工听审或截图定位真值；不能给准确率，也不能证明亚秒定位能力。

本次采用“完整描述”问题，agentic 答案长度约为同模型 static 的 2.16 倍，输出/思考开销抵消了媒体输入节省。它在这一个短片上没有体现成本或速度优势，不能由此否定长视频定向问题的收益。

### 成本计算与现有账单问题

估算使用本次公开价：3.7 Flash 输入 $0.75/M、输出（含 thinking）$3.75/M，优惠截至 2026-12-31；2027-01-01 起 $1.50/M、$7.50/M。当前 3 Flash Preview 的仓库 fallback 价是 $0.50/M、$3/M。以上不含 Makaron markup，未核对供应商账单。[Google 价格页](https://ai.google.dev/gemini-api/docs/pricing)

按本次 usage 估算：`(input + tool_use) × input_rate + (output + thought) × output_rate`。正式适配必须保留原始 usage 并验证缓存/各模态/多轮的计费语义，避免工具输入漏计或重复加总。[token 说明](https://ai.google.dev/gemini-api/docs/tokens)

现有 `analyzeVideoContent` 仅将 `promptTokenCount` 和 `candidatesTokenCount` 送去扣费，本次旧模型响应另有 564 thinking token。这是旧路径已有的潜在少计项；升级时需要验证修正，不能把旧算法算出的较低用户扣费当成供应商实际成本。新模型若没有匹配的 token rate，当前通用扣费函数会落到 $5/$25 的兜底价；实际 DB 是否已有匹配记录本次未查。

## 5. 建议的替换范围

| Makaron 使用场景 | 建议 | 原因 / 验收重点 |
| --- | --- | --- |
| 上传短片后立即提供全片证据 | 继续 static；新模型升级另测 | 属于 Agent 首次回复关键路径；本次 agentic 接近两倍请求时间 |
| 长视频找具体情节、异常、动作 | 优先进入 agentic A/B | 与官方目标匹配；必须用真实长素材验证召回、幻觉、延迟和成本 |
| 截图定位 `locate_frame` | 第二阶段试验 agentic | 潜在高价值；需 mixed image+video、JSON 合同、重复镜头、0.2–0.5 秒事件等专项测试 |
| 已知时刻检查裁切、布局 | 继续 `preview_frame` | 需要真实像素证据和确定性时间定位 |
| 精确转录、字幕/逐词时间戳 | 继续 `transcribe_audio` | 本轮没有任何替代转录合同的证据 |
| 已有 Scene/上游 description 的素材 | 继续复用已有证据 | 避免自动重复分析；agentic 是单次视频理解能力，不能据此移除素材索引 |

这是基于代码和本次样片得出的工程建议，不是已经接入的路由策略。5 分钟只作为初始实验分桶，最终策略应同时考虑任务类型、是否限定片段、deadline 和素材长度。

## 6. 实现顺序与通过标准

1. 加独立 video-analysis adapter，保留 `analyze_video` 外部入口。返回 analysis、model、requested/effective processing、usage、耗时、fallback 原因，兼容现有文本输出。模型用显式 ID，避免浮动 latest。
2. 先用本地/单次 Preview 开关手动选择 static 或 agentic，默认保持现状。配齐超时、取消、并发上限、错误分类；不能让所有异常一律触发完整视频重传，也不能把无效 agentic 悄悄当成功。
3. 补 Files 上传、处理等待、复用与到期处理；普通媒体 URL、签名 URL、MOV/WebM、超过现有 inline 上限分别测。Google 公共 URL 样片成功不等于所有 Supabase URL/大文件都兼容。
4. App/CLI/MCP 共用 usage 归一化并只扣一次；补新模型价格和优惠到期配置，验证实际 ledger。保持 description 复用和 source range 时间合同。
5. 用冻结问句和人工真值做三组对照：旧模型 static、新模型 static、新模型 agentic。素材含短广告、快剪/屏幕文字、10 分钟以上对话、长片中短暂事件、重复画面和截图定位。覆盖完整概述与定向问题；控制输出格式后再对比效率。
6. 建议门槛：短片关键事实/顺序不退化、预分析端到端 P95 不显著回退；长片定向检索在相同召回要求下实际成本下降；截图定位满足业务容差且真实帧复核通过；JSON、错误/fallback、账单与 CLI/App 输出全部可解释。样本数量先足以暴露失败模式，再决定是否扩大。

达到相应场景门槛后再灰度相应路径；全量默认替换需要真实 Makaron 链路验收。本轮未部署、未合入 dev。

## 7. 复跑

Node 22+，不依赖项目 node_modules；探针固定使用 Google 公共样片，只进行模型查询和三次视频理解请求：

```sh
node docs/research/agentic-video-2026-09-03/probe.mjs \
  --env /Users/tianyicai/ai-image-editor/.env.local \
  --model gemini-3.7-flash \
  --out /tmp/agentic-video-rerun.json
```

验收是三组均完成且有文本，agentic 必须出现 processing call/result，否则进程非零退出。`--out` 请使用新路径保留本轮证据。探针不把 key 或视频 base64 写到输出中，不调用 Makaron 数据库/充值/扣费接口。这个结果只能证明本次样片与请求配置可用。
