# 媒体计费迁移与低成本真实验收（2026-09-03）

## 结论与环境边界

- 用户明确授权“先迁移，再用便宜方式测试计费”。已执行共享数据库迁移；应用代码没有合入 dev 或部署到生产。
- 被测应用提交：`ef0f88fce8ef5481fb5d07399200cbc30d84a648`，分支 `codex/wan-discount-billing`。
- 被测应用：独立 runner `/Users/tianyicai/ai-image-editor-runner-wan-billing`，`http://localhost:3042`，`MOCK_AI=false`。没有切换现有用户测试服务器。
- 真实请求 7 个，覆盖 Agent token、图片 token、图片按次、音频按秒、MCP 视频和 App 视频。7 条流水合计 **58 Makaron Credits = USD 0.58 用户零售价**，不是供应商实际支出或全账户余额差额。
- 同账户同时有其他用户请求；通过本次具体流水 ID 核账，排除其他 Tips、视频、个人套餐记录。
- 三条视频均获得供应商 completed 回执。当前本地环境访问视频资产域名发生证书链错误，App 永久存储也失败；**视频播放和永久回传未通过验收**。计费入账成功不能替代媒体交付成功。

## 迁移证据

| 项目 | 值 |
| --- | --- |
| 共享 Supabase project ref | `sdyrtztrjgmmpnirswxt` |
| 迁移版本 | `20260903113857_media_pricing_catalog` |
| SQL SHA256 | `6b2e96ea280f4f8976613885c5015a8f10a02555ca7880614d4eed0c59514240` |
| 初始价格版本 UTC | `2026-09-03T12:34:02.540124Z` |
| 目录 | 65 行；13 个视频模型及 Seed Audio 的已登记变体 |
| Admin 接口 | 本地认证 `GET /api/admin/media-pricing` HTTP 200，65 行 |

只执行这一个迁移，没有顺带 push 其他未应用文件。通过 Supabase Management API 的 PostgreSQL 事务同时执行完整 SQL 与写入 `supabase_migrations.schema_migrations`，保留与本地文件一致的精确版本。执行前校验 linked project 与 service-role JWT ref 一致。凭据不写入报告。

`media_pricing`、`mcp_video_reservations` 均启用 RLS；anon/authenticated 没有 SELECT 权限。执行前后查询安全 advisors，新表仅增加两项 service-only 表无 client policy 的 INFO，未为了消除提示放开权限。迁移不覆盖已有 token / 按次价格，不重算历史订单。

## 真实请求与流水

生成内容均为普通物体或短音效；视频只用 480P、2 秒，不测试昂贵高分辨率模型。

| 类型 / 入口 | 请求与结果 | Credits | usage_logs.id |
| --- | --- | ---: | --- |
| Agent / CLI chat | DeepSeek V4 Pro，仅回复“计费验收通过”，不调用工具 | 3 | `5809d2f2-846a-4654-9d77-47124907910a` |
| token 图片 / CLI edit | Gemini Lite，奶油色背景蓝色杯子；图像已检查 | 7 | `4bc919c9-5368-4c4e-a3d4-d5a74b819486` |
| 按次图片 / CLI edit | Qwen，把上述杯子改红；真实 Qwen、无 fallback，图像已检查 | 2 | `c6eb6f8e-d351-474d-ae01-43d48d6e8b28` |
| 音频 / HTTP MCP | Seed Audio，3 秒铃声，返回 MP3；未试听 | 2 | `48cd244c-c848-4481-9f4f-1ada46f3041b` |
| 视频 / HTTP MCP | Wan Standard，480P 2 秒，黄色鸭子；供应商 completed | 12 | `dbeb59fa-1a2b-4c44-8d5d-95cf6c49a145` |
| 视频 / HTTP MCP | Wan Prime，480P 2 秒，纸船；供应商 completed | 20 | `4306f2f4-bc5c-4d1b-9cad-c139ca5e7327` |
| 视频 / App API | `/api/video-snapshot`，Wan Standard，480P 2 秒；供应商 completed | 12 | `662aa3a2-0750-4707-8c86-6b8c8f9b39bd` |

视频报价按整次向上取整：Standard `ceil(2 × 0.03 × 100 × 2) = 12`；Prime `ceil(2 × 0.0476 × 100 × 2) = 20`。Seed Audio 3 秒 `ceil(3 × 0.0025 × 100 × 2) = 2`。

`verify-receipts` 已实际执行并返回 `passed=true / totalCredits=58`，7 笔均按数据库精确价目重新计算相等。DeepSeek 本次无缓存，输入 27,471 / 输出 5 token，单价 0.435 / 0.87 USD/百万；Gemini Lite 输入 80 / 输出 1,120 token，单价 0.25 / 30 USD/百万；均为 2x markup。Qwen 精确按次目录为 2 Credits。该核对是“DB 配置 → 本次用量 → 扣费流水”，不是独立供应商账单核对。

App / Agent 项目：`8f0344f5-4d0f-4c12-88bc-de6131e4e5c4`。本地打开 `http://localhost:3042/projects/8f0344f5-4d0f-4c12-88bc-de6131e4e5c4`，不把 CLI 默认展示的生产域名当作被测环境。

| 视频 | 任务 / 快照 |
| --- | --- |
| MCP Standard | `mr-wan30-ff14154b-a4f3-446f-8414-d76243185e18` |
| MCP Prime | `mr-wan30-prime-f0c88d1d-69c2-47b3-a6fb-dcac343c1c2f` |
| App Standard | `mr-wan30-0d4fe820-f108-4c94-ad99-e7839a55eafe` |
| App snapshot | `99144726-2004-44c5-8f09-1bee5c748f25` |

MCP 两笔 reservation 均为 completed，并保存此次价格版本及原金额。App snapshot 保存 12 Credits 与同版本 `billingQuote`。

## 不额外花钱的异常验收

- 对 Standard 同一个 `billingRequestId=03705a54-01f3-4000-8000-202609030001` 使用完全相同参数重放，返回原 task ID；仅一笔 12 Credits 扣费，无第二次 provider 生成。
- Standard 提交 31 秒非法时长，校验拒绝；`billingRequestId=03705a54-01f3-4000-8000-202609030099` 没有预留记录，不产生生成费。
- 在真实共享 PostgreSQL 中运行短事务 self-test：临时预留 1 Credit、重放、提交、明确失败、重复失败、余额不足。验证只扣一次、只退一次、余额和 lifetime_used 恢复；最后整个事务 ROLLBACK，确认没有残留测试预留。
- 上述退款是**真实数据库函数的 rollback-only 验证**，不是人为让供应商生成失败的付费端到端退款测试。没有留下虚假生产流水或手工补余额。
- 本轮重新运行 Vitest：257 文件、1527 测试通过。helper 语法与 ESLint 通过。隔离 PGlite 实际迁移测试通过；先前实现检查的 TypeScript / 全量 lint 通过。

复核入口 `tools/billing-live-acceptance.mjs`：`catalog`、`ledger <ISO时间>`、`verify-receipts` 为只读；`verify-receipts` 使用固定本轮流水 ID 和数据库中的精确模型价，独立计算并对比金额。`transaction-check rollback-only` 是显式事务测试，需获得共享库写入授权后才运行。`migrate` 已执行，禁止重复运行；脚本也会检查已存在的表和历史版本并拒绝重跑。

## 未通过项与未覆盖项

1. 视频资产域名 `mule-router-assets.muleusercontent.com` 在本地出现 `ERR_CERT_AUTHORITY_INVALID`；正常 curl 返回证书链错误。App 日志进一步证实 `fetchProviderVideoBuffer` 抛出 `SELF_SIGNED_CERT_IN_CHAIN`，不能永久上传到 Makaron Storage。没有忽略证书检查或绕过网络策略。该证据不能区分本地网络证书注入与供应商证书配置，尚未定位归属。
2. 不因媒体 URL 下载失败自动把已经 completed 的供应商任务当失败退款。本轮保留 58 Credits 的真实扣费；修复交付链路或退款需要另行明确处理。
3. 为节省费用，没有逐个调用全部 13 个视频模型，也未测试每个高分辨率/edit/extend 组合。目录覆盖检查和单元测试不等于所有 provider 的真实媒体验收。
4. 未在线改 Admin 价格（共享库会影响其他请求）；即时改价及旧报价冻结通过隔离自动化验证。本地已验证真实 Admin 目录读取。
5. 生产应用尚未切换，旧代码仍可能使用旧静态价格。后续发布需先处理/接受媒体交付问题，再明确授权合并与上线，并进行生产路径验收。
6. Agent/图片全 registry 入库 CI 门禁、ASR 定价、基础设施收费政策、图片/音频异步补账、历史核账仍是已记录的后续项；此次抽样通过不表示这些风险全部消失。
