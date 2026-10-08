# Image Model Capability 第二轮清理

2026-10-08。基于生产代码 `e0148fb0`，实现候选 `a1d443f6`。本轮清理未合入 dev、未部署；实际回归使用独立 runner 和新 CLI Chat 项目。

## 归属与删除范围

`image-model-capabilities.ts` 统一拥有模型事实、别名、优先级、NSFW、输出偏好冲突策略和 prompt mode；`model-router.ts` 负责执行生成计划与供应商调用。`image.md` 和工具说明保留创作、输入、保真与交付合同，通过生成的能力说明引用模型政策。

- 删除已被别名归一化绕过的旧 `models/openai.ts`、图片 provider chooser、旧尺寸/provider 专属测试和未使用的 backend 枚举。
- 删除图片专属 Codex subscription 执行上下文及不可达计费分支；普通图片结算仍等待成功。Agent、分析、视频与通用 MCP 的订阅能力保留。
- 删除未使用的 `fallbackPrompt`、`failedModels` 和 `skillPrompts`；保留仍被结果/调用方使用的兼容字段。
- 订阅图片比较实验移到 `scripts/subscription-image-probe.ts`；只保留研究脚本需要的 request/response helper，不再参与产品图片 runtime。
- 删除图片 guide / 工具说明里的重复模型政策和短版 Context Mode，集中到生成能力说明；详细参考顺序、人脸保留、上下文 brief 和编辑方法保留。

功能改动共 22 个文件，55 行新增、834 行删除。旧请求入口仍接受 `openai` → Flare、`qwen` → Spicy；未知/退役 ID 继续 Auto、Flare 优先。不是删除现有客户端的输入兼容。

## 图片效果保留边界

活动的 Flare/Sunburst、Nano Banana 2.1、Spicy 等适配器未修改；`openai-image-output.ts` 与 `transparent-source-canvas.ts` 虽名字含 OpenAI，仍有活动调用，保留。画布还原、alpha 处理、原图输出、Tips 独立预览配置保持原实现。整个 `cutout.md` 与生产版本逐字相同，详细人脸、构图、参考顺序及 Context Mode 保真规则未修改。

生产与候选的离线对照覆盖 13 个模型/旧别名/未知值 × 8 比例 × 5 分辨率 × 5 输入数量 × 3 背景 × 2 NSFW：15,600 份生成计划完全相同；其中 6,147 份 Flare/Nano Banana 供应商请求完全相同，包括 prompt、参考角色与顺序、尺寸、分辨率和背景参数。这验证运行时等价，不单独证明主 Agent 对任意创作内容的表达等价。

独立 runner `release:check --local`：2,179 项测试通过、1 项跳过；TypeScript、CLI smoke、生产构建和服务端 runtime packaging 通过。改动文件 ESLint 0 error（保留既有未使用 locale warning）；Agent startup contract 通过。冻结 prompt baseline 未改，contract amendments 只更新被授权去重的两个 prompt 的哈希和原因。

## CLI Chat 真实图片验收

所有真实生成使用安装的 `makaron chat` → 主 Agent → 图片工具 → 供应商 → 永久媒体 → CLI 原图；不是直接调用供应商或只测选择。验证完整图片解码、保存后重新读取、实际 billed model 和单次图片扣费。输出媒体和失败 receipt 留在本地验收报告，不提交图片到 Git。

| Case | 实际结果 | 视觉检查 |
| --- | --- | --- |
| K01 | Flare，中文 2K 商品海报，2048×1360 | 中文主标题正确；测试前缀 K01 被画入，作为受标签干扰的原始记录保留 |
| K02 | Flare，人物增强，1024×1024 | 身份、五官、姿势、服装和龙虾 pin 保留 |
| K03 | Flare，人物抠图，1024×1024 PNG，真实 alpha | 人物保留；边缘较宽柔光，质量警告 |
| K04 | Nano Banana 2.1 提交后 HTTP 400，无最终图片 | 失败；只记 Agent 费用，无自动重发或换模型，供应商成本未确认 |
| K05 | Nano Banana 2.1，方形原生 4K，4096×4096 | 樱花照片完整、解码通过 |
| K06 | Spicy 图片编辑，1024×1024；NSFW 标志与 8:1/4K/透明冲突 | 茶壶保留、红色丝绸背景；用安全内容测试该路由，不代表成人内容验收 |
| B03 | 当前生产同图抠图，Flare，1024×1024 PNG | 与候选相似的边缘柔光；保真通过，抠图质量警告 |
| A03 | 最终候选同图抠图，Flare，1024×1024 PNG | 保真与生产对照相近，真实透明像素；抠图质量警告 |
| A04 | 使用已能读取的参考 URL 的独立新请求，Nano Banana 2.1，2928×352 | V 在左侧、右侧渐变留白、无文字，原生超宽交付通过 |
| A01 | 无用例标签前缀的中文 2K 海报，Flare，2048×1360 | 中文标题与 MAKARON 正确，仅所需两段文字，层级与留白通过 |

共 10 次独立 CLI Chat 请求（含 1 次生产对照），9 次有最终图片、1 次失败；Makaron 共扣 72 credits。最终六类场景采用 A01/K02/A03/A04/K05/K06，全部交付可重新读取的原图，五类视觉通过、透明抠图边缘质量保留警告。并非把失败请求重复提交后算通过：K04 与原始 K01 单独保留，A04/A01 是条件修正后的新实验。

A04 成功不证明 K04 的 HTTP 400 根因。两次输入提交方式/可读取时机不同，保留首次失败；本轮没有改 provider 或绕过参考图。B03/A03 的可见效果接近，不能推导所有随机输出逐像素等价。两图 alpha 均有 47 万以上完全透明像素和 51 万以上近不透明像素；最大 alpha 为 254，不能把“全部像素 alpha<255”当作主体全透明。

透明边缘光晕是本轮生产对照也出现的质量问题，未通过重绘或改抠图合同掩盖；此前分辨率专项也记录过该问题。本轮结论是保守清理与已测场景未观察到效果退化，不声称所有历史 case 或全部生产链路重新通过。
