# Makaron Midjourney V8.2 接入与产品方案

Makaron 应把 Midjourney 用在视觉探索和系列风格，再衔接现有精修、排版和视频能力。第一步采用 EvoLink 的 `mj-v8.2`：真实账号已经能提交并完成生图，接入候选保留整批图片、任务恢复和供应商费用。当前候选已接入 Makaron 正常模型选择器、Agent `generate_image`、共享图片 Skill、MCP 和用户计费，并启动本地编辑器供试用。尚未合并或部署生产。

## 版本与渠道

截至 2026 年 10 月 9 日，Midjourney 官网默认版本是 V8.2；新的 Edit Model 支持自然语言编辑和最多四张编辑参考图。[Midjourney 版本](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version)、[Edit Model](https://docs.midjourney.com/hc/en-us/articles/48495453462797-Edit-Model)。

| 渠道 | 本次判断 | 接入选择 |
| --- | --- | --- |
| EvoLink | 已有本地凭据；V8.2 生图真实请求成功；统一异步任务 API | 首选验证渠道 |
| Atlas Cloud 悠船 V8.2 | 文档提供生图、图生图、风格参考等接口；本次未做真实调用或账户报价 | 备选渠道，不自动接管失败请求 |
| PiAPI | 官网及接口文档明确 MJ 服务停止 | 不采用旧 MJ 接口 |
| Midjourney 官网 | 官网完整能力不能直接等同于聚合 API 能力 | 以所接渠道的合同实现 |

来源：[EvoLink V8.2](https://evolink.ai/midjourney-v8-2)、[Atlas 接口](https://www.atlascloud.ai/docs/more-models/youchuan/v8.2-text-to-image/generateImage)、[PiAPI 服务状态](https://piapi.ai/id/midjourney-api)。EvoLink 自述渠道获官方授权；这并非本次独立核验的授权结论。Midjourney 的[社区规则](https://docs.midjourney.com/hc/en-us/articles/32013696484109-Community-Guidelines)限制未经授权的自动化和服务转售，正式商业上线需核对所用渠道的授权及商用合同。

## 当前 API 的实际边界

EvoLink 的最新[接口合同](https://evolink.ai/api-reference/mj-v8.2/mj-v8.2-API-Reference.md)明确：新的指令式 `--edit` 尚未开放；`mj-v8.2-edit` 是画布编辑接口。其[模型页](https://evolink.ai/midjourney-v8-2)还说明，部分 Variation、Remix、画布编辑由 V7 引擎渲染。因此这些接口不能在 Makaron 中统一宣传成 V8.2 精准编辑。

| 能力 | 第一阶段产品合同 |
| --- | --- |
| Fast 生图 | 一次任务通常返回四张；审核可能减少返回数 |
| Draft | 渠道承诺一次返回 24 张小稿；与 HD 互斥。与官网版本表存在差异，按真实渠道结果单独验收 |
| HD | 生图质量字段 `quality=hd`；是重生成而非保证逐像素保持选中图 |
| 风格参考 | `sref` 控制色彩、材质和光影，不承诺人物身份或产品细节一致 |
| 个性化 | 不支持直接迁移用户官网 profile；现阶段保存风格参考与参数 |
| 输入图片 | 公开可访问的图片 URL；base64 需要先存储。需验证供应商能在约十秒内取到图片 |

官网 [Style Reference](https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference)与渠道[提示词合同](https://evolink.ai/en/api-manual/image-series/midjourney/midjourney-v8-2-prompt-guide.md)分别定义风格参考和实际参数。不要将内容参考图、风格参考图与 Edit Model 参考图混为一谈。

## 最值得做的用户流程

### 视觉方向探索

用户说“给这个品牌找一个更高级的视觉方向”，Agent 理解用途、受众和约束后，先给四张可单独选择的候选图。选中图才成为后续编辑基础，其余候选保留在同一组。请求多个明确风格方向时分别标明方向与费用，不能把一组随机候选当成四个已规划方向。

普通探索先 Fast。只有用户明确需要大量小稿时使用 Draft。当前候选为复用永久保存和编辑路径，会将全部候选保存为普通时间线 snapshot，并在同一条聊天消息中显示网格；后续可把 24 张小稿改为可折叠的专用候选组，减少时间线占用。生产指标应看“用户选中并继续使用的比例”和“得到可用方向的总成本”。

### 风格成为可复用资产

用户选中喜欢的图后，提供“沿用这个风格”。保存参考图、`sref`、`sw`、模型版本与生成参数，后续更换内容仍使用同一风格。适合品牌系列插画、社交素材、广告镜头和封面。不要承诺这是官网 Personalization，也不要承诺同一角色、商品或构图会保持。

### 从主视觉到成品

Midjourney 生成氛围、场景、光影和视觉方向；需要明确文字、Logo、商品规格或局部修改时，选中图进入现有 Flare / Nano Banana 编辑链路。用户需要可编辑版式时，使用现有 `run_code` design 流程把背景与文字分开。视频项目用选中图建立关键帧，再交给 Seedance / H3；检查最终镜头的风格与身份连续性。

这三个流程的组合价值是“探索 → 选中 → 精修 → 系列素材 / 排版 / 视频”。不建议未经评测便把 MJ 改成所有图片请求的默认模型。

## 接入候选代码

`src/lib/midjourney.ts` 提供 `buildMidjourneyRequest`、`MidjourneyClient.submit` 和 `MidjourneyClient.get`。输入使用结构化参数，拒绝无效字段、未经支持的原生参数、Draft + HD 和错误比例。提交只发一次 POST；网络超时保留未知状态，不自动重试或切换模型。查询只读同一个任务，返回完整候选数组、供应商费用和实际模型。

`tools/midjourney-trial.ts` 提供内部试验入口。提交前以排他方式建立本地意图记录，重复使用同一结果目录会拒绝再次提交。先保存任务 ID，再查询；下载整批图片并完整解码，生成 contact sheet。试验只加载 `EVOLINK_API_KEY`，不使用生产数据库或扣减 Makaron 用户积分。

```bash
# request.json 示例
# {"prompt":"A glass planet above clay hills.","aspectRatio":"16:9","stylize":350}

node --import tsx tools/midjourney-trial.ts submit test-results/mj/example request.json --env /absolute/path/to/.env.local
node --import tsx tools/midjourney-trial.ts status test-results/mj/example --env /absolute/path/to/.env.local
node --import tsx tools/midjourney-trial.ts download test-results/mj/example --env /absolute/path/to/.env.local
npx vitest run __tests__/midjourney.test.ts
```

参考 URL、供应商结果链接与本地收据保留在忽略的 `test-results/`，不加入共享文档或 Git。输出 URL 会过期，正式项目必须保存到 Makaron 永久存储。

## 已接入的本地产品路径

- 正常编辑器模型选择器选择 **Midjourney V8.2**，在聊天中输入自然语言；也可在 Auto 下明确说“用 Midjourney”。主 Agent 传递原始需求，适配层用 GPT-6 Luna 整理画面描述、排除项和比例，不要求用户学习原生参数。
- `src/lib/models/midjourney.ts` 注册为明确选择的批次模型。共享返回合同增加 `images`，保留首张 `image` 的兼容性；Agent 把整批结果加入 Media Index，DualWriter 将每张上传到永久存储并关联同一消息。聊天展示完整候选网格，可选择确切 snapshot，在画布查看、保存、继续使用。
- `midjourney.speed=draft` 为 24 张小稿；`midjourney.quality=hd` / `imageResolution=2K` 为四张原生 HD。尺寸为渠道实际画布，不保证用户指定像素。标准比例 1:14–14:1，HD 1:4–4:1；Draft 与 HD 互斥。
- `style_reference_media_indices` 从现有时间线取永久图片作为 sref；普通 `reference_media_indices` 是松散内容参考，不保证身份/精确布局。源图编辑、透明输出、NSFW、4K 和越界比例在 MJ 付费提交前拒绝，不偷偷换模型。
- 接受后将任务 ID、原始需求和准备后的请求写入项目 workspace 的 `midjourney/` 收据，再轮询同一任务。付费 POST 仅一次；查询可恢复短暂读错误。若十分钟查询预算或下载失败，保留 task ID，告知不得重发。当前仍由 Agent 工具等待生成完成；**没有专用的独立图片任务队列或用户自助恢复按钮**，不能宣传成完整的二十分钟异步恢复产品。
- 已完成任务若因渠道审核返回少于预期的图片，保留所有可用候选、说明实际数量并按实际供应商费用结算。解码失败不发布损坏图片，也不重新生成。
- DB `token_rates` 新增 `mj-v8.2` 独立费用项，2 倍加价；一次预检，一次按 MJ 批次费用加 Prompt 准备的实际费用结算，不能按候选数量重复扣费。主 Agent 本身的文字使用费用仍独立结算。注册脚本只新增价格行，不改已有模型价格。

内部 `/midjourney` 页仅开发模式且显式启用时可访问，保留作研发验收入口；给用户的入口是正常 `/projects` 编辑器。默认图片 Auto 保持原优先级，没有改为 MJ。

## 后续正式发布前的增强

以下是专用异步候选组的产品升级，不代表本地编辑器已有这些能力。

1. 建立独立的图片任务及候选组合同。提交前记录用户、项目、run、供应商、请求与状态；提交后先持久化 task ID。结果查询验证所有权，避免跨用户取回任务。
2. Agent 提交后及时返回任务状态；后台轮询处理最长约 20 分钟的任务。网页关闭、重开项目或 Agent 回合结束后能继续取回同一任务。未知提交结果必须人工对账，不能自动重发。
3. 完成后先持久化全部候选和缩略图，再发布一个候选组。每张保留候选编号、模型版本和来源任务；用户选中后才生成普通编辑 snapshot。
4. 四语补齐模型说明、探索状态、候选选择、沿用风格、HD、错误与无障碍文案；支持 iOS 的选择和后续编辑手势。
5. 按一次供应商任务预检及结算。不要按四张 / 24 张输出重复扣费；部分审核仍按渠道实际费用结算。重复回调、轮询和重新打开不能重复扣费。下载失败只恢复下载。
6. 通过真实 Web / Agent / MCP 提交、关闭重开、选图精修、永久保存与积分流水验收，再按项目 release 流程部署。Draft、HD、风格参考分别保留验收结果。

## 成本与验收

渠道页面公布 Fast Standard 约 $0.08／请求，Fast HD 约 $0.12／请求；这是供应商费用，不是 Makaron 用户售价。只有四张均返回时，平均单张费用才分别是 $0.02 与 $0.03。Draft 与 Fast Standard 同价，仍按一笔任务结算。[EvoLink 价格](https://evolink.ai/midjourney-v8-2)。

本次实测原始收据和下载产物位于 `test-results/midjourney-v82/`。正式验收关注选中率、精修后可用率、系列风格连续性、端到端耗时和一笔任务的实际总费用。供应商模型标签和成功状态不能单独证明质量；需要完整下载与视觉检查。

四笔真实任务均由响应标记为 `mj-v8.2`，共返回并完整解码 36 张图，供应商实际结算合计 $0.36。这里只证明本次渠道调用，不据此声称独立确认了上游引擎身份。

| 实测 | 返回图片 | 实际尺寸 | 供应商费用 | 供应商报告 duration |
| --- | --- | --- | --- | --- |
| Fast 主视觉 | 4 | 1456 × 816 | $0.08 | 81 秒 |
| sref 换主题系列 | 4 | 1456 × 816 | $0.08 | 82 秒 |
| 同提示词和 seed 的 HD | 4 | 2944 × 1648 | $0.12 | 121 秒 |
| Draft | 24 | 624 × 352 | $0.08 | 51 秒 |

这里的 duration 来自渠道任务响应，包含服务端处理，不能等同于模型纯渲染时间；下载和用户选择时间还需另计。不能直接把官网宣传的数秒生成当作 Makaron 的端到端耗时承诺。

视觉检查：Fast 主视觉有清楚的材质、光影和构图，但未严格遵守左上留白要求；sref 系列把主体从玻璃球换成飞艇后，仍保留珊瑚色太阳、深色背景和相近材质。HD 与 Standard 的构图和主体位置有明显差异，因此按钮应写“生成 HD 版本”，不能写成保证保留选中画面的无损升级。Draft 能提供更多构图候选，但部分画面出现块状拼接和结构瑕疵，应仅用于探索。本次没有人物、商品一致性或现有精修模型的对照评测，不建立质量排名。

本地正常编辑器验收：中文咖啡品牌需求成功生成四张 1456×816 候选，全部保存为永久项目图片。重新打开保留四图，点击第三张画布切换到对应文件。随后在同一编辑器明确以第三张作风格参考生成茶壶主题，Agent 使用 `style_reference_media_indices=[3]`、保留原始中文需求，另外四张永久保存。两批分别只有一笔 `generate_image / mj-v8.2` 17 积分流水；该金额是本次实际结果，并非固定售价。测试使用隔离验收账号，不扣用户本人积分。

Web/Agent 普通四图与 sref 已真实调用；MCP 批次响应与计费通过合同测试，尚未做新版 MCP 真调用；Draft/HD 渠道层已有上表真实产物，新版正常编辑器的 Draft/HD 仍需独立真实验收。尚未发布 iOS 二进制，不能把窄屏浏览器验证当作真机验收。最终代码、测试和浏览器证据属于本地候选，不代表已合并或上线。

最终本地验证：2229 项测试通过、1 项既有跳过；TypeScript、四语 UI 检查和 core prompt 合同通过。1280×900 桌面与 390×844 窄屏均可显示候选组，无水平溢出；最终重新打开期间无页面或 console error。手机浏览器点击候选能选中正确编号。正常画布 Save 下载为 1456×816 PNG，完整解码通过。

本地运行：专用 runner `/Users/tianyicai/ai-image-editor-midjourney-runner`，服务 `http://127.0.0.1:3041/projects`。3039 的 Retake 服务保持运行。测试账号、测试项目与新增 `mj-v8.2` 价格行位于共享数据库；没有修改用户已有项目、其他模型价格或共享 Preview 配置。
