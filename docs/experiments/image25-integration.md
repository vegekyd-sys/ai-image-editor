# Image 2.5 接入与比较（2026-09-09）

状态：fal Image 2.5 已完成独立分支接入与真实 CLI 生成/编辑/扣费验收；未合并、未部署。共享数据库仅新增两个 Image 2.5 token_rates 行（markup=2），未改现有模型或共享环境变量。

分支：`codex/image25-integration`，基线：`fc1217e5`。

## 已核实

- 官方模型为 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。Flare 偏重日常生成速度，Sunburst 偏重编辑精度。
- 两者支持 Images API 的 generations / edits、PNG 透明输出，以及 low / medium / high / xhigh / max / auto。Image 2 对照应采用共同支持的 low / medium / high。
- 官方文档：https://developers.openai.com/api/docs/guides/image-generation
- 官方模型：https://developers.openai.com/api/docs/models/gpt-image-2.5-flare 和 https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst

## 前期调查（fal 接入前的历史结果）

- 现有 OpenRouter `/api/v1/images` 对两个完整 2.5 模型 ID 都返回 HTTP 404 / No model found。
- 现有 Azure 资源以两个官方模型名作为部署名调用，均返回 HTTP 404 / DeploymentNotFound。这不能排除资源使用不同部署名的可能。
- PiAPI `/v1/models` 返回 HTTP 200，但未列出名称匹配 Image 2.5 的模型；这不是生成接口不支持的充分证明。
- 项目已检查的本地环境文件未配置官方 `OPENAI_API_KEY`。

当时尚无可确认的真实 2.5 输出；后续已通过 fal 完成，下文保留调查依据。

## 个人 GPT 订阅实测

Azure 开通已由用户交给同事；本任务停止 Azure 管理门户操作。以下测试只使用现有个人订阅 Relay，无 API 回退，无应用数据库写入。

已从当前 Vercel Preview 只读核对 Relay URL / 签名配置，与本地测试配置相同。签名 `/v1/usage` 成功，返回 Pro 套餐。三次请求固定同一产品摄影提示词，主模型 `gpt-5.6-terra`，图片工具请求 `quality=low`、`size=1024x1024`、`background=opaque`。

| 请求图片模型 | 完整响应耗时 | 原始尺寸 | 服务端回传图片工具模型 |
| --- | --- | --- | --- |
| `gpt-image-2.5-flare` | 70.479 秒 | 1448×1086 | `gpt-image-2-codex` |
| `gpt-image-2.5-sunburst` | 87.925 秒 | 1254×1254 | `gpt-image-2-codex` |
| `gpt-image-2` | 87.809 秒 | 1254×1254 | `gpt-image-2-codex` |

三次都是 HTTP 200、完成事件和可解码 PNG；已目视查看原图，杯子上的 MAKARON 拼写正确，陶瓷釉面、布料和光照可辨。所有响应的 `response.completed.response.tools` 都回传 `quality=auto`、`size=auto`。表中名称只是请求值，不能据此把这些输出标成 Image 2 / Flare / Sunburst 的有效 A/B。

仓库 Relay 的 `forwardResponses` 将原始请求 body 直接转发，未包含图片模型或质量改写逻辑；本次未登录远端核对已部署代码散列。因此无法把改写位置断言为已验证的远端代码事实。订阅服务回传了统一别名，也不代表已证明底层权重仍是旧 Image 2：它可能是持续更新的订阅别名，响应没有提供足以确认 2.5 的版本证据。

结论：个人订阅图片链路可用，但目前无法显式确认 2.5 Flare / Sunburst 的独立选择，也无法锁定质量和尺寸。不得据此得出版本质量或提速结论。先保留现有产品默认与命名，等可明确选择模型的供应商部署后完成迁移。

原图及脱敏摘要位于本 worktree 的 `.artifacts/image25/`，不包含原始 SSE、OAuth token 或签名凭据。可复用脚本为 `scripts/compare-codex-image25.ts`，使用 gitignored env 运行；模型确认失败会返回非零退出码，区别于生图失败。

补充编辑验收：以第一张红杯为输入，请求只把杯釉改为钴蓝。个人订阅完成响应 145.962 秒，解码并保存完成 146.004 秒，输出 1448×1086 PNG。目视检查杯子已变蓝，MAKARON 字样、构图、布料和背景保持一致；未做逐像素保真声明。服务端仍回传统一订阅别名和 auto 参数，脚本按预期返回退出码 1，原因是 `explicitModelConfirmed=false`，并非编辑失败。产物为 `.artifacts/image25/subscription-edit/`。

以上个人订阅调查阶段仅修改实验脚本与文档；后续 fal 产品接入见下节。

## 对比脚本

`scripts/compare-image25.mjs` 面向官方或兼容的 Images API，顺序调用三个明确模型，不自动重试或回退，不写应用数据库。通过环境加载 API key；不将密钥放在命令行或报告中。

```sh
# 环境中先配置 OPENAI_API_KEY；默认每模型一次，运行会产生供应商费用。
node scripts/compare-image25.mjs

# 编辑：多个输入按命令行顺序提交，第一张作为基础图。
IMAGE_BENCH_PROMPT='Change only the cup color to cobalt blue. Preserve all other details.' \
node scripts/compare-image25.mjs /absolute/path/source.png
```

可选环境变量：`IMAGE_BENCH_BASE_URL`、`IMAGE_BENCH_MODELS`（逗号分隔）、`IMAGE_BENCH_QUALITY`、`IMAGE_BENCH_SIZE`、`IMAGE_BENCH_BACKGROUND`、`IMAGE_BENCH_REPEATS`（1–5）、`IMAGE_BENCH_OUTPUT`。

报告保存提示词、尺寸、质量、背景、模型 ID、请求头耗时、完整响应耗时、图片解码并保存后的耗时、像素尺寸、透明通道和原始 usage。保存原始输出，不经过应用 JPEG 转换。重复实验轮换模型顺序；同名 quality 不保证相同费用或计算量。原始 API 输出与应用最终显示结果还需分别验收。

已通过脚本语法检查与模拟响应的三个模型生成、PNG 解码、透明度和报告合同验证；模拟结果不属于模型质量或速度证据。

后续接入范围：确认供应商后完成模型调用、实际模型与计费记录、文生图/编辑/多参考图/透明背景的真实验收，再提供同条件视觉比较。自然语言路由优化与产品清晰度选项留在后续任务。

## fal 产品接入与实测

- 模型 ID：`gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`。App 选择器、Agent 工具、MCP 与 CLI 均可显式使用。无指定变体的 Image 2.5 映射到 Flare；旧 `openai` 仍为 Image 2，现有 Auto 路由保持不变。
- 供应商端点：`openai/gpt-image-2.5/{flare|sunburst}/{text-to-image|edit}`，显式 `quality=low`，单张输出，最多 16 张有序输入。支持透明输出且检查真实 alpha。
- 只发一次付费 POST；按原 request ID 轮询。失败/超时不重发、不切换旧模型、Gemini 或个人订阅。
- 每次提交前读取 fal 价格接口；成功结果的 `x-fal-billable-units × unit_price` 作为供应商成本，通过现有 `deductByTokens` 的 providerCostUsd 分支和精确型号 markup 扣费，不虚构 token 数。普通 FAL_KEY 的账单事件接口返回 403，但价格接口和结果计费响应头可用。
- 注册脚本：`scripts/register-fal-image25-pricing.mjs`，仅补缺失行，复用旧 Image 2 的倍率，不覆盖已有运营配置。运行环境读取私有 env；已经在共享数据库验证两个新行。新型号缺少精确定价时在调用前阻止，不能误匹配旧 Image 2 的前缀。

| 实测 | 成图耗时 | fal 成本 | Makaron 扣费 |
| --- | --- | --- | --- |
| Image 2 文生图，fal 原始 API | 17.713 秒 | $0.0062 | 供应商对照，不经过应用 |
| Flare 文生图，fal 原始 API | 13.285 秒 | $0.0062 | 供应商探针，不经过应用 |
| Sunburst 文生图，CLI → MCP | 17.2 秒 | $0.0063 | 2 credits |
| Flare 红杯变蓝杯，CLI → MCP | 20.2 秒 | $0.0145 | 3 credits |
| Sunburst 透明抠图，CLI → MCP | 26.4 秒 | $0.0146 | 3 credits |

均为 low、1024×1024、单次样本。前两项使用相同提示词，本次 Flare 快约 25%，成本相同；这不是速度 SLA 或系统性质量结论。CLI 包装了额外生成指令，Sunburst 不能作为严格三方速度对照。所有图片解码、保存并目视检查；两版文字拼写正确，Flare 本次材质细节更丰富，构图不同。编辑保留杯形、字样、布料与构图。透明 PNG 检测到 alpha，但边缘存在光晕，因此只通过透明格式合同，未通过高质量抠图验收。

真实扣费记录：Sunburst 生图 `9ea161b3-3a43-49da-8f25-80c39d0bb116`；Flare 编辑 `539d1fe7-d1b1-46c5-8b13-a7f02d5bd187`；Sunburst 透明编辑 `0fd9fdde-1b1a-42f4-9a8c-bfc4ecb0040d`。已回读账本确认型号和扣费。

验收页：本 worktree `.artifacts/image25/fal-probe/index.html`。本地服务端会将 MCP 图片保存到 `mcp-output`，所以本次 CLI 的 `--out` 不改变该服务端路径；验收页已归集实际文件。未修改这项既有 CLI 行为。

来源：[fal Flare API](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api)、[fal Image 2 API](https://fal.ai/models/openai/gpt-image-2/api)、[fal pricing](https://fal.ai/docs/documentation/model-apis/pricing)。

验证：53 项相关测试通过（新供应商请求/费用/严格路由、选择器、Agent 扣费，以及旧 Image 2/Wan 回归）；全项目 TypeScript 检查通过；lint/i18n/Agent startup/video reference guards 通过，只有两条既有 warning。

## GUI 验收失败排查（2026-09-09 14:50）

回查两个验收项目的四个失败请求：三个 fal result 返回 HTTP 422、`content_policy_violation`；一个原请求返回 HTTP 200 且存在可解码的 880×1184 PNG，已直接取回，未重新提交生成。旧 catch 把审核、查询、下载等错误都合成通用失败，无法追溯当时这个 200 请求在哪个阶段报错，因此不能把它确定归因于某一次网络故障。

修复：保留审核拒绝的明确分类（不自动重试、不自动切换模型）；对状态 GET、结果 GET 和图片下载中的临时网络/429/5xx 错误最多重试三次，始终使用原 request ID，绝不重复付费 POST。新增脱敏阶段日志，后续可区分 submission/status/result/download/decode。25 项相关测试、TypeScript 与定向 ESLint 通过；真实已成功请求的 PNG 已下载并目视确认。三个审核拒绝的可用性问题仍由供应商决定，不宣称修复了其审核成功率。

## Segmind 接入与审核对照（2026-09-10）

状态：独立分支本地接入；未合并、未部署，生产供应商和共享环境变量没有变更。

- `GPT_IMAGE25_PROVIDER=fal|segmind` 显式选供应商，省略时仍为 fal；不按失败自动切换。Segmind 使用 `SEGMIND_API_KEY`，`SEGMIND_IMAGE25_MODERATION=auto|low`（默认 auto）。本地验收配置为 segmind / low。两种供应商都固定 `quality=low`。
- Segmind 使用官方 v2 异步 API；data URL 先上传至官方 storage，保留所有引用图顺序。每次生成仅提交一次 POST，网络问题只重试已有请求的 GET。审核拒绝明确报错，不自动重提。
- 供应商成本读取成功结果的 `metrics.cost`，沿用精确模型行的 markup 扣费。无有效成本则失败，不能静默免费；不虚构 token 数。供应商输出只从 `images.segmind.com` 下载并解码，透明图继续检查真实 alpha。

### 用户样本对照

两张用户提供的人物照片，分别在 Flare / Sunburst × auto / low 下各测试一次（共 8 次）。固定 prompt 为改变整体光线至冷色日光，保留人物、脸、姿势、服装、构图和场景物品；固定低质量、9:16（768×1360）。不改写提示词重试。

| 样本 | Flare auto | Flare low | Sunburst auto | Sunburst low |
|---|---|---|---|---|
| 图 1 | 审核拒绝 18.4s | 审核拒绝 18.4s | 审核拒绝 21.6s | 审核拒绝 19.9s |
| 图 2 | 审核拒绝 18.7s | 审核拒绝 18.8s | 审核拒绝 23.6s | 审核拒绝 21.5s |

全部返回 HTTP 422，错误明确为 provider content moderation block，失败结果没有计费字段。对这两个样本，low 没有带来可观察到的改善；这不是总体过审率估计，也不能证明供应商没有透传参数。未针对这两张图新增 fal 同条件样本，因此不宣称供应商总体优劣。

普通物品对照通过真实 `makaron edit → MCP → model-router → Segmind → 本地图片`：Flare 将红杯改为蓝杯，实际 27.3 秒、1024×1024 可解码 JPEG，费用 $0.01804625，usage_logs 确认扣 4 积分。原杯字样和场景保留。 Sunburst 透明图调用也成功，28.0 秒、$0.018165、扣 4 积分，PNG 1024×1024，alpha 范围 0–254。但目视仍有明显背景光晕、杯柄内部残留，不能视为抠图质量验收通过。两次成功对照合计供应商成本 $0.03621125。

本地详细结果位于 `.artifacts/image25/segmind-probe/`；私有 env 和用户图片未提交。相关 21 项测试、TypeScript 检查和 lint 通过（lint 保留既有 warnings）。

官方合同：[Flare API](https://www.segmind.com/models/gpt-image-2.5-flare/api)、[v2 async](https://docs.segmind.com/docs/serverless-api/async-inference)、[input storage](https://docs.segmind.com/docs/serverless-api/segmind-storage)。

### 同条件 fal 复测

2026-09-10 随后在 fal 上复测 5 组图片/提示词 × 两个型号，共 10 个新请求；对比 Segmind 已完成的相同 low 样本。包含两张人物图的冷色日光编辑、图 1 的街拍、黑色服装照片的街拍与三视图。保持原图、提示词、quality=low、background=auto、尺寸一致；fal 使用默认审核设置，Segmind 使用 moderation=low。每格一次，不在拒绝后改写提示词重试。

10 组配对的通过/拒绝结果完全相同：各 1/10 成功，只有黑色服装照片的 Flare 三视图成功；其他 9/10 均明确审核拒绝。不能据此推断总体通过率或两个供应商的上游实现相同。

成功三视图：fal 20.305 秒、$0.0164；Segmind 26.097 秒、$0.0205。Segmind 此次实际费用高 25%。耗时包括各自准备和下载开销，非同时测量，不作为供应商稳定速度排名。两者均生成插画风正侧背三视图；fal 把原图尖头鞋改为露趾鞋，Segmind 保留尖头外观，均不是严格保真复刻。

本地对照页面 `.artifacts/image25/fal-comparison/index.html` 含全部 10 组结果与两张成功图，`comparison.json` 保留耗时、费用、请求编号。此次没有改动应用供应商配置。
