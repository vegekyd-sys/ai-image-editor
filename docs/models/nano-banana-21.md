# Nano Banana 2.1 接入与供应商对比

Nano Banana 2.1 已在独立 worktree 接入 Makaron，优先使用 OpenRouter Image API。1K 商品图和 2K 编辑的真实费用明显低于 fal 公布的 $0.08 基础单价。候选版本的普通图片与 Tips 图片预览默认切为 2.1；保留经典 Nano Banana 2 手动选项，Tips 文案继续使用旧模型。生产应用尚未发布。

核对日期为 2026 年 10 月 7 日（北京时间）。Google 模型卡记录发布日为 10 月 6 日。

## 价格和供应商选择

| 项目 | OpenRouter | fal |
| --- | --- | --- |
| 模型 | `google/gemini-nano-banana-2.1` | `fal-ai/nano-banana-2.1`，编辑加 `/edit` |
| 图片输出基础价格 | $30 / 百万图片 token | $0.08 / 张 |
| 1K 图片输出估算 | $0.0336 | 公开基础价 $0.08 |
| 2K 图片输出估算 | $0.0504 | 高分辨率的实际计费倍率需按供应商账单确认 |
| 4K 图片输出估算 | $0.0756 | 同上 |
| 输入 | $1.50 / 百万 token | 以 endpoint 的图片计费合同为准 |
| 文本输出与推理 | $7.50 / 百万 token | 同上 |

OpenRouter 的三个图片输出估算来自 Google Gemini API 价格表与 OpenRouter 实时 token 单价，不包括输入、文本、推理、搜索或账户充值手续费。1K 输出基础成本比 fal 的公开基础价低约 58%；这不是整次请求的固定折扣。4K、多参考图或复杂推理会缩小价差。Google Cloud 模型卡对 4K token 数与 Gemini API 价格表存在差异，4K 以供应商实际 usage.cost 结算，未据估算承诺固定用户价格。

Makaron 最终扣费使用 OpenRouter 返回的实际 USD 成本和数据库中的 markup。共享数据库已仅新增该模型的定价行，沿用已有 Nano Banana 系列的 2 倍 markup。前置余额检查是按输出与参考图计算的估算，最终账单包含实际输入与额外输出。

选择 OpenRouter 的依据是成本和当前接入验证。fal 有独立文生图/编辑 endpoint 和队列，并在编辑 schema 中暴露 video/PDF 等输入；本次没有做两家速度、稳定性或画质的对照实验，不据此评价谁的服务整体更强。

来源：[OpenRouter 模型和价格](https://openrouter.ai/google/gemini-nano-banana-2.1)、[OpenRouter 实时目录](https://openrouter.ai/api/v1/models)、[fal 模型合同](https://fal.ai/models/fal-ai/nano-banana-2.1/llms.txt)、[fal 编辑合同](https://fal.ai/models/fal-ai/nano-banana-2.1/edit/llms.txt)、[Google Gemini API 价格](https://ai.google.dev/gemini-api/docs/pricing)。

## 能力变化和 Makaron 用法

| 能力更新 | 产品用法 | 当前状态 |
| --- | --- | --- |
| 写实画质、材质、光照和商品换场景增强 | 保留商品造型与标签，更换广告场景 | 商品与换场景样例已实测 |
| 文字渲染与信息图布局增强 | 中文商品文案、多语言广告、知识卡片 | 中文短文案已实测；复杂排版与多语言需专项评价 |
| 多轮人物一致性增强，多图融合最多 14 张 | 分镜、同角色系列图片、商品与品牌素材合成 | 参数和多图角色说明已接通；没有人物一致性 A/B 结论 |
| 2K/4K 全景平铺伪影修复，支持 4:1/1:4/8:1/1:8 | 横幅、长图、超宽广告背景 | 2K 4:1 实测成功；4K 未做真实生成验收 |
| 蒙版与涂鸦引导编辑增强 | 用户在图上标注修改区域，让 Agent 描述修改与保留内容 | 可把标注图作为参考图传入；没有独立蒙版参数或新绘制 UI |
| Google 搜索 grounding，Video/PDF 上下文输入 | 最新信息视觉化、视频分镜和 PDF 转知识图 | 上游能力；本次图片接口没有开放这些输入与搜索参数 |

1K/2K/4K、多参考图与搜索并非都始于 2.1；升级重点是质量、遵循指令、一致性和全景伪影修复。Google 模型卡写出最多 4 个角色与 10 个物体的保真支持，不等于每次生成都能严格保持身份。

来源：[Google 模型卡](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1)、[Google Cloud 模型卡](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1)、[OpenRouter 模型说明](https://openrouter.ai/google/gemini-nano-banana-2.1)。

## 接入和使用

图片模型选择器增加 Nano Banana 2.1，四种语言文案齐全。Agent/CUI 使用 `model: gemini-2.1`，默认 1K；明确要求更高分辨率时可传 `imageResolution: 2K` 或 `4K`。参考图包括编辑底图，总数不超过 14 张。

```bash
node packages/makaron-cli/bin/makaron.mjs edit \
  --image product.jpg --image-model gemini-2.1 \
  --image-resolution 2K --aspect 4:1 --out banner.jpg \
  "保留商品形状与标签，放到湖边石台上，右侧留出文案空间"
```

CLI 代码已更新，但没有发布新的 npm 版本。GUI 选择器负责选模型，2K/4K 通过对话或 CLI/MCP 参数请求。本次没有新增 GUI 分辨率按钮。

供应商调用使用 `/api/v1/images`。OpenRouter 的聊天接口对 2.1 的全景比例仍有旧模型校验，实际返回 HTTP 400，声明只有旧 Flash Preview 可用 4:1；Image API 的实时能力目录正确列出 2.1 的全景比例，真实调用成功。不要把该模型接回聊天接口来处理全景图片。

2.1 单次只发一个付费 POST，结果不明时不自动重发或换模型，也不丢弃参考图降级。明确选择 2.1 时不换模型；自动路由收到明确审核拒绝后才允许调用 Spicy。只有完整图片通过解码且供应商成本有效，才交给现有持久化/计费链路。透明背景沿用现有 GPT Image 2.5 路由。返回的是栅格图，不承担 run_code 的 editable 合同。Image API 没有开放本次可验证的 thinking 控制与像素流式输出。

## 实测结果

| 测试 | 实际尺寸 | 完整结果耗时 | 供应商费用 |
| --- | --- | --- | --- |
| 1K 中文商品图 | 1024 × 1024 | 11.7 秒 | $0.0355965 |
| 2K 湖边换场景 | 2752 × 1536 | 23.2 秒 | $0.054225 |
| 2K 4:1 Image API 编辑 | 4128 × 1024 | 23.4 秒 | $0.0543525 |
| 本地 Makaron MCP 2K 4:1 编辑 | 4128 × 1024 | 23.8 秒 | $0.0543465 |

所有样例均完整解码并查看。瓶身的“向前一步”文字正确；换场景保留瓶盖与瓶身主要造型。这是一组功能验证样例，不能推导 P95 或胜过旧模型的整体质量结论。前两次成功样例用于初始聊天接口调查，后两次成功全景样例使用最终采用的 Image API。另有两次聊天接口的全景请求被 HTTP 400 拒绝，未自动重发。

## 验证范围

93 项相关测试通过，覆盖真实共享 Skill 与 MCP HTTP 路由、费用与来源归因、缺少定价或余额不足时不提交、失败不重试、图片完整解码、模型选择与旧模型路由回归。CLI smoke 覆盖新模型、4K/全景参数传输及错误分辨率的前置拒绝。TypeScript、修改文件的 ESLint、i18n 和 Agent startup 检查通过；ESLint 有一处既存未使用 locale 参数警告。

生产构建通过，CRC32C 与 FFmpeg 打包检查通过。没有合并 dev/main，没有生产部署，也没有完整登录编辑器的保存/重开验收。

浏览器验证使用 Playwright（Browser plugin 不可用），桌面 1280 × 900，手机 390 × 844。本地临时 QA 页面挂载的是实际 ModelSelector；该临时页面已从最终源代码移除。

| 浏览器检查 | 结果 |
| --- | --- |
| 页面身份与有效内容 | 通过，临时组件 QA 页面 |
| 空白页与框架错误 overlay | 无 |
| 组件 QA 控制台 | 无相关 error/warn；未登录首页另有既存 subscription-usage 401 |
| 模型选择交互 | 默认 auto；打开图片列表，选择 2.1，状态变为 gemini-2.1 |
| 截图 | 桌面与手机界面均已查看 |
| 真实业务调用 | 本地 HTTP MCP 返回实际全景图片；使用 legacy 开发认证，用户扣费由集成测试验证 |

产物保存在此 worktree 的 `test-results/nano-banana-21/`，组件截图在 `output/playwright/`。这些本地生成产物不进入源码提交。

复现命令为 `npx vitest run` 加上述相关测试文件、`npm run test:cli`、`npx tsc --noEmit`、`npm run check:i18n-ui`、`npm run check:agent-startup`、`npx next build --webpack` 和 `node scripts/check-server-runtime.mjs`。浏览器路径为本地 QA 页面 → 打开图片模型列表 → 选择 Nano Banana 2.1 → 确认 `gemini-2.1`，再检查桌面与手机尺寸。

![桌面模型选择组件](../../output/playwright/nano-banana-21-selector-desktop.png)
![手机模型选择组件](../../output/playwright/nano-banana-21-selector-mobile.png)

## 默认模型替换与 Tips 文案对比（2026-10-07）

候选版本的普通图片自动路由与 Creative/Wild Tips 图片预览默认使用 2.1。Nano Banana 2 (`gemini`) 与 Lite (`gemini-lite`) 保留手动选择，Enhance/NSFW 的 Spicy 首选和透明图片的 Flare 合同保留。GUI 关闭自动选择后初始选中 2.1；Agent 与 MCP 余额预检按实际首选模型及可到达的审核兜底报价，交付前按供应商实际成本扣费。显式旧模型仍使用旧 Nano Banana 2，不被新自动路由覆盖。

Tips 图片 10 组：Lite 成功 8/10，成功请求均值 14.3 秒；2.1 成功 10/10，均值 19.6 秒（慢约 37%）。均为完整图片返回耗时，不是首包时间；不能推导长期 P95。

Tips 文案另做 12 组同图同提示词 A/B（每请求 2 条，覆盖 Creative/Wild、Enhance/Captions、四语言及去重）。使用实际 `streamTipsByCategory` 产品路径，明确 text-only，高/低思考沿用类别默认。总并发 4，每格只允许一个真实付费请求；缺 editPrompt 的补写请求被抑制。因此下表是首轮生成能力，不等于带补写的最终产品成功率。

| 文案模型 | 首轮两条完整 Tips | 平均首轮完成时间 | 平均供应商费用 |
| --- | --- | --- | --- |
| 旧 Nano Banana 2 | 4/12 | 9.0 秒 | $0.00589 |
| Nano Banana 2.1 | 8/12 | 24.1 秒 | $0.04550 |

2.1 文案成本约 7.7 倍、耗时约 2.7 倍，仍有 4/12 组缺完整编辑指令；旧模型也有首轮缺字段问题。2.1 未达到直接替换文案主模型的速度/成本/合同稳定性标准，暂保留旧模型。可用 `TIPS_MODEL` 独立配置后续文案实验，图片模型不跟着变。

脚本：`docs/spikes/nano-banana-21-tips-text-ab.cjs`；原始证据：`test-results/nano-banana-21-tips-text-ab-v1/{nb2,nb21,summary}.json`。实验已报告总费用 $0.6166225，没有付费补写。文案标签与英文 editPrompt 已检查；未作长期质量盲评或 Tips 文案驱动生成的端到端胜率结论。
