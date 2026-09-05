# Core Prompt 分层重构

独立分支 `codex/core-prompt-layered-refactor`，基线 `3193cd36`。本地候选，不代表已合入 dev、部署或通过生产验收。

最新实物验收见 [acceptance.md](acceptance.md)，包括H3 Max/Grok/SeeDance Mini、47张图片、完整CLI保存/导出、真实编辑器改字与失败样本。最新速度见 [acceptance-speed.json](acceptance-speed.json)。旧 `results.md` 保留前一阶段证据，不代表最新全场景通过。

## 目标和验收顺序

先确认能力与真实场景，再减少常驻上下文。字符减少、正确选工具、成功提交、画面质量、最终可播放交付是五个不同指标，不能互相替代。

1. 每段旧 Core 和工具合同都有可追溯的归属。
2. 已有 image / enhance / creative / wild / captions / cutout / audio / animate / coding / Composition / Director 创作正文逐字保留。
3. 同一 Agent 模型、素材、请求、工具 schema 做交错 baseline/candidate；记录首字、首次实际动作、总耗时和 cache usage。
4. 在真实生成的图片、完整解码的视频、实际执行的代码上验证任务约束。失败和 provider fallback 不能从报告中消失。
5. 本地验证与 hosted CUI/CLI 的历史恢复、计费、Preview/Export 分开验收；后者未完成时不宣传全场景无损上线。

## 分层

| 层 | 单一职责 | 入口 |
|---|---|---|
| 常驻 Core | 回复、媒体索引、意图与授权、选择最小工作流 | `src/lib/prompts/agent.md` |
| 工具说明/schema | 发现工具、必需指南、参数与返回边界 | `src/lib/agent-tools.ts` |
| 领域指南 | 原有完整创作方法和示例 | `image.md`、`animate.md`、`agent-coding.md`、`audio.md` |
| 延迟合同 | 从 Core / 重工具说明迁出的执行规则 | `video-workflow.md`、`video-submission.md`、`coding-workflow.md`、`coding-submission.md`、`workspace-authoring.md` |
| 场景 Skill | 复刻/源视频编辑、长视频、局部修复、Remotion、FFmpeg 等 | 既有 `src/skills/` |
| 运行时 | 参数验证、能力限制、身份/媒体映射、持久化、计费 | 既有 capabilities 与 tool executors，保持原逻辑 |

`agent-prompt-bundles.ts` 是静态依赖表，不判断用户意图。Agent 一次 `read_file('prompts/animate.md')` 会收到原 animate 全文以及视频 workflow/submission；读取 coding 指南会收到 coding 全部合同。领域正文没有新增模型往返。依赖用显式 Markdown import 打包，避免 serverless 漏文件。这里延迟的是**进入模型上下文**，不是声称模块直到调用时才从磁盘加载。

简单对话无需读取任何指南；直接修图保留直接 `generate_image`；透明抠图必须读取 cutout；视频先读 animate 再按源素材的权威性选择 Skill；编码先读 coding，涉及 Composition 才读完整导演合同。所有 Skill 发现、媒体工具、模型/分辨率选项和 runtime 校验保持可用。

## 无损清单和重复处理

`rule-ownership.json` 对旧 Core 的 54 个段落逐个保存原文、编号和归属。`benchmarks/core-prompt/baseline.json` 冻结旧 Core、两份工具说明、workspace authoring 与 12 份创作文件哈希。

本次先消除**常驻层重复承担领域执行规则**，不把近似句子直接当作冗余删掉。近似但包含不同条件的旧规则仍在领域合同里，能通过原文覆盖测试找到。图片工具本来已有简短合同，保留；不缩短 schema、不删工具、不把长视频内容剪短来满足 token 目标。进一步逐句合并近义规则，应以这些 case 和原文清单为门禁单独推进，不能宣称所有近义重复已全部消除。

真实 case 发现后仅补强两个 Core 路由约束：
- 透明抠图需读 cutout，纯抠图不自设画布比例。
- 精确局部编辑不得在描述中重新设计原图未改的纹样、材料或形状。

没有改变上述 12 份既有创作正文。首次候选的领结纹样退化，以及两版 Remotion 首稿共有的 JSX 外层执行问题，都记录在结果中。

## 可执行场景

完整机器可读矩阵：`benchmarks/core-prompt/cases.json`。每项有请求、上下文、必读指南、禁止动作、首个执行工具以及关键参数断言。

| 分组 | 覆盖 |
|---|---|
| 普通请求 | 问候、能力说明、句子改写、英文/日文/繁体 |
| 图片 | 直接编辑、文生图、enhance/creative/wild/captions、透明抠图、透明新布局、多图角色、原图恢复、电商布局 |
| 视频 | 脚本审阅、显式直接提交、短片、30s、平台竖屏/文字/原生声音、照片动起来、H3 Max 文生/图生/多参考首帧、Wan、长视频计划、源编辑、续写、帧修复、转录 |
| 编码 | 语音时间码剪辑、可编辑拼接、精确 MP4 分割、Remotion、已有 props patch |
| 音频 | 混合音轨、独立 voiceover |
| 真实图样 | 同一狗狗原图的局部改色、增强和整体风格化 |

首动作测试不证明任务已经做完。图片还要检查身份、姿态、纹样、文字、构图、边缘和未请求区域；视频还要看动作、连续性、节奏、声音、完整时长、比例和解码；coding 还要执行、修复、渲染、patch，并验证最终发布路径。

## 复现

```sh
# 不调用模型：逐段覆盖、创作文件哈希、真实 read_file 一次返回全套合同
node --import tsx --require ./md-loader.cjs benchmarks/core-prompt/check-contracts.ts
# 只统计真实 system 与工具 schema 的序列化体积
node --import tsx --require ./md-loader.cjs benchmarks/core-prompt/evaluate.ts
# 付费模型，首动作 A/B；媒体和 coding 工具只捕获参数，不执行
node --import tsx --require ./md-loader.cjs benchmarks/core-prompt/evaluate.ts --live --filter '^image-cutout$' --repeats 3
# 完整测试矩阵
node --import tsx --require ./md-loader.cjs benchmarks/core-prompt/evaluate.ts --live
# 媒体生成必须显式 --live，先落任务日志，已有 key 不重复提交
node --import tsx --require ./md-loader.cjs benchmarks/core-prompt/render-media.ts --live --input <capture.json> --case video-direct --output <new-output-directory>
```

凭据从本机未追踪环境文件读取；不把凭据、会话、DB 数据加入基线或报告。首轮素材为复用狗狗图片；扩展验收加入人像参考、海报和源猫视频。输出落在被 Git 忽略的 `artifacts/core-prompt/`。仅capture媒体脚本不写项目；新增CLI验收使用共享数据库中的独立QA项目，详见最新验收说明。

## 后续扩展规则

增加场景时先加入真实请求、选路/授权边界、必保留效果和最终交付证据；更新对应领域 owner。只有跨领域的路由信息进入 Core。需要随指南一起到达模型的合同加入静态 bundle，并更新实际 read_file 测试；不在 Core、工具说明、多个 Skill 各复制一份长正文。

## 发布开关（2026-09-05）

用户在查看盲评分数和剩余风险后，明确授权新增开关、默认启用新版、合入 dev 并上线。此决定不表示旧 `acceptance.md` 的所有质量门槛已经通过。

Admin 页面顶部的「新版分层 Core Prompt」控制全局 `core_prompt_settings` 表中的 `core_prompt_mode`：`layered` 开启新版，`legacy` 完整恢复基线 `3193cd36` 的 Core、workspace authoring、两个重工具说明，并停用延迟合同 bundle。工具 schema、执行器、供应商默认选择不随开关改变。管理员 API：`GET/PUT /api/admin/core-prompt`，PUT 请求 `{ "mode": "legacy" }` 或 `{ "mode": "layered" }`。

读取配置有 15 秒进程缓存和 1.5 秒超时；配置缺省默认新版，读取失败/非法值回退旧版。每次 Agent invocation 固定一个版本，模型重试不混用；后续消息/持久任务下一次续跑会重新取配置。开关正常情况下 15 秒内传播，不中断已运行请求。Preview 与 Production 共享数据库，操作会同时影响两者。没有新的必填环境变量。发布前执行 `20260905123000_core_prompt_settings.sql`：独立配置表启用 RLS，撤销 anon/authenticated 权限，仅服务端 service_role 可读写；Admin API 另行验证管理员身份。现有 app_settings 无 RLS，本次不修改其既有权限。

运行日志 `[agent-prompt] mode=...` 和 `core_prompt_mode` perf 事件可核验实际路径。回退前已经进入会话历史的指南/工具结果会保留；要求完全干净的旧版对照时创建新项目。`src/lib/prompts/legacy/` 是发布回退快照，测试逐字对照冻结的 A/B 基线，不从 benchmark 文件加载生产正文。
