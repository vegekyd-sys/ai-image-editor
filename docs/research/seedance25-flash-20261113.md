# Seedance 2.5 Flash 候选接入与实测

2026-11-13，稳定候选 ID：`B-20261112-seedance25-flash`。用户已授权独立接入；现有 EvoLink 账号可见四个精确路由，因此从 B 升为 A。默认模型保持不变。下文早期状态为历史记录，最新阶段以末尾发布验收为准。后续为完成候选验收，仅新增共享库 Flash 专属四条计费行，原有价格行逐行核对未变。

## 交付边界

- Worktree：`/Users/tianyicai/.codex/worktrees/seedance25-flash/ai-image-editor`；分支 `codex/seedance25-flash`。
- 现场 fetch 的 `origin/dev` 基线：`8e1b556340b134d878f42563d55bfdb60eb29179`。保留并重放此前两次文档核查提交，复用原 managed worktree，没有重建或覆盖其他任务。
- 代码接入提交：`0121eed1`。后续文档/CLI help/测试补充见本分支最新提交。
- 阶段更新见下方“独立 thread 产品验收”。早期仅供应商模块验证的阶段保留在原始证据中。
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

原6个供应商模块任务全部完成；这6条回执媒体合计 $3.70，首轮受控路由预检约 $0.0082，小计约 $3.71。独立 thread 新增产品样例费用单列于下节，共用原session额度。没有账户余额查询、采购、充值或重复POST。各视频轨道、SHA256、总费用与播放检查以 `measurements.json` / HTML 为准。所有 POST 均保留原 task ID；结果未知时只查询原任务，没有自动重提。

## 验证与待办

- 148 项相关测试通过：独立四路 payload、编辑时长、分辨率/参考数、价格进位与缺价拦截、计费前验证、普通 2.5 回归、退款/幂等边界，以及真实 FFmpeg 音频合计时长。
- TypeScript、ESLint 对应模块、CLI smoke/upload、四语 i18n 检查通过；CLI 新增首次/尾帧与编辑参数传输、非法 extend 零网络提交回归。
- `build:skill-sync`、`check:skill-sync` 通过。旧路由证据过期后已执行 3 项受控真实 Agent 路由预检，所有非 read_file 工具拦截，媒体/生产操作为 0。
- 四语真实 ModelSelector 组件通过内置浏览器像素及 480p/720p 交互检查；组件 harness 明确标注不是完整编辑器生成验收。
- 历史阻塞：早期真实本地 CLI 请求 Flash，因共享数据库缺少 `video:seedance-2.5-flash:480p:generate` 计费行而在供应商 POST 前拦截。只读查询确认计费行数 0。此时未修改价格。后续依用户“完成接入”的授权补齐四条 Flash 独立价格，未绕过预检。
- 真实生成样例另经 CLI 导入专用项目并重读媒体列表（1张参考图+6条视频），持久化证据单列；这是输出保存验证，不能称为 CLI 原生生成成功。内置浏览器的完整编辑器仍需本地登录。
- 候选计费数据已增量设置。SQL迁移文件保留 `ON CONFLICT DO NOTHING`，实际通过Data API设置等价数据，未伪造迁移历史。30秒及最大参考数仅做边界测试，音频参考尚无真实生成样例。

## 独立 thread 产品验收（本次续做）

- 独立 thread：`01a1d3c6-4ecc-7f23-973a-18b1cf2bea43`，复用原 managed worktree/分支。业务提交 `bfb0eba2`，隔离 runtime 已更新到该提交；报告服务3048保持可播放。
- 真实 `makaron chat --project ...` 发起：run `aa61a685-d972-4a07-b55a-18bb3452c96c`，精确供应商任务 `task-unified-1794554842-g5p2o602`，回执模型 `seedance-2.5-flash-reference-to-video`，实际854×480、24fps、4.064秒、带音轨。专用项目自动持久化原始媒体，实际Chrome编辑器播放至结尾，并在干净URL重开后再次播放至结尾。
- 真实独立 `makaron video create`：任务 `task-unified-1794555107-86shyc9b`，精确模型 `seedance-2.5-flash-text-to-video`，已完成并经CLI返回URL、下载原文件、ffprobe核验。新增 `--request-id` 参数；同一UUID、同一请求重放返回原任务，数据库只有一次96积分扣费。没有第二次供应商POST。
- 两条产品样例供应商任务回执各$0.48，应用各96积分。`product-billing-acceptance.json`记录真实扣费与退款检查：在真实DB建立测试预留，模拟供应商提交前明确拒绝，重复终结退款两次仍只退96，净扣费0；这不是伪称真实供应商失败。
- Flash Agent扣费改为完整payload与音频时长校验后的回调；校验拒绝零扣费，供应商明确拒绝退一次。POST结果不明保留扣费且阻止重试；供应商已受理但保存失败时保留原task ID、不错误退款，后续对原任务与Agent run做恢复。没有新建计费系统。
- 新增5项Agent边界测试，含校验零扣费、精确报价、明确拒绝退款、未知POST不退款和保存失败保留task。最新相关6文件71项通过（与先前148项部分重叠，不相加）；TypeScript通过，ESLint零错误、1条既有未使用locale警告；CLI smoke/upload通过。
- `build:skill-sync`已通过。因Agent工具源码变更，旧路由证据按指纹判定过期；已重新跑3项受控真实路由预检并通过 `check:skill-sync`，所有非read_file工具被拦截，媒体/项目写入0。保留先前检查失败记录。
- 内置浏览器在本独立thread不可用，GUI验收使用Chrome。初次本地会话只有访客视图；通过既有验收账号的正常Supabase登录恢复，凭据不写入报告。未新增账号、密码或权限。
- 费用完整性：供应商任务级回执与应用积分分开报告，未查询余额或账户账单。原有自动Tips入口观察到额外预览任务，未将其虚构成Flash费用；总账/发票未对账。
- [费用横向对照](seedance25-flash-price-comparison-20261113.md)。默认视频模型仍为Kling 4.0 Flash，默认图片仍为GPT Image 2.6 Flare；没有合入、生产/Preview部署、npm发布或共享alias/env修改。

### GUI直接发起的最终任务

最新代码下在真实编辑器手动选择Flash 480p并发送请求，创建任务 `task-unified-1794555872-wytzkn54` / snapshot `ccec8d6c-ff25-494e-b28c-896a3d080501`。供应商GET确认精确路由为`seedance-2.5-flash-reference-to-video`；产品正确预留96积分，报价$0.48。2026-11-13 07:56:41 UTC实际查询仍是processing/95%，从受理已超过12分钟，未返回输出或失败。只查询原task，没有重提、退款或模型替换；不能把这条GUI发起的最终验收写成通过。前一条chat生成的视频已在GUI播放和重开通过。

本次续做最新9文件98项相关测试通过，CLI smoke/upload、npm pack dry-run、TypeScript和Skill同步通过；未发布npm。已确认的8条完成媒体任务（原6+chat+独立CLI）回执合计$4.66；GUI原任务另有$0.48报价/96积分预留，尚不能当最终账单。产品Agent和素材分析另11积分；额外受控路由预检只记录token量、未编造实际USD账单。总账未对账。所有模型样例均在原授权session的$10上限内推进，没有重复申请预算。


## Retake 发布前验收（2026-11-13）

用户追加授权 Retake、计费回归、合入与生产发布。本轮从现场核对的 origin/dev f1af11e6 重放候选；实现与完整门禁对应 bb8db931。Changelog.tsx 已新增四语产品公告，CLI 候选版本 0.17.19。

- Retake 模型列表、Agent、MCP、CLI 均支持 `seedance-2.5-flash`。480p/720p；最少4秒源片与整数4秒上下文；选区可短于4秒，最终只回贴选区。Flash 编辑请求省略 duration/aspect_ratio，不伪造精确尾帧。
- CLI 实际编辑青色墙面与 GUI 实际编辑暖金墙面各一次，均为精确 `seedance-2.5-flash-video-edit`，无 fallback。根任务分别 d92c9d67-21b4-48b7-9f16-317b97cc4428 / 823e12f0-4f6f-4920-a270-3fa2930d6378。两条均 completed、永久保存、854×480、24fps、4.064秒；GUI 完整播放到4.064秒并重开持久化结果。
- 两条均选择1–3秒；选区外帧平均像素差1.11–1.34/255（重编码），原声音轨解码PCM逐样本一致，总时长差0。选区内实际颜色变化可见，身份和桌面仍保留；不把生成式局部编辑描述为选区内逐像素无损。
- 每条任务供应商回执$0.60，应用实际扣120积分，预留均 completed。此前真实扣费/幂等与重复退款检查仍保留；本次补齐FlashRetake边界/音轨/提交参数回归。
- 此前GUI直接生成任务 task-unified-1794555872-wytzkn54 已完成并下载，原pending历史不再代表现状。前9条已完成媒体$5.14，加本轮两条Retake$1.20，媒体累计$6.34；Agent/受控预检费用另列，未编造账户总账。
- 全量门禁：405文件、3028测试通过（2跳过），TypeScript、CLI smoke/upload、build与CRC32C/FFmpeg/API trace包装检查通过。四条受控真实路由预检通过；未生成额外媒体或项目写入。Skill同步通过。
- 共享库只增量放开 Flash Retake model check，保留旧模型与LTX历史合同；精确SQL文件20261113094500已通过Management API应用并验证。实际应用SQL，不伪造migration history。
- 历史错误保留：首次错误运行了canonical HEAD导致旧代码拒绝，发生在收费前；完整门禁旧源码断言已改为真实CLI边界测试；3057与其他任务字体代理端口冲突，保留对方进程并迁至3069；单次DualWriter数据库超时后，最终消息/媒体恢复可重开。上述没有通过重提付费任务掩盖。
- 证据位于本worktree `evidence/seedance25-flash-release-20261113/`，私密原任务URL文件不入git。生产与npm发布结果待发布后单列，不以本地门禁替代线上验收。
