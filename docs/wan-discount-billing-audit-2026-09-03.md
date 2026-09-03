# Wan 折扣价更新与计费目录审计（2026-09-03）

> 本文保留第一阶段只读审计时的事实与状态。用户随后确认开始统一目录与 MCP 视频计费修复；该阶段的实现、迁移和未解决项见 [统一媒体计费目录](./media-pricing-catalog.md)。下文“不需要迁移”仅指原先单独调整 Wan 常量的方案，不适用于后续数据库目录方案。

## 范围与交付状态

- 代码基线：`dev` 的 `733b387e`；独立 worktree / 分支：`codex/wan-discount-billing`。
- 已实现：Wan Standard 六折、Prime 七折成本，保留现有 2x markup、每 Credit = USD 0.01 和按整次任务向上取整规则。
- 未改：其他模型价格、provider 路由、prompt、数据库、用户余额及历史订单。
- 状态：本地实现并验证；未合入 dev、未部署。本报告不表示新价格已经在线上生效。
- 审计方式：源码检查 + Supabase 只读 SELECT。Production / Preview / 本地测试共享数据库，`usage_logs.source = app/mcp` 不能区分部署环境。
- 本次没有向视频供应商提交付费生成请求，也没有用供应商账单逐单对账；以下区分“有扣费流水”与“价格完整正确 / 扣费无遗漏”。

## 1. Wan 更新

依据：用户提供的《MuleRouter_Wan3.0_定价与模型说明.md》（文档更新日期 2026-08-22），用户于 2026-09-03 确认折扣可用。

| 分辨率 | Standard 成本 USD/s（旧 → 新） | Prime 成本 USD/s（旧 → 新） | Standard 5s Credits | Prime 5s Credits |
| --- | --- | --- | ---: | ---: |
| 480P | 0.05 → 0.03 | 0.068 → 0.0476 | 30 | 48 |
| 720P | 0.10 → 0.06 | 0.14 → 0.098 | 60 | 98 |
| 1080P | 0.20 → 0.12 | 0.28 → 0.196 | 120 | 196 |
| 2K | 0.20 → 0.12 | 0.28 → 0.196 | 120 | 196 |
| 4K | 0.23 → 0.138 | 0.31 → 0.217 | 138 | 217 |

计费：`ceil(供应商总成本 USD × 100 × 2)`，代码保留浮点误差容差。Prime 480P 15s = 142.8 → 143 Credits，不按每秒分别取整。

1080P 仍走原生 `w3.0-video` / `w3.0-video-prime`，只有 2K / 4K 切到 `w3.0-video-pro` / `w3.0-video-prime-pro`。因此没有采用文档中 FlashVSR **1080P** 的 0.108 / 0.182 USD/s；这些不是当前 1080P 的实际路由。

价格定义在 `src/lib/video-model-capabilities.ts`，共享估算器被 Agent、`/api/animate`、`/api/video-snapshot`、HTTP MCP 使用。这次更新不需要数据库迁移；仅往现有数据库添加 Wan 行并不会改变这些路径的计费。

验证：

- 9 个测试文件、151 项测试通过，涵盖 10 档 Wan 成本与收费、默认分辨率、整次取整、引用输入不额外收费、预扣费及其他视频 provider 回归。
- 对比整个 capability registry：共 13 个模型，仅 2 个 Wan 模型的价格字段变化，其他 11 个模型及所有路由/能力字段完全不变。
- 修改文件 ESLint、`git diff --check`、`check:video-reference-workflow` 通过。

## 2. 为什么数据库列表缺少视频

当前存在三套价格来源，而不是一个完整目录：

| 类型 | 实际定价来源 | Admin 是否完整显示 |
| --- | --- | --- |
| Agent / LLM、token 型图片、图片/视频分析 | `token_rates` + `token-rates.ts` fallback；部分 provider 返回实际成本 | DB 条目显示，代码 fallback 不单独显示 |
| Qwen / Pony / WAI、旋转等按次工具 | `credit_pricing` + `pricing.ts` fallback | 只显示 DB 条目 |
| Wan / Grok / Omni / Seedance / MiniMax / Kling / Lipsync 视频 | `video-model-capabilities.ts`，按分辨率、输出时长、部分输入用量计价 | 缺失当前完整价目 |
| Seed Audio：配音、音乐、音效、翻译等 | `billing/seed-audio.ts`，优先供应商 credits，其次时长估算 | 缺失 |

数据库快照：`billing_enabled=true`；`credit_pricing` 14 行、`token_rates` 33 行。按次表只有这三条旧视频价目：

| DB tool_name | supplier_cost | credits |
| --- | ---: | ---: |
| create_video_kling | 0.11 | 22 |
| edit_video_kling | 0.11 | 22 |
| create_video_seedance | 0.161 | 32 |

这些不是当前共享视频估算器的价格来源。Admin 修改这些行不会同步修改对应视频 registry。`src/app/admin/page.tsx` 仍说明“Video tools: credits = per second”，容易让运营误以为该列表控制全部视频收费。

入口证据：`src/app/api/admin/credit-pricing/route.ts` 仅查询 `credit_pricing`；`src/lib/video-model-capabilities.ts` 的 `getRequiredVideoCredits` 给实际视频定价；`src/lib/billing/credits.ts` 的 `deductFixedCredits` 写入扣费流水。

### 流水抽查：缺少价目不等于免费

固定窗口：`2026-08-27T00:00:00Z` 至 `2026-09-03T11:24:59.443Z`。分页读取 6,281 条流水，未因上限截断。只读取工具、模型、金额、渠道、时间，未导出用户身份或 prompt。

| 对象 | 正向扣费条目数 | 正向扣费合计 Credits |
| --- | ---: | ---: |
| Wan Standard | 47 | 15,690 |
| Wan Prime | 32 | 13,272 |
| Seed Audio | 505 | 7,772 |

Grok、Omni、Seedance、MiniMax 等也有正向扣费记录。视频部分路径提交时预扣费，所以条目数不是成功出片数。另有 `refund:create_video` 流水，但缺少可直接按模型归集的信息；以上不是扣除退款后的净收入。

## 3. 视频之外的遗漏与风险

### A. 已收费，但未进入统一价目

1. **Seed Audio**：当前配音、音乐、音效等都走同一个音频生成工具，并非独立旧 TTS 收费。代码按供应商 credits / 时长计费，默认约 0.0025 USD/s × 2；DB 没有 `create_seed_audio` 行。`pricing.ts` 的 10 Credits 兜底不是最终音频统一固定价。旧 `create_music` 12 Credits 行也不能代表当前 Seed Audio 音乐定价。
2. **Smart Layers 实验分支**：共享数据库有 `smart_layer_discovery/segment/inpaint/edit` 扣费与退款；当前 dev 不包含该模块。只读检查 `codex/smart-layers` 中的 `src/lib/smart-layers/billing.ts`，确认存在 DB 优先 + 代码默认价（1/2/6/40 Credits 等）及结算逻辑，但 DB 没有对应价目。应在该功能发布时同步纳入目录；本次未修改该分支，也不将这些流水当作线上启用的证据。
3. **旧 create_voiceover fallback**：代码仍有 2 Credits 默认价，但 `create-voiceover.ts` 已标记 deprecated，当前 `src` / CLI 未发现其调用。不是已证实的活跃收费遗漏。

### B. 没有独立计量/扣费的服务

1. **ASR 转写 / 字幕时间码**：Agent 的 `transcribe_audio` 实际调用 `transcribeWithVolcengineAsr`，走火山外部 ASR；检查工具与 provider 函数均未发现独立扣费，DB 也无独立价目。这不代表整个 Agent 对话免费——LLM token 仍单独计费；只是 ASR 成本未单列。是否向用户收费、按秒还是套餐包含，需要产品决定及实际合同价。
2. **Sandbox / FFmpeg / Remotion 渲染、Storage / CDN**：所检查路径没有独立的用户 Credit 价目。这些属于基础设施成本，不能单凭目录缺失认定为漏收；应明确是由平台承担，还是引入计算/存储用量收费。

### C. 已确认的计费可靠性风险（本次仅审计，未改）

| 优先级 | 问题 | 证据 / 影响 |
| --- | --- | --- |
| 高 | 未知按次工具默认免费放行 | `credits.ts:checkBalance` 缺价返回 ok；`deductCredits` 缺价直接 charged=0 且不记流水。新工具若只接通用回调但忘记登记，可能真正漏收。视频共享估算器本身对未知模型拒绝生成，但没有消除所有入口的缺价放行。 |
| 高 | HTTP MCP 视频余额预检查错价目 | `src/app/api/mcp/route.ts:onToolStart` 查询去前缀后的 `create_video` / `edit_video`，未带请求时长与分辨率，DB 无这些通用行，因而可直接放行。Grok API fallback 也用该查询。供应商任务创建后才按 registry 扣费，余额不足时存在“上游已产生费用、下游扣费失败”风险；尚未对账量化损失。 |
| 高 | 定价读取错误被当成空表/关闭开关 | `getAllPricing`、`getAllTokenRates` 未检查 Supabase error，可能缓存空结果/默认价 5 分钟；`isBillingEnabled` 读不到值会将计费视为关闭并缓存 60 秒。应区分明确关闭与读取失败，避免静默错误计费。 |
| 中 | 图片/音频等异步扣费失败只打日志 | 如 `agent-tools.ts` 的 `deductSeedAudioCredits(...).catch(...)`、`/api/audio`、`/api/preview`。未看到这些调用点的可靠结算重试闭环，存在成功返回媒体但扣费未完成的风险；未证明历史损失。 |
| 中 | GPT Image 无 usage 兜底价漂移 | DB `edit_image_openai` 为 20 Credits，代码默认 4 Credits；DB 优先。仅在走按次 fallback 的情况下影响金额，不等于正常 token 计费统一多收。应确认预期价并统一。 |
| 中 | 通用 token 兜底实际被使用 | 窗口内 `unknown:google/gemini-3.1-flash-image-preview:text` 140 条 / 1,075 Credits，`unknown:google/gemini-3.1-flash-lite-image` 9 条 / 159 Credits。代码对应缺价 fallback 为 5 / 25 USD 每百万输入/输出 token（若有 provider 实际成本则优先用实际成本）。现在 DB 两者已有配置，无法仅凭现状确定当时原因或正确差额；需结合当时价目、token/实际成本与日志核账。 |
| 低 | Admin 更新没有可靠即时失效 | `credit-pricing/route.ts` 的写入不调用已有 cache invalidator，各实例还各自缓存；生效可能延迟到 TTL。不能承诺修改立即全局生效。 |

个人 Grok / Codex 套餐的零 Credits 流水由 `recordSubscriptionUsage` 明确记录，是既定策略，不纳入漏费统计。

## 4. 建议后续处理（未实施）

1. 先修 MCP 视频提交前的精确报价与原子预扣费，再补失败退款/幂等结算测试；不能只往 DB 加一条通用固定价冒充所有分辨率/时长。
2. 建立一个 Admin 可见、运行时共用的完整价格目录：model + provider route + operation + resolution + 计价单位 + supplier cost + markup + 生效版本。视频输出秒、参考视频输入秒、图片输入张数、音频、token 均有清晰单位。
3. 迁移应让消费者真实读取同一个报价来源，而不是仅“补几行 DB 展示”。保留模型能力注册信息，但消除价格在数据库与 registry 两头维护的问题。
4. 未知收费项拒绝提交并告警；显式免费单独标记。读取异常使用受控的最近有效配置或返回可重试错误，不当成免费。
5. 为 ASR 和基础设施明确“平台承担 / 套餐包含 / 单独收费”，再决定是否补价，不能凭空填一个成本。
6. 增加按请求幂等的预留、结算、退款及重试，流水保存价格版本和计费维度；对 149 条 token fallback 记录单独核账，不自动重扣或退款。

本次只完成 Wan 折扣价与审计。统一目录、上述风险修复、数据库迁移及生产发布应另行确认范围。
