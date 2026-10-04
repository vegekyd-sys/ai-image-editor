# 统一媒体计费目录与 MCP 视频预扣费

实现日期：2026-09-03。分支：`codex/wan-discount-billing`，基线：`733b387e`。

状态（2026-09-03 更新）：用户批准后已执行共享 Supabase 迁移，65 行媒体价目已入库；在独立本地 runner 上完成 7 个便宜真实请求，共扣 58 Credits，均找到流水。用户随后要求合入 dev 并启动本地服务器，本次合并保留 dev 的 Gemini 3.8 视频分析更新，并补齐其缺失的 token 价目。尚未部署生产应用。未修改历史流水或手工调整余额。视频供应商已返回完成，但本地证书链错误阻断播放和永久存储验收。详见 [迁移与真实计费验收](./media-pricing-acceptance-2026-09-03.md)；原始审计见 [Wan 折扣价与计费审计](./wan-discount-billing-audit-2026-09-03.md)。

合并补充：`20260903125637_register_gemini_38_token_rate.sql` 将 dev 原有 Gemini 3.8 介绍期单价（输入 0.75、输出 3.75、缓存读 0.075、缓存写 0.75 USD/百万，markup 2）新增到 `token_rates`，不覆盖已有配置。`getVideoAnalysisDefaultRate` 仅保留为种子/测试参考，不再作为运行时隐藏兜底。介绍期截止 2026-12-31 UTC；**到期前须复核并更新数据库价格，不再由这段参考函数自动切价**。

## 唯一运行时价格来源

| 收费类别 | 数据库 | 运行时入口 |
| --- | --- | --- |
| 视频输出、输入视频、额外参考图 | `media_pricing` | `quoteVideo` |
| Seed Audio 配音、音乐、音效等 | `media_pricing` | `quoteSeedAudio` / `deductSeedAudioCredits` |
| LLM / token 型图片、分析 | `token_rates` | `deductByTokens` |
| Qwen、Pony、WAI、旋转等按次工具 | `credit_pricing` | `checkBalance` / `deductCredits` |

媒体价目键为 `kind:model:resolution:operation`，目前迁移包含 65 行，覆盖 13 个视频模型的已支持分辨率/操作和 Seed Audio。模型能力与路由仍由 `video-model-capabilities.ts` 定义；其中旧价格字段/同步计算器仅作迁移初始值和回归对照，不参与线上运行时扣费。后续接模型必须同时补媒体价目迁移。

视频报价公式：

```text
supplierCost = (输出秒 × 输出 USD/s
             + 参考视频秒 × 输入 USD/s
             + max(0, 参考图张数 - 免费张数) × USD/张) × 适用附加倍率
credits = ceil(supplierCost × 100 × markup - 浮点误差容差)
```

默认 markup 为 2，1 Credit = USD 0.01。Seed Audio 的供应商 credits 按既有单位关系 `0.17 credits/s` 换算用量，USD 单价来自数据库。不得把供应商的 credit 与用户的 Makaron Credit 混用。

Wan Standard 按文档原价六折、Prime 七折；480P 5 秒分别 30 / 48 Credits。1080P 仍为原生路由，2K / 4K 才走 Pro 超分路由。其余模型沿用原有成本，不把本次目录整理当作供应商最新价格核验。

## Admin 与生效规则

- Admin Billing 新增独立媒体价格表，可改分辨率/操作对应的输出费、输入费、免费参考图数、markup、附加倍率及启停。文案覆盖四种语言。
- 新接口显式校验登录和管理员身份；新表启用 RLS，客户端 anon/authenticated 无直接权限，只有 service_role 可访问。结算 RPC 是 SECURITY INVOKER，且仅 service_role 可执行。
- `updated_at` 作为乐观锁，过期编辑返回 409，避免覆盖其他管理员修改；保存后切换模型也保留最新值。
- 运行时读取最新 DB 值，不再跨请求缓存价格。Admin 修改影响下一次报价；App snapshot / Agent 视频及 MCP 已预扣任务保存当时报价版本与金额，退款使用原预扣额。
- 原有 `project_animations` 的 `/api/animate` 入口也改用 DB 报价，但不在旧表中另加报价快照字段。
- AnimateSheet 通过经过认证的报价接口展示价格，不在浏览器读取供应商目录或使用静态价。
- 旧视频/音乐按次价目仅从 Admin 当前按次列表隐藏，没有删除其数据库记录。旧图片/token 配置继续沿用；迁移只插入缺失默认配置，不覆盖已存在的 Admin 值。
- 缺价、停用媒体价目、读取错误会报错，不再静默使用免费或通用猜测价格。LLM / 图片仍是使用后扣费路径，这不等于所有工具都实现了供应商调用前的精确预扣。

## HTTP MCP 视频扣费顺序

适用于用户 API key (`mk_live_*`)；既有本地 stdio、legacy MCP key 的平台内部策略未变。

1. 解析实际 provider、分辨率、操作与被 prompt 引用的图片；有视频输入时读取 MP4/MOV 元数据测量时长。无法读取/测量时拒绝提交，不用调用者估值代替。当前沿用 55 MB 探测上限，大文件及无法解析的格式可能需要预处理。
2. 固定 smart 输出时长（通常 5 秒，保持模型限制；保留源时长的编辑使用实测源时长），完成校验，再从 DB 读取报价。
3. `reserve_mcp_video` 在同一事务中建立幂等请求、检查余额并写扣费流水。余额不足整个事务回滚，不提交供应商。
4. 再提交供应商。Grok 个人套餐仍不收视频 Credits；只有转付费 API 时执行预扣。
5. 明确提交被拒绝时退款；已接受记录 task ID。同步完成（Omni）直接记录 completed，不进入异步轮询。
6. 轮询或现有 video-poll cron 收到明确成功/失败后幂等结算。失败退原金额一次；查询超时/网络错误不当成任务失败。

`billingRequestId` 是可选 UUID；客户端应该在提交前生成并在重试时保持不变。首次省略时服务端生成并返回，收到后也可用该 ID 重试。同 ID、同参数返回现有任务，不再次扣费/生成；改变参数会拒绝。若第一次未自带 ID 且整个响应丢失，客户端无法从未收到的响应中恢复 ID，需人工查预留记录，不能盲目新建请求。

供应商提交超时、连接中断等不确定状态保留预扣，返回不可自动重试提示。数据库写入供应商回执失败也保留原 task ID 返回值及服务端日志，不鼓励重复提交。自动 cron 仅处理已保存 task ID 的 submitted 状态；reserved / uncertain 状态需对照供应商核实后人工处理，不能按“超时多久”自动退款或重新生片。Omni 同步输出的传输/持久化恢复不在本次实现范围内。

只读排查入口（不得未经确认执行退款/余额更新）：

```sql
select id, model_id, status, credits, task_id, created_at, updated_at
from public.mcp_video_reservations
where status in ('reserved', 'uncertain')
order by created_at;
```

## 发布顺序与未处理项

### 后续新增模型的计费接入要求（2026-09-03 用户要求记录）

接入 Agent / LLM、图片、视频模型时，**模型注册、计费登记、数据库迁移、后台可见和实际扣费验收必须作为同一个交付**。只完成 provider 或模型选择器接入，不算完成。不允许在代码里新增一套后台不可见的兜底价，更不能把缺价视为免费。

- Agent / LLM：登记实际 `billingModelId`，包括渠道别名、输入/输出及缓存 token 价、markup；提供供应商实际成本时也要有明确的模型归属及 markup 配置。不能仅凭宽泛前缀“碰巧匹配”认定新模型已入库。
- 图片：先明确 token 计费还是按次计费，分别进入 `token_rates` / `credit_pricing`；多分辨率、质量档或 usage 缺失的 fallback 必须有明确价格来源。自动 fallback 到另一模型后应按实际模型结算。
- 视频：`media_pricing` 覆盖每个开放的分辨率及 generate/edit/extend 操作，包括输入视频秒数、额外参考图和其他适用倍率，不只覆盖默认档。音频新增模型同理。
- 免费或个人套餐：显式声明免费/套餐路径并记录用量；转付费 provider 必须走该 provider 的真实计费，不能用“未登记”表达免费。
- 同一变更提供迁移、覆盖测试与 Admin 价目验证；在获准的目标环境中，先确认迁移已执行且生效行完整，再启用模型。迁移文件存在、单元测试通过，不代表生产库已登记。
- 验收至少包含：正常结算、余额不足、不重复扣费、明确失败退款、查询/扣费异常不丢账，以及 App / CLI / MCP 中该模型实际可用的入口。

当前自动防漏范围（本地分支，未上线）：

1. 视频测试遍历 registry 的模型与分辨率，验证初始生成价目存在；另有部分 edit/extend 相关价格测试。尚未对所有操作做统一穷举。测试 fixture 当前读本次媒体目录迁移；后续增加迁移需同步更新 fixture 的装载逻辑，不能只加模型常量。
2. 运行时报价/扣费查不到价格会报错。视频可在提交前拦截；Agent / 图片部分路径在调用后扣费，缺价仍可能造成上游已花费、下游未收款。
3. Agent / 图片尚无与模型 registry 一一对应的完整计费覆盖门禁；token 仍保留前缀匹配。现有 `release:check` 不查询目标数据库的模型价目完整性。

待补工程门禁：CI 枚举全部启用的 Agent/图片/视频/音频模型、真实计费 ID 和变体，对照隔离数据库执行迁移后的目录；发布前再对目标数据库做只读完整性检查，任一漏项阻止启用/发布。**此门禁目前仅记录为后续要求，并未在本次记录操作中实现。** 本规范不等于“以后绝不会漏”，也不能替代事后扣费路径的可靠补账。

迁移：`supabase/migrations/20260903113857_media_pricing_catalog.sql`。

1. 先审核迁移及目标 DB。Production、Preview、本地共享数据库；不得为本地测试自动执行共享数据库迁移。
2. 得到共享数据库变更批准后，执行该迁移并核对媒体目录/权限/缺失 token 行。迁移是增量添加；不会回溯重算历史订单。
3. 再部署代码。新代码缺表会明确报错，因此不能先上线代码再补表。回滚代码时保留新增表与预留记录；旧 cron 不会处理新 MCP 预留任务，需要保留新结算逻辑或人工处理未结任务。
4. 正式验收应覆盖 Admin 改价、实际报价、余额不足不提交、至少一次便宜视频真实完成与失败退款；生产应用部署及其验收需要另行批准。2026-09-03 已完成授权共享库迁移、本地真实请求计费与共享 PostgreSQL 的 rollback-only 事务验收，具体范围见验收报告。没有为测试改动共享 Admin 单价，也未故意提交收费失败任务。

仍待单独处理：ASR 是否收费及实际合同价；Sandbox/渲染/Storage/CDN 是否由平台承担；Smart Layers 分支的目录；图片/音频等异步扣费失败的持久化重试；历史 149 条 token fallback 核账；GPT Image 无 usage 时数据库现有 20 Credits 的产品定价确认。此次移除了代码中 4 Credits 的运行时兜底，保留已有 DB 配置，没有替用户决定改为 4 Credits。

## 自动化验证

- Vitest：媒体报价与所有 registry 组合初始价一致、Admin 修改后下次报价生效、旧报价不变、停用/缺价/DB 故障阻断、整次任务取整、Seed Audio 单位换算。
- MCP：预扣先于 provider、余额不足不提交、并行请求状态隔离、同请求回放、不确定提交保留预扣、Grok 个人套餐转 API 预扣、同步完成不重复轮询。
- 真实 `createVideo` 函数 + 模拟 HTTP：smart 时长与实际 provider 参数一致、视频实测时长超限在预扣前拦截、预扣失败不发 provider POST。
- Admin 组件/路由：身份权限、字段验证、版本冲突、保存/切换模型后的状态。后续本地真实 HTTP 验收确认管理员接口返回 65 行；未做共享价格修改或 Admin 浏览器表单验收。
- PGlite 隔离 SQL：执行实际迁移和既有余额 RPC，验证 no-overdraft 回滚、幂等退款/重放、owner 隔离、终态不倒退、RLS/服务端专属权限。使用内存数据库，不接触共享 Supabase；它不替代真实多连接 PostgreSQL 压力测试。

```bash
npm test
npx tsc --noEmit --incremental false
npm run lint
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-media-pricing-db.mjs
```

PGlite 验证使用临时安装的 `@electric-sql/pglite@0.3.14`，不加入产品依赖。feature worktree 为 source-only；真实验收另建 `/Users/tianyicai/ai-image-editor-runner-wan-billing`，运行固定提交 `ef0f88fc`，端口 3042，不切换或停止用户正在使用的固定 runner。
