# Seedance 2.5 Flash 候选接入与实测

2026-11-13，稳定候选 ID：`B-20261112-seedance25-flash`。用户已授权独立接入；现有 EvoLink 账号可见四个精确路由，因此从 B 升为 A。没有改变默认模型、合入、部署、发布 npm 或修改共享配置。

## 交付边界

- Worktree：`/Users/tianyicai/.codex/worktrees/seedance25-flash/ai-image-editor`；分支 `codex/seedance25-flash`。
- 现场 fetch 的 `origin/dev` 基线：`8e1b556340b134d878f42563d55bfdb60eb29179`。保留并重放此前两次文档核查提交，复用原 managed worktree，没有重建或覆盖其他任务。
- 代码接入提交：`0121eed1`。后续文档/CLI help/测试补充见本分支最新提交。
- 阶段：`code_ready`，供应商模块真实生成已验证。**不是完整产品 `live_verified`，也不是 `ready_for_review` 的端到端验收通过。**
- 本地候选服务：`http://localhost:3047`，由隔离 runtime `/Users/tianyicai/.codex/runtimes/seedance25-flash-acceptance` 运行；没有占用共享 Preview alias。
- 可播放报告：`evidence/seedance25-flash-20261113/report.html`，本机 `http://localhost:3048/report.html`。完整请求、输出、测量、像素证据在同目录。

## 依据与合同

[EvoLink 发布](https://x.com/EvoLinkAi/status/2121054302823457166)，2026-11-13 01:35:27 UTC；[产品/价格](https://evolink.ai/seedance-2-5-flash)，四个精确 API Schema 的实际渲染完整正文与响应 Date 已保存在雷达 `runs/20261113T050639Z/flash-docs/`。既有账号只读 `/v1/models` 列出全部四条 ID。BytePlus 原生渠道仍单独按其时间表跟踪，不把原生未开误认为所有渠道不可用。

| 模式 | 精确 model ID | 关键限制 |
| --- | --- | --- |
| 文生 | `seedance-2.5-flash-text-to-video` | 整数 4–30 秒，480p/720p，默认 720p；六种固定比例 |
| 首/尾帧 | `seedance-2.5-flash-image-to-video` | 1–2 张图，不混视频/音频；跟随首帧画布 |
| 参考生成 | `seedance-2.5-flash-reference-to-video` | 至少一个参考；最多 10 图/5 视频/5 音频；视频每条 2–30 秒、合计不超过 30 秒；音频合计不超过 30 秒 |
| 视频编辑 | `seedance-2.5-flash-video-edit` | 恰好一个 4–30 秒源视频；可附图片/音频；跟随源时长和画布，省略 duration，不能传 -1 |

统一 `POST /v1/videos/generations`，轮询同一个 `GET /v1/tasks/{id}`；临时输出需要及时保存。无延长、draft、MOV、网页搜索、放宽审核、原生 1080p/4K。不能继承普通 2.5 的 30/10/10 参考限制或 Eco 超分合同。

无视频输入价格：480p $0.12/输出秒；720p $0.24/输出秒。带视频价格：480p $0.075、720p $0.15，计费秒为 `输出 + max(ceil(参考视频总秒), 输出)`；编辑按 `2 * ceil(源秒)`。音频无额外费用。任务 GET 已返回实际 model、usage.cost.usd 与积分数，逐条保存在 provider-receipts.json；普通2.5 回执 USD 为 $0.55（公开估算 $0.552）。这是任务级计费证据，未与账户总账/发票对账；API schema 的 MIT 仅为文档许可，调用遵循已有商业 API 合同。

## 代码范围

- `video-model-capabilities` 注册独立模型与默认档、能力、参考限制、模式与价格；归一化不落入 Eco，默认图片仍为 GPT Image 2.6 Flare、视频仍为 Kling 4.0 Flash。
- 新增纯 Flash payload 合同，在任何计费/付费 POST 前拒绝不支持的参数；复用 EvoLink 原有任务、持久化、轮询、收费/退款、幂等入口，无隐藏 fallback。
- `create-video` 对接首/尾帧、参考和编辑；测量参考时长，音频下载后用 FFmpeg 校验合计时长，保留来源画布与编辑秒数。不会为错误输入保留错误费用。
- Agent 工具、MCP、CLI 暴露独立 Flash 和显式 `image_workflow`/`--image-workflow`。CLI reference-to-video 时有视频需显式 `--video-operation generate`；`edit` 跟随源时长。
- 模型选择器新增独立 Flash 条目与四语描述；只显示 480p/720p。Admin 计费面板显示相应视频参考费率。
- 新增四行计费迁移 `20261113053000_seedance25_flash_pricing.sql`，`ON CONFLICT DO NOTHING` 不覆盖管理员价格；参考费率缺失时拦截，不猜价放行。
- CLI help、README、bundled Skill 与 public discovery 已更新；候选尚未发 npm，发布时按现有 checklist 升版并验证全新安装。

## 实测与证据

使用官方 mascot 原始 concept sheet，不改图、不改提示词来偏袒模型。供应商模块试验专用素材项目 `b930e4be-b7a2-45a5-adfe-0effdecfc92d`，没有修改任何既有用户项目。

| 样例 | 端到端耗时 | 公开单价估算 | 观察 |
| --- | --- | --- | --- |
| Flash 文生 4 秒/480p | 146.5 秒 | $0.480 | 有原生音轨、854×480/24fps；无身份参考时眼睛变成大白眼，品牌一致性不足 |
| Flash mascot 参考 4 秒/480p | 190.6 秒 | $0.480 | 像素五官、帽子、紫色身体保留，Spark 与角色互动可见 |
| 普通 2.5 mascot 参考 4 秒/480p | 209.7 秒 | $0.552 | 同素材、同提示词、同实际画布/音轨/fps；也保留身份，表情与场景不同 |
| Flash 首帧 4 秒/480p | 135.1 秒 | $0.480 | 首帧专用路由；完整 concept sheet 首帧；中途边缘裁切、文字变化，严格版式保持未通过 |
| Flash mascot 参考 4 秒/720p | 499.1 秒 | $0.960 | 实际1280×720，包含GET网络中断和恢复查询；不能直接当作纯模型速度 |
| Flash 视频编辑 | 233.4 秒 | $0.750 | 真实 4.064 秒源向上取整计费；门变绿，帽檐/桌面也被绿色影响，不是逐像素局部保持 |

单样本参考对照中 Flash 约快 9.1%，报价低 13.0%；不是稳定延迟承诺，也不能据此宣布质量更好。普通 2.5 使用既有 adaptive 参数，Flash 省略比例后默认 16:9；实测输出均 854×480。时间从提交前到轮询完成并下载，包含网络、排队及 8 秒轮询粒度。

6个任务全部完成；供应商回执媒体合计 $3.70，受控路由预检约 $0.0082，本轮约 $3.71，低于既有 $5 目标。没有账户余额查询、采购、充值或重复POST。各视频轨道、SHA256、总费用与播放检查以 `measurements.json` / HTML 为准。所有 POST 均保留原 task ID；结果未知时只查询原任务，没有自动重提。

## 验证与待办

- 148 项相关测试通过：独立四路 payload、编辑时长、分辨率/参考数、价格进位与缺价拦截、计费前验证、普通 2.5 回归、退款/幂等边界，以及真实 FFmpeg 音频合计时长。
- TypeScript、ESLint 对应模块、CLI smoke/upload、四语 i18n 检查通过；CLI 新增首次/尾帧与编辑参数传输、非法 extend 零网络提交回归。
- `build:skill-sync`、`check:skill-sync` 通过。旧路由证据过期后已执行 3 项受控真实 Agent 路由预检，所有非 read_file 工具拦截，媒体/生产操作为 0。
- 四语真实 ModelSelector 组件通过内置浏览器像素及 480p/720p 交互检查；组件 harness 明确标注不是完整编辑器生成验收。
- 已用真实本地 CLI 请求 Flash，因共享数据库缺少 `video:seedance-2.5-flash:480p:generate` 计费行而在供应商 POST 前拦截。只读查询确认计费行数 0。**没有修改共享计费配置来绕过此边界。**
- 真实生成样例另经 CLI 导入专用项目并重读媒体列表（1张参考图+6条视频），持久化证据单列；这是输出保存验证，不能称为 CLI 原生生成成功。内置浏览器的完整编辑器仍需本地登录。
- 发布前仍需获准应用计费迁移，跑实际 Makaron chat/GUI/CLI 生成 → 扣费/退款 → 保存/重开全链路。30 秒及最大参考数仅做边界测试，音频参考尚无真实生成样例。
