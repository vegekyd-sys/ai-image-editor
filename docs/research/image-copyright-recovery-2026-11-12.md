# 图片版权相关拒绝的自动恢复研究

日期：2026-11-12。当前已完成独立供应商实测和本地候选实现，未发布。原始研究基线 `fbc7daac`，工作分支 `codex/image-refusal-recovery`。所有真实图片测试只使用公开虚构角色描述，不读写生产项目、会话或 NSFW 状态；候选验收的应用成本账本也替换成内存桩。

## 实测结果与最终实现

固定两条英文描述：单只皮卡丘坐在花园木桌上拿苹果；皮卡丘、妙蛙种子、小火龙、杰尼龟在湖边野餐。每条描述、每个模型独立测 3 次。Flare 使用 direct OpenAI，1K、low、high complexity；2.1 使用 OpenRouter `/images`、1K；老版 Nano Banana 2 使用 OpenRouter chat completions、minimal reasoning，保持当前经典适配器的 system prompt。两种 Nano API 的实际调用合同并非完全相同。

| 组别 | 成功/次数 | 平均耗时 | 已知平均供应商成本 |
|---|---:|---:|---:|
| Flare 首轮，单只皮卡丘 | 0/3 | 16.76 秒 | 未返回 usage，未知 |
| Flare 首轮，四只宝可梦 | 3/3 | 10.10 秒 | $0.0250/张 |
| Flare 拒绝后，同描述同模型重试 | 0/3 | 6.23 秒 | 未返回 usage，未知 |
| Flare 拒绝后，同描述切换 2.1 | 3/3 | 13.82 秒 | $0.03600/张，另加首轮拒绝未知成本 |
| Nano Banana 2.1 独立首轮 | 6/6 | 14.24 秒 | $0.03617/张 |
| 老版 Nano Banana 2 独立首轮 | 6/6 | 10.05 秒 | $0.06846/张 |

Flare 两条描述合计首轮 3/6；这个 50% 是混合两条描述后的样本值，单只皮卡丘样本全部拒绝、合照样本全部成功，不能解释成“相同 prompt 每次独立有 50% 成功率”。老版 Nano 这批 6/6 支持用户提供的经验，但不能证明长期 100%。Nano 没有出现拒绝，因此无法估计它们自身的失败后重试成功率。

Flare 7 次拒绝（含候选验收）均为 `moderation_blocked`，没有给出版权或 NSFW 子类别；报告保留原始错误身份，不将其改写为“确定的版权拒绝”。首轮比较共 24 次提交、18 张可解码产物；逐张检查了联系图，角色与主题可辨识。Flare 合照部分画面有边缘裁切，因此这里的通过率指交付了可辨识角色的图片，不代表所有构图细节满分。

比较实验已知成本 $0.810792，另有 6 次拒绝成本未知。随后候选真实验收增加 2 次提交：Flare 在 8.932 秒拒绝 → 2.1 在 33.490 秒完成，总耗时 42.487 秒；新图已实际查看，NSFW `false → false`，最终供应商成本 $0.0357045，首轮拒绝成本未知。总计 26 次图片提交、19 张产物，已知成本 **$0.8464965 + 7 次未知拒绝成本**。OpenRouter 成本来自 usage.cost；OpenAI 成功请求按供应商实际 token usage 与仓库当前单价计算。

实测后的策略选择：**跳过没有成功样本的同模型重试，仅增加一次严格兼容的 Flare → Nano Banana 2.1 恢复。** 老版 Nano 保留现有显式入口；本轮它更快，但费用约为 2.1 的 1.9 倍，因此没有把它设成默认恢复路径。

候选行为：

- Agent/MCP 工具增加独立的 `benignCharacterContent` 语义判断：仅当调用方事先确认请求和所有输入图均为普通、非色情、无害的虚构角色创作时设置。不能从供应商拒绝反推该判断；用户要求只用一个模型时不设置。
- NSFW 判断、单向保持逻辑、Spicy 路由、历史 `contentBlocked` 兼容逻辑均未改动。`isNsfw=true` 优先于新字段；新链路不设置 `contentBlocked`，不改写 NSFW 项目/会话状态。
- 仅对 Flare 的结构化终态拒绝尝试一个 Nano 2.1；普通错误、空输出、超时/未知结果、图片已生成后的解码/保存/结算错误不重生。备用失败也不再重试。
- 备用保留 prompt、源图、参考图及顺序、比例与分辨率；透明、GIF/SVG、JPEG/WebP 显式格式、显式质量/推理档位等无法等价满足的要求不切换。原生 PNG 可切换并检查实际输出 MIME。超过 14 张输入也不切换。
- 恢复在一次共享工具调用内完成，中间不返回失败给 Agent；现有生成中状态持续到最终结果，不额外新增界面文案。
- 新增备用提交前的独立价格/余额预检；只结算最终成功结果一次，按最终模型现有费率，不承诺固定在原模型估价内。拒绝成本保留未知，不宣称免费。270 秒总预算、取消信号和提交前剩余至少 30 秒的检查限制恢复。
- 收紧 direct OpenAI 的网络异常和 5xx：结果未知时不转 fal，避免原有供应商 fallback 误触发重复付费。

实施范围是主 Agent/CUI、共享 `editImage` 与 MCP；CLI chat 走同一 Agent，直接 MCP 调用需提供独立语义判断。现有 GUI Tips Preview 的独立 Nano → Spicy 链路未改动，未对其宣称新的恢复行为。没有新增数据库迁移、完整跨进程恢复或重连幂等合同，仍复用现有 Agent 工具守卫；备用前价格预检也沿用现有估算，最终按供应商实际 usage 结算。

### 证据与复现

- `scripts/image-copyright-benchmark.mjs`：真实比较器，POST 前写入日志；遇到结果未知即停止，不重发；拒绝后同模型与跨模型两条分支独立测试，交替分支顺序，不能相加当成一条生产链的费用。
- 本地忽略产物：`test-output/image-copyright-20261112/report.json`、`test-output/image-copyright-classic-20261112/report.json`、`test-output/image-copyright-20261112/contact-sheet.png`。
- 候选实际链路：`__tests__/characterImageRecoveryLive.test.ts`，仅 `COPYRIGHT_RECOVERY_LIVE=1` 时运行，已通过；结果位于 `test-output/image-copyright-candidate-20261112/receipt.json` 和 `output.png`。应用账本使用内存桩，供应商接口真实。
- 离线回归覆盖严格能力保持、无判断不切换、未知结果不重发、备用预检、取消/期限、最多一次切换、MCP 一次交付/扣费及 Agent NSFW `true / false / undefined` 状态隔离。
- 最终相关回归 12 个文件、211 项通过；付费 live 用例在普通回归中默认跳过，已另行显式运行通过；`tsc --noEmit --incremental false` 通过。真实产物验收仅覆盖普通文生图；参考图保持由离线测试验证，没有做真实图生图验收。NSFW 状态隔离由 Agent 工具回归验证，没有为本任务额外生成 NSFW 媒体。

敏感凭据仅通过本地 env-file 传入，不写入脚本、报告或文档。图片和原始回执留在本 worktree 的忽略目录；本报告不含访问凭据。

## 初始提案与设计对照（以下不是当前已实施合同）

以下保留实测前的备选设计，便于比较。三次提交、额外状态文案、完整尝试账本和通用后台任务均属原先提案；当前取舍与实施范围以本页上半部分为准。

### 实测前结论

可以把一次用户生图请求包装成一个有上限的恢复任务：首次生成 → 确认可恢复时同模型再生成一次 → 仍失败时尝试一个满足原始要求的备用模型。中间保持生成状态，只在全部可用路径耗尽后给出清晰结果。

但当前代码不能直接加一个 catch 后重试：错误身份和提交结果已经在多处丢失；计费只围绕单次结果设计；一些旧字段还会把内容拒绝误当成 NSFW。建议先实现结构化错误与尝试记录，再逐项开启恢复。

“版权相关拒绝”“通用审核拒绝”“供应商故障”“结果未知”应分开。普通角色创作不因出现角色名就被 Makaron 提前拒绝，也不能因为请求包含角色名，就把任何失败都推断成版权问题。仅针对用途本身允许、错误身份明确且供应商合同允许重新生成的情况开启版权恢复；不把通用安全拒绝归进该白名单。

## 代码现状与实际缺口

| 位置 | 现状 | 对本方案的影响 |
|---|---|---|
| `src/lib/model-router.ts` | 选择一个模型，只调用一次；空结果也不重试 | 统一恢复入口适合放在这一层附近，但需传入预算、状态和持久化回调 |
| `src/lib/image-model-capabilities.ts` | Auto 当前默认 Flare，按能力选模型；不是失败 fallback 链 | 保留生成前的选择逻辑，另外增加失败后的严格兼容筛选 |
| `src/lib/skills/edit-image.ts` | 普通异常被改写成 outcome unknown；类型错误主要保留字符串 | 即使上游确实返回版权原因，调用者也难以区分；不能由 Agent 读英文错误猜测 |
| `src/lib/models/openai-image26.ts` | 审核错误归为普通 `FalImage25RequestError`；无细分原因；有 direct → fal 的供应商可用性 fallback | 同一模型换供应商不等于换模型，也不能视为有独立的版权通过率 |
| `src/lib/models/fal-image25.ts` | `content_policy_violation` 变成通用文字；status/result/download 可只读重试，生成 POST 单次 | 保留只读恢复；需要保存拒绝阶段和供应商原始类型，而非仅一条 message |
| `src/lib/models/nano-banana-21.ts` | 只识别部分 `PROHIBITED_CONTENT` / `content_policy_violation`，存成 `contentBlocked: boolean` | 无法分辨 recitation、输入审核和其他拒绝；需以实际 `/images` 响应校准字段 |
| `src/lib/gemini.ts` | Google 只检查 promptFeedback.blockReason；单图 OpenRouter 路径常把失败/空输出变成 null，没有保留完整 finish reason | `IMAGE_RECITATION` 等身份可能被抹成空结果；需覆盖单图和多参考图调用 |
| `src/lib/agent-tools.ts`、`src/lib/agent.ts` | `contentBlocked` 可设置 `ctx.isNsfw` / 发出 `nsfw_detected` | 版权恢复不能复用这个旧布尔字段 |
| `src/app/api/preview/route.ts` | 非透明 Tips preview 有独立的 Nano → Spicy 路径，contentBlocked 时可走备用；未知 Nano 错误则返回失败 | 并非所有图片入口都统一遵循 router 的单次行为；需要纳入迁移，避免外层和内层各自重试 |
| Agent / MCP / Preview 计费 | 预检和结算分布于各入口，主要接收最终 result.usage | 多次尝试必须逐次记录供应商成本，不能仅保留最终成功一次的 usage |

附带风险：`openai-image26.ts` 目前将 fetch 异常解释为“请求未到 API”并允许转 fal。fetch 报错本身不能证明服务器未接受请求；这一分支需要在恢复工作中一并收紧，避免一次超时触发多次付费。

## 供应商文档能证明什么

- [Google GenerateContent FinishReason](https://ai.google.dev/api/generate-content#FinishReason) 区分 `RECITATION` / `IMAGE_RECITATION`、`SAFETY` / `IMAGE_SAFETY`、`IMAGE_PROHIBITED_CONTENT`、`NO_IMAGE` 和其他原因。它证明存在更细的接口类别，**没有证明皮卡丘一定对应其中某一种，也没有保证重试会通过**。
- [OpenRouter Errors and Debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging) 提供 `error.metadata.error_type` 等结构化错误信息，并提醒无输出也可能产生供应商成本。不能用 HTTP 200、没有图片或通用 `content_policy_violation` 推导“未收费”“纯版权”“可以重试”。该文档涵盖多个 API；Nano 2.1 使用的 `/images` 字段需单独实测，不能假设与 chat completions 完全相同。

这里提出的是工程恢复策略，不据此判断具体角色的权利许可，也不把供应商的拒绝标签当作法律结论。

## 推荐的产品策略

### 1. 默认上限：首次 + 一次同模型 + 一次备用模型

一个用户操作共享一个 `generationId`，后端统一控制全部尝试。总提交上限先设为 3，具体错误可能更早停止；不能让 router、供应商 adapter、Agent 各自套一层重试。

| 观察到的结果 | 推荐动作 |
|---|---|
| 明确的版权/recitation 相关终态，无可交付图，且该用途和重新生成符合对应供应商合同 | 最多同模型重新生成一次；若仍符合恢复条件，尝试一个严格兼容的备用模型 |
| 明确未接单的限流/暂时不可用 | 按 Retry-After 和任务剩余期限退避；可选兼容备用，计入同一个提交预算 |
| 已有任务 ID、仍在排队/运行，或 status/result/download 失败 | 继续查询/取回原任务；不重新提交生成 |
| 网络断开、超时、HTTP 5xx、响应解析失败、无任务回执 | 默认 outcome unknown；优先查询与对账，不能仅凭错误文字认定安全重发 |
| 通用内容审核、输入安全拦截、模型明确拒绝且原因无法细分 | 不进入版权重试白名单；给用户可理解的说明及调整入口 |
| 已生成图片，后续解码/保存/结算出错 | 恢复原产物的处理、保存或结算，不重新生图 |

同模型再试意味着生成新的候选，不是“取回被拦截的旧图”。保留角色和用户意图，不做角色名混淆、伪装授权或提示词绕过。确需改为原创角色时由用户选择，不能静默替换皮卡丘为别的动物。

### 2. 备用模型按合同筛选，不硬编码“版权就去 Spicy”

- 普通 RGB 文生图/参考图编辑：Flare 与 Nano Banana 2.1 可先作为对照候选，具体顺序由实测的质量、拒绝率、延迟和成本决定。目前没有证据说明哪一个生成皮卡丘更稳定。
- 同属 GPT 的 Flare → Sunburst、OpenAI direct → fal，不假设审核行为独立；供应商切换主要用于可用性恢复。
- 必须保留原图、参考图数量及顺序、角色/人物身份、要求的比例/分辨率、透明背景、PNG/GIF/SVG 等输出合同。备用模型不支持就排除，不调用会自动放宽要求的现有 planner 来掩盖差异。
- Nano / Wan / Spicy 当前不能满足原生透明背景，不能直接用于这类恢复；MJ 也不能替代精确原图编辑。不能把图生图失败降级成无参考文生图。
- 用户说“只用某模型”时视为锁定，最多在同模型的允许范围内恢复；普通 Auto 可启用预设备用链，并在结果元数据中显示实际模型。
- NSFW 是独立的内容判断，不从版权拒绝推断，也不更改后续项目的 NSFW 状态。

### 3. 中间不报错，终态如实表达

- 首次提交：`正在生成图片…`
- 同模型恢复：`这次没有生成成功，正在重新尝试…`
- 切换兼容模型：`正在尝试另一种生成方式…`
- 全部耗尽：`这次没能生成这张图片。你可以调整描述后再试。` 已确定的限制可以解释，不确定时不要声称“因为版权违法”。
- outcome unknown：`生成结果正在确认中…`，进入有期限的查询/对账；期限耗尽后提示结果暂时无法确认并保留任务恢复入口，不能无限转圈。

恢复期间不向 Agent 返回一次失败再要求它重新调用，也不提前触发 `agent.status.imageGenerationFailed`、红色错误消息或失败快照。整个操作只交付一份最终结果和一条成功时间线记录。跨 Web、CLI、MCP 保持一致。

### 4. 成本、计费和时限

建议内部自动恢复成本由平台承担，用户按最终交付一次收费，且不超过原操作已展示的费用上限；更贵备用应被跳过或提前在产品价格合同中覆盖。这里是产品建议，现有代码尚未实现该策略。

每次尝试记录真实供应商成本，即使被拒绝也不能假定免费。用户收费和平台成本分开核算；若最终计费/保存失败，需要恢复原结果，不能把已生成图片丢掉然后重新生成。

任务需要 `maxSubmissions`、`maxProviderCostUsd`、`deadline` 三个上限；累计成本未知时停止新增提交，先对账。不能简单叠加三个 240–300 秒的请求超时。若真实链路超出同步请求预算，应沿用项目可恢复任务机制，让前端查询同一任务；不要强塞进一个长时间 HTTP 连接。

用户取消、客户端重连、Agent 再次调用和页面刷新都必须复用操作 ID。把 request hash 用作一致性检查，不用于无限期复用所有同 prompt 请求，因为用户主动“再生成一张”应是新操作。

## 建议的数据合同

以下为候选接口，不是已落地实现：

```ts
type ImageFailure = {
  kind: 'copyright_related' | 'content_policy' | 'model_refusal'
    | 'transient' | 'invalid_request' | 'unknown';
  outcome: 'not_accepted' | 'running' | 'rejected'
    | 'generated' | 'unknown';
  stage: 'submission' | 'generation' | 'status' | 'result'
    | 'download' | 'decode' | 'persist' | 'billing';
  model: string;
  provider: string;
  providerRequestId?: string;
  providerCode?: string;
  finishReason?: string;
  costUsd?: number; // undefined 表示未知，不是零
  retryAfterMs?: number;
};
```

`generationId` 下的每个 attempt 保存模型、供应商、阶段、结果、回执、用量、成本和时长。错误类型由 adapter 根据可信字段构造，恢复权限由统一策略决定，不信任供应商 message 中的“请重试”等指令。界面消费稳定的状态码与本地化文案，不展示供应商原始错误。

日志不保存完整 prompt、输入/输出图片、带访问权限的 URL 或密钥；可保留内部 case ID、受控的错误码与统计。新字段与 `contentBlocked` 解耦。

## “50% 失败”时能提高多少

只有假定每次失败率都是 50%，且相互独立、所有恢复路径都可用时：

| 总尝试次数 | 至少一次成功 | 平均提交次数 |
|---|---:|---:|
| 1 | 50% | 1 |
| 2 | 75% | 1.5 |
| 3 | 87.5% | 1.75 |

公式：成功率 `1 - 0.5^n`；最多三次时平均次数 `1 + 0.5 + 0.25`。平均次数含最终仍失败的操作；供应商成本也未必每次相同。版权相关拒绝通常存在 prompt、模型、参考图维度的相关性，所以这些数字是演算，不是上线预期。

真正需要测量的是“首轮拒绝后，同模型/另一模型的条件成功率”，以及最终结果是否符合用户要求，而不是所有样本的总体通过率。

## 最小实测设计

1. 先在隔离环境补齐错误采集；如有已有失败回执，先检查回执，避免为复现重复消费。
2. 固定皮卡丘、其他宝可梦和无 IP 的原创角色对照 brief；分别覆盖文生图、带参考图编辑和透明贴纸。不要把不同需求混成一个通过率。
3. 第一轮建议 3 个 brief × 2 个兼容模型 × 2 次独立提交，最多 12 次，用于校准真实响应类别和产物质量，不能据此声称稳定概率。透明/GIF/SVG 仅进入兼容模型，不为凑矩阵强行提交。
4. 每次只提交一次、保存脱敏回执并肉眼检查可查看产物；明确审核拒绝不自动扩散测试。随后在经确认可恢复的样本上测试最多两次恢复。
5. 扩大样本后报告 first-pass、同模型条件恢复率、跨模型条件恢复率、最终可用率、p50/p95 延迟、每个成功交付的总供应商成本。分母必须区分已完成/拒绝/结果未知，成功还需质量合格。

本次没有执行上述真实生图测试，因此没有给候选模型做通过率排名。

## 实施顺序和验收

1. **错误身份和观测**：各 adapter 保留可信 finish reason、拒绝阶段、结果状态、request ID 和 usage；修复版权拒绝污染 NSFW 的风险；收紧 direct OpenAI 的未知提交 fallback。
2. **统一恢复控制**：router 附近增加可恢复 operation，先保持默认关闭，白名单错误才走受限恢复；只读恢复与付费重新提交分别计数，避免内外重复。
3. **结算和入口一致性**：Agent / MCP / Preview 接入同一结果和尝试记录；按最终实际模型结算，记录全部供应商成本；恢复中间不落失败状态。涉及提示补齐 zh、zh-Hant、ja、en。
4. **小样本真实验收**：在专用项目中确认错误分类、媒体质量、完整参考关系、取消/重连与费用上限，再决定是否启用默认恢复和发布。发布时同时核对 CLI/NPM/Skill 合同。

必需的回归场景：明确版权拒绝后一次恢复成功；连续拒绝耗尽预算；普通 safety 不扩散；未知提交不重发；已接单只查询；图片下载/保存/结算失败不重生；备用不支持透明/参考数量/格式时跳过；取消停止新增请求；并发重连不重复提交；只生成一份成功快照；用户扣费幂等一次，成本保留每一次尝试；版权失败不设置 isNsfw。

现有 `imageModelCapabilities`、`falImage25Routing`、`falImage25`、`imageCapabilityMcp` 测试验证的是当前单次提交边界。未来实施需把“所有失败均不重试”改成“已确认、白名单且受预算限制的失败才恢复”，保留未知结果和通用审核拒绝的不重发断言。
