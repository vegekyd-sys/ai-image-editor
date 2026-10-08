# 图片模型能力统一与回归清单

2026-10-08：先列验收 case，再实现、逐项回归。此文档记录候选合同，不代表已发布。

## 用户修订：优先出图（先列 case，后改代码）

本节替代下文初版清单中会阻断生成的能力冲突行为。供应商真实失败、计费或凭据错误仍按真实结果报告，不把排名变成付费失败重试链。

| Case | 新预期 |
| --- | --- |
| R05 | 未知/过期模型 ID 回到 Auto，Flare 优先；Agent/MCP schema 和 CLI 不在入口拦截未知字符串 |
| R07 | NSFW 文生图、编辑均直接 Spicy；忽略它不支持的比例、分辨率、透明参数；输入超过上限时保留底图和按顺序可用的参考图 |
| R09 | 透明 8:1 默认保留 8:1，选 Nano Banana 2.1 不透明图；如果参考图等要求更适合 Flare，则保留透明、放宽比例；不因这些能力冲突阻断生成 |
| R10–R11 | 候选都不兼容时使用能力范围内的有效参数；参考图优先保留，超过全部模型上限才按顺序取支持数量；非法/不支持尺寸可省略，由模型决定画布 |
| R12 | Spicy 文生图可使用支持范围内的比例；超范围或图片编辑硬比例直接省略，NSFW 模型选择不受尺寸影响 |
| R13 | 显式模型无法满足需求时，在提交前选择最合适模型并调整次要要求；已提交后不因失败另换模型 |
| R14–R18 | App、MCP、CLI、共享 Skill 使用同一生成计划；预检按实际模型、尺寸档位和参考数量报价；成功消息说明实际放宽项，不把它当报错返回 |
| R21–R22 | 更新所有活动说明和冻结 prompt 合同，针对上述新预期补回归，再完成全量检查与构建 |

取舍默认顺序：先保留参考内容，再保留可用比例、透明、分辨率；同等满足程度下保留显式模型偏好，再按 Flare → Nano Banana 2.1 → Spicy 排序。NSFW 的 Spicy 选择优先于这些取舍。

## 目标合同

Image Model Capability 同时拥有模型事实、默认优先级、别名、参数校验和 Agent 能力说明。Model Router 保留供应商执行职责，不再另写选模型规则。Prompt 保留创作方法和用户意图，不再维护模型排名或数字限制。

自动选择先满足硬性要求，顺序为 GPT Image 2.5 Flare → Nano Banana 2.1 → Qwen Spicy。Sunburst、经典 Nano Banana 2、Lite、Wan 为显式选择。NSFW 由主 Agent 判断并通过参数传递，直接选 Spicy；不使用关键词正则猜测 NSFW。付费提交失败不因排名自动换模型或重发。Tips 文案与已有显式图片预览配置独立保留。

## 改动前确定的 case

| ID | 场景 | 预期 |
| --- | --- | --- |
| R01 | 无模型的文生图、单图编辑、多图参考、商品/文字/排版/人脸恢复 | Flare 优先；不再按 category 分散排名 |
| R02 | 自动 8:1、1:8、4:1、1:4 | 先排除不兼容模型，选 Nano Banana 2.1；不先失败再补背景 |
| R03 | 自动 2K/4K，或显式 imageResolution=1K | Nano Banana 2.1；不能把这个参数静默丢给 Flare |
| R04 | 显式 Flare / Sunburst / 2.1 / 经典 / Lite / Wan / Spicy | 保留选择，不因排名覆盖 |
| R05 | openai、qwen 旧别名，pony/wai 退役，未知 ID | 旧别名规范化；退役和未知 ID 在提交前失败 |
| R06 | NSFW 文生图、图片编辑、已有会话 NSFW | 直接 Spicy；Agent 判断优先于普通模型偏好 |
| R07 | NSFW + transparent / 2K / 超过 3 张输入 / 编辑要求硬比例 | 明确不兼容，不调用其他模型 |
| R08 | 透明文生图、源图抠图、透明新布局、显式 Sunburst | Flare 或指定 Sunburst，保留已有透明输出合同 |
| R09 | 透明 8:1 或与所有候选冲突 | 提交前失败，指出具体能力冲突；不返回不透明替代 |
| R10 | Flare 16/17、2.1 14/15、Wan 9/10、Spicy 3/4 输入边界 | 底图和所有参考图合计；前置校验与 provider 一致 |
| R11 | Flare 1:3/3:1 及越界；2.1 枚举；Wan 1:8/8:1；非法/零比例 | 接受边界，拒绝非法与不支持比例；不静默裁剪或限幅 |
| R12 | Spicy 文生图 vs 图片编辑 | 文生图使用当前 Z-Image 尺寸合同；编辑接口不支持硬比例控制 |
| R13 | 明确模型与硬要求冲突 | 不提交，返回模型/冲突字段/满足全部条件的可选模型 |
| R14 | UI 手选覆盖 Agent 参数；无手选 Auto；Agent 自己识别 NSFW | 统一 preflight 和实际调用；NSFW 标志保持会话生效 |
| R15 | Agent 省略 media_index、0 sentinel、底图 + 时间线/上传/workspace 引用 | 原有输入语义保留；累计数量一致 |
| R16 | MCP / CLI：省略模型、显式模型、比例/分辨率/NSFW 参数 | 与共享 Skill 同路由；stdio 本地文件按实际输入个数校验 |
| R17 | Credits 缺少价格、余额不足、路由从 Flare 换成 2.1 | 按实际首选模型预检；校验失败不扣费、不提交 |
| R18 | 成功：实际模型、provider、成本、source/run 归因 | 一次供应商调用和一次结算；保持现有持久化链路 |
| R19 | provider 超时、异常、空输出、内容审核拒绝 | 无自动跨模型重试；不把单个模型拒绝归纳为整个生成器限制 |
| R20 | Tips 文案、Creative/Wild/Captions 显式预览、Enhance/NSFW 预览 | 保留独立预览配置和已定产品路线；共享校验不混淆普通 Auto |
| R21 | 自动生成工具描述与 Prompt | Agent/MCP 读取同一能力来源；不残留冲突的模型排名 |
| R22 | 构建、全量测试、CLI smoke、i18n、Agent startup | 验证候选代码兼容性，不把本地结果当上线验收 |

## 验证层次

1. 表驱动单测：全部选择组合、边界与冲突，结果按 case ID 对应。
2. 入口集成：真实 Agent tool 和 MCP HTTP → 共享 Skill → mock provider → mock billing，检查提交次数、参数和结算；复用原有 Tips、透明、输入、计费测试。
3. 本地真实主 Agent 选择与供应商输出：用原 8:1 请求验证自然语言选择，并完整解码/查看媒体。与自动测试、生产发布分开报告。

非目标：数据库迁移、改价格、改视频、改 iOS 二进制、自动重做用户现有项目。发布仍按已有 release 流程处理。

## 候选实现与验收对应

能力来源为 `src/lib/image-model-capabilities.ts`。App Agent、MCP 和 provider builder 共用校验；Agent/MCP 的模型说明自动生成。`model-router.ts` 仅执行已选供应商，排名不作为付费失败的重试链。浏览器沿用 `nsfw_detected` 事件，把主 Agent 的判断保持到后续对话。

| Case | 自动测试证据 |
| --- | --- |
| R01–R13 | `imageModelCapabilities.test.ts` 表驱动矩阵；`nanoBanana21.test.ts`、`falImage25.test.ts`、`wanImage.test.ts`、`mulerouterQwenSpicy.test.ts` 的 provider 合同 |
| R14–R15 | `wanImageAgentBilling.test.ts` 实际工具工厂：UI 优先级、NSFW 会话标记、0 sentinel、底图/参考图累计；已有 Agent 输入/媒体矩阵回归 |
| R16 | `imageCapabilityMcp.test.ts` 实际 MCP HTTP → Skill → mock provider；CLI smoke 的 Auto 8:1/2K 和 `--nsfw` 参数传递；`agentDiscovery.test.ts` 的公开 Skill 一致性 |
| R17–R18 | 上述 Agent/MCP 集成，加 `spicyMcpBilling.test.ts`、`wanImageMcpBilling.test.ts`：价格缺失、余额不足、最终供应商成本、结算失败、一次提交/结算 |
| R19 | 路由与 MCP 集成的超时、审核拒绝、空结果、无配置；不跨模型重试，不结算失败结果 |
| R20 | 能力矩阵及已有 Tips category / streaming / route 回归；Tips 文案和显式预览不受普通 Auto 排名覆盖 |
| R21 | 能力矩阵、`agentPromptPolicy.test.ts`、冻结 prompt 合同与 discovery 同步测试 |
| R22 | 全量 Vitest、CLI smoke、TypeScript、构建、i18n 和 Agent startup；最终结果完成后记录 |

### 真实调用（本地，2026-10-08）

`scripts/image-model-capability-acceptance.ts` 使用真实 `gpt-6-luna` 主模型和当前工具 schema，图片 execute 被替换为不提交供应商的验收桩。普通商品图选 Flare、原项目 8:1 横幅请求选 Nano Banana 2.1、NSFW 标记搭配中性纹理内容选 Spicy，三个选择通过。成人内衣测试提示词被 Azure policy 拦截；因此本次验证不代表主模型可以处理所有成人内容。参考 V 仅以 Media Index 描述进入路由测试，没有执行原项目角色保真验收。

实际 OpenRouter 8:1 文生图使用安全的冰蓝茶壶横幅，完整解码、保存并查看了图片：2928×352；茶壶位于左侧，右侧浅色渐变留白，无可见文字或水印。供应商成本 $0.036195。此尺寸匹配 [Nano Banana 2.1 供应商原生尺寸表](https://runware.ai/docs/models/google-nano-banana-2-1/guides/prompting)，不等于数学上精确的 8:1。能力说明明确该边界；没有自动裁剪或拉伸输出。

本地验收数据在 `test-results/image-model-capabilities/agent-decisions.json`、`supplier-receipt.json`、`panorama.png`（忽略文件，不提交媒体）。第一次输出已完整解码，但验收脚本用精确比例阈值误判，未保存图片；修正脚本为先保存再校验供应商原生尺寸后，完成上述视觉验收。另一次使用本地保存的生产 env 副本返回 HTTP 403，未换供应商或重试该请求；最后使用已有本地有效配置完成生成。这不证明当前线上配置或线上端到端可用。

剩余生产验收：合并与发布后，真实项目 chat → run → 图片保存/重新打开、Credits 归因、NSFW 跨轮状态。当前工作没有修改该项目或生产数据。

### 最终本地检查

实现提交 `1a1e64c7` 在独立 runtime runner 执行 `release:check --local`，退出 0：TypeScript 通过，326 个 test file 通过、1 个跳过；2146 项 test 通过、1 项跳过；CLI smoke 通过；Next.js webpack production build 和 postbuild 的服务端运行时打包检查通过。`check:i18n-ui` 与 `check:agent-startup` 通过，改动文件 ESLint 0 error（`agent-tools.ts` 既有未使用 locale warning）。构建只有既有 `libheif-js` 动态 require 警告。

22 个 case 的自动回归按上表覆盖；真实调用只覆盖表述过的三种主模型路由和一份安全全景媒体，不声称覆盖所有真实内容或线上端到端场景。全量检查日志保存于本地 `/tmp/image-capability-release-check.log`；默认 dirty runner 与主 checkout 既有修改均未被覆盖。
