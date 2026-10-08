# 图片模型能力统一与回归清单

2026-10-08：先列验收 case，再实现、逐项回归。此文档记录候选合同，不代表已发布。

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
| R16 | MCP / CLI：省略模型、显式模型、比例/分辨率/NSFW 参数 | 与共享 Skill 同路由；stdio 路径先读成本图像再计输入 |
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
