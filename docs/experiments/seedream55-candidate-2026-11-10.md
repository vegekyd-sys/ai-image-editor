# Seedream 5.5 候选接入与 Makaron mascot 对照

日期：2026-11-10（中国时间）；候选：B-20261109-seedream55。

**结论：`code_ready`，Seedream 真实验证受阻。不能判断 Seedream 的质量、速度、未编辑区保持或实付费用是否优于 GPT。** 当前缺少 WaveSpeed API 凭据；现有 fal 完整目录没有 5.5。默认保持 GPT Image 2.6 Flare。本次没有合并、push、部署或 NPM 发布。

## 交付与边界

- [并排评估页](../../evidence/seedream55-candidate/comparison.html)、[并排进度图](../../evidence/seedream55-candidate/comparison-progress.png)。Seedream 列明确留空，不能当作真实 A/B。
- [冻结测试集](../../evidence/seedream55-candidate/manifest.json)、[指标](../../evidence/seedream55-candidate/measurements.json)、[回执/费用汇总](../../evidence/seedream55-candidate/summary.json)。
- [完整画面](../../evidence/seedream55-candidate/full-scene-gpt-low.png)、[原始透明 PNG](../../evidence/seedream55-candidate/native-alpha-gpt-low.png)、[局部编辑结果](../../evidence/seedream55-candidate/local-hat-edit-gpt-low.png)。
- [固定编辑原图](../../evidence/seedream55-candidate/fixed-edit-source.png)与 GPT 完整画面样本字节相同；未来 Seedream 必须使用这一份原图，不能另用自己的生图。
- [选择器截图](../../evidence/seedream55-candidate/selector-zh.png)来自当前分支真实 ModelSelector 组件的隔离页面，不是完整候选应用的端到端验收。

## 当前代码

基线已核对为当时当前 dev：`c10703090fa4b8341c54485469b4add4671a1bc3`。工作树 `/Users/tianyicai/.codex/worktrees/a0f3/ai-image-editor`；分支 `codex/seedream55-candidate-b20261109`。业务改动仅在该 managed worktree。

| 项目 | 候选合同 |
| --- | --- |
| Makaron model ID | `seedream-5.5`，只接受显式选择，不加入 Auto |
| 供应商 | WaveSpeed |
| 精确供应商 ID | 无输入 `bytedance/seedream-v5.5`；有任意输入 `bytedance/seedream-v5.5/edit` |
| 输入 | 最多 10 张，包括编辑原图；保留顺序与原始提示词 |
| 输出 | PNG 默认、JPEG；透明只允许原生 PNG；解码并检查真实 alpha |
| 档位 | 1K / 1.5K / 2K / 3K；默认 1K；档位不承诺精确数学像素尺寸 |
| 不支持 | GPT quality/reasoning、WebP/GIF/SVG、4K；显式候选冲突提前失败，不静默换模型 |
| 编辑画布 | 省略比例时跟随第一张输入的比例，不保证像素一一保持 |
| 重试/恢复 | 一次付费 POST；接收任务后先保存项目私有 workspace 回执再轮询；失败/超时携带 task ID，不重发、不切 provider |
| 只读查询 | `npx tsx scripts/seedream55-query.ts <taskId> --env <私有 env 文件>`，仅 GET 已有任务，不生成、不结算、不重复发布 |
| 计费 | 精确的 active `seedream-5.5` token_rates 行提供 markup；公开固定美元价格进入现有 providerCostUsd → credits 路径；没有该行时生成前阻止 |
| UI / Agent / CLI | 注册选择器和四语文案、动态能力表、Agent 工具、MCP、CLI 显式 model/档位/输出格式；保存 provider 与精确 endpoint 元数据 |

按既有模型机制使用共享基础设施，没有新建数据库或 Docker。未写 Vercel 变量、共享 Preview alias、供应商凭据或价格表。加入读取第三方图片时继续使用已有安全读取器。计费复用了共享美元转 credits 函数，并修正浮点整数边界：`$0.070 × 2` 应为 14 credits，不能因二进制浮点误差变成 15。

注意：目前 live 服务尚未包含这个候选 ID，不能直接向线上旧服务发送 `seedream-5.5` 来冒充候选验证；旧服务可能按未知 ID 走 Auto。

## 可用渠道与价格复核

截至本轮现场检查，fal 公开目录分页共 1,413 个唯一模型，12 个 Seedream 相关 ID；最高标称 5.0，未发现 5.5。证据见 [fal 目录审计](../../evidence/seedream55-candidate/fal-catalog-audit.json)。这只说明当时这份公开目录，不推断所有渠道永远不可用。已有环境仅复用并检查变量名，未发现 `WAVESPEED_API_KEY`，没有输出密钥、新注册或采购。

[WaveSpeed 生成文档](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v5.5)与[编辑文档](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v5.5-edit)的公开价格：

| 输出档位 | 无输入 | 加 1 张输入 | 加 2 张输入 |
| --- | ---: | ---: | ---: |
| 1K | $0.020 | $0.028 | $0.036 |
| 1.5K | $0.020 | $0.028 | $0.036 |
| 2K | $0.027 | $0.035 | $0.043 |
| 3K | $0.054 | $0.062 | $0.070 |

每张输入额外 $0.008。以上为公开报价及代码合同，**不是本次 Seedream 实付**。PNG 原生透明、多图和保持编辑区外内容是供应商宣称，未被本次真实验收。

## GPT 真实对照组

通过已安装的真实 `makaron chat` 在一个专用测试项目内完成三次；每次恰好一个 generate_image，无重试。三次均为 `gpt-image-2.6-flare`，实际 provider 为 OpenAI 直连，非 fal。依据为持久化 generation ID 与 `openai_direct_spend.request_id` 精确匹配；该表记录 provider usage 计算成本，不等于官方发票对账。

主要对照统一为 `imageQuality=low`、`imageReasoningEffort=high`、PNG、1:1、1K，实际输出均 1024×1024。参考图固定为 mascot Skill 指定的 `makaron-spark-pixel-wizard-concepts.png`，源 SHA-256 见 summary；Pixel Wizard 使用紫色泡泡幽灵、像素脸、软巫师帽，与从产品卡片涌出的粉青 Spark 全身互动，无魔杖默认构图。三次 actual tool_call 提示词与冻结 manifest 完全相同。

| 类别 | CLI 全链路¹ | 服务端 run | 图像工具² | 供应商图片成本 | 产品扣费³ |
| --- | ---: | ---: | ---: | ---: | ---: |
| 完整画面 | 33.734s | 29.079s | 10.415s | $0.038303 | 9（图片 8 + Agent 1） |
| 原生透明素材 | 63.646s | 59.386s | 42.748s | $0.038398 | 9（图片 8 + Agent 1） |
| 固定原图帽子变色 | 25.565s | 21.636s | 8.408s | $0.033722 | 8（图片 7 + Agent 1） |

¹ 本机 CLI 启动、上传/项目准备至服务端完成时间，包含 Agent 编排；不包含稍后人工查询及下载时间，跨机器时间存在时钟误差。² tool_call 至 tool_result，包含图片链路准备、获取输出及产品扣费，并非纯模型推理。³ 1 credit = $0.01，含 markup 和取整。供应商成本与产品 credits 不能相加。

每类只有一个样本，不能据此推断 P50/P95、稳定性或普遍质量。Seedream 同档位 + 一张输入报价 $0.028，在这三张样本的图片供应商成本上分别低约 26.9%、27.1%、17.0%；其真实性能、质量与失败率未知，因此不能据此替换默认。未补 medium，以免在 Seedream 仍无法生成时增加无比较价值的开销。

## 实际目视与指标

完整画面：产品卡片是主体；角色完整，身体攀住 Spark，紫色体积、像素表情和软帽辨识清楚，光照与场景一致。这是单样本的目视判断。

透明素材：[深底](../../evidence/seedream55-candidate/qa/alpha-dark.png) / [浅底](../../evidence/seedream55-candidate/qa/alpha-light.png)与[边缘放大](../../evidence/seedream55-candidate/qa/alpha-edge-light.png)。原始文件为 RGBA，alpha 范围 0–254，61.193% 像素为 0，38.807% 为 1–254；其中 12.042% 在 1–250，26.765% 在 251–254。不能把所有非 255 像素都理解为明显透光材质。深浅底上未见实色方形底或明显黑白描边；光带的玻璃感成立，幽灵身体仍较厚重。角色占画面比重偏大、产品卡片偏小，不如完整画面符合“产品主体”的营销构图。只做确定性叠底诊断，未抠图、未改原始 PNG。

局部编辑：源图固定为完整画面样本，真实输入图片重新下载后 SHA-256 与 fixed-edit-source 完全相同。只要求帽子变暖橙，结果帽色符合，脸、卡片文字和构图肉眼较稳定。使用固定帽子矩形 `[710,290,989,477]`（右/下边界不含）排除目标区域，不做配准、缩放或调色：

- 帽子外 RGB MAE：2.6228/255；RMSE：5.1846/255。
- 帽子外完全相同像素：1.7448%；最大通道差 ≤8：87.4171%；最大通道差 >16：3.1601%。
- 帽子内 MAE：28.7738/255。

[原图 / 结果 / 4 倍绝对差异](../../evidence/seedream55-candidate/qa/local-edit-comparison.png)说明其视觉保持较好，但并非像素锁定。矩形不是精确帽子分割，边缘与其他元素可能影响统计；不把该数字当作模型通用保持率。

## 保存、重开、隐私与失败

三张结果均由真实 Agent 保存为 snapshot；随后重新调用 `makaron project media`，三个 snapshot ID 均存在，并成功下载、解码。保存后的 quality/reasoning/prompt、PNG 格式及透明 metadata 也独立只读复核；编辑的实际输入字节已核对。Seedream 未有保存/重开实证。

专用测试项目新建时发现 CLI 默认公开，已仅将本次项目设为私有并读回验证；未更改既有项目或共享权限。原始 API/数据库回执含私有项目媒体 URL，留在本机临时证据目录，不加入代码提交；对外可审查汇总不含密钥或媒体访问 URL。

本次真实付费图片调用 3 次，全部完成；Seedream 0 次。故障记录：首个 CLI 尝试沿用旧认证文件的 localhost:3000 地址，连接被拒，尚未创建项目或调用模型；显式指定实际服务后才提交。一次 Python 下载已有 CDN 图片返回 403，换现有 Node fetch 只读下载后 200，没有重新生成。一次只读元数据查询使用旧列名返回 42703，按当前持久化代码改读 `metadata`。单测 fixture 的旧 mock/旧 help 断言不兼容已修正，未以测试失败为理由触发付费重试。

## 验证与费用

- 12 个相关 Vitest 文件：252 项通过，覆盖模型/格式/alpha、单次提交、回执先保存、失败恢复、原图顺序、Agent/MCP 预检与结算、四语选择器和既有默认路由。
- TypeScript `tsc --noEmit`、改动相关 ESLint、UI i18n guard 通过。ESLint 保留一个未改动工具参数 `locale` 的既有 unused warning，0 errors。
- CLI smoke + upload 测试通过，包含 Seedream 显式 model、1.5K、PNG、transparent 参数传输。
- `build:skill-sync` 与 `check:skill-sync` 通过；受控自然语言路由预检 3/3，所有非 read_file 工具被拦截，媒体操作 0。
- 右侧内置浏览器验证当前分支真实 ModelSelector：打开列表 → Seedream 5.5 → 选择状态与文案同步，Auto 关闭，无相关控制台错误。
- 共享 runner 有未提交改动，未覆盖/切换它，未进行 Next 完整应用构建或 Seedream 全链路验证。

费用分层：图片供应商 usage 账本 $0.110423；真实 CLI 产品扣费 26 credits = $0.26，含三个 Agent 各 1 credit。本地路由预检按实际 tokens 与当前价率估算 $0.015951。用产品扣费加本地预检作保守 session 记账为 **$0.275951**，低于 $5 目标及 $10 总上限；不把图片供应商成本再次相加。三个 chat Agent 供应商估算 $0.013481 已在产品侧扣费覆盖，不另加。未查询/购买余额，未获得供应商官方账单对账。

## 仍待验收

使用既有获授权 WaveSpeed 凭据，并在隔离运行配置中具备对应精确价格行后，运行完全相同 manifest 的三类 Seedream 样本；记录实际 model/provider、像素尺寸、alpha、端到端时间、输出费用及失败。还需 Seedream 自身保存重开、真实透明边缘和未编辑区保持检查，必要时再补对等 medium 与多次速度样本。当前不应合并、部署、改默认或发布 CLI。
