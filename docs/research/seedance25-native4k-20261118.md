# Seedance 2.5 Native 4K：高价路由与候选验收（2026-11-18）

候选 B-20261024-seedance25-4k 已完成本地可审查改动，保留默认视频路由。只允许明确要求原生 4K，或显式选择 Seedance 2.5 Native + 4K；普通视频、模糊“高清/画质好”和失败恢复均不得自动升级。没有合入、push、公开 PR、部署、修改共享数据库/环境变量或发布 npm。

分支 `codex/seedance25-native4k`，工作目录 `/Users/tianyicai/.codex/worktrees/seedance25-native4k/ai-image-editor`。保留原代码 `0157531a`、报告 `60badf40` 和全部原始未跟踪证据；以合并提交 `69b6664b` 安全接入核对时的 `origin/dev`（`ca5db98e`）。应用 attach 因该树属于原聊天被拒，本次按用户指定目录继续执行，没有改共享 checkout 的业务代码。最终提交与相对 dev 的 patch 见本地 `evidence/seedance25-native4k-20261118/delivery.json`、`candidate.patch`。

## 价格与入口

重新核对 [EvoLink 模型及价格](https://evolink.ai/seedance-2-5) 与 [changelog](https://evolink.ai/changelog)，原生模型 ID 仍为 `seedance-2.5-text-to-video`、`seedance-2.5-image-to-video`、`seedance-2.5-reference-to-video`、`seedance-2.5-video-edit`、`seedance-2.5-video-extend`，quality 包含 `480p/720p/1080p/4k`。4K 是供应商原生输出，没有使用 Eco 超分或其他供应商。

| 4K 输入 | 供应商美元估算 | Makaron 候选积分（markup=2，100积分/$） |
|---|---:|---:|
| 无视频输入，4秒输出 | 4 × $1.182 = $4.728 | 946 |
| 8秒视频输入，生成/续写4秒 | (4 + max(8,4)) × $.724 = $8.688 | 1,738 |
| 编辑8秒视频，输出随源时长 | (8 + max(8,8)) × $.724 = $11.584 | 2,317 |

供应商积分不是 Makaron 积分，表中美元也是供应商公布的近似费率。运行时从价格表取得当前 markup/版本并向上取整产品积分，不能将上表写死为所有账户的永久价格。迁移 `20261117053223_seedance25_native4k_pricing.sql` 包括 Native 1080p/4K 的 generate/edit/extend 行；重复应用保留运营已有 markup。本次未改共享价表。

能力层新增高成本标记和使用条件；Agent/MCP 工具合同、Seedance Skill、视频指南和四语模型文案同步说明。供应商价表没有塞入 system prompt。CLI 已补参数、help、README，源码版本仍为 0.17.21 候选；没有发包，已发布 CLI 不包含这些改动。

## 提交、扣费与回执

- Agent 首次调用强制只报价，即使模型自行猜了 `max_credits` 也不会生成或扣费。`runMakaronAgent` 将四语总价作为内容事件发给用户，再允许下一工具步带费用上限提交；已授权生成时不另问一次预算。
- 按 `createVideo` 最终解析的输入时长报价，避免编辑/续写用旧 UI 时长提前扣费。编辑按源输出时长的0.1秒精度估价；Native 4K 暂不开放无法准确固定报价的自动时长生成/续写或 web-search 附加费。
- MCP `maxCredits`、CLI `--max-credits` 与 HTTP 入口沿用相同报价上限。CLI 显式选 Native 4K 时先获取并显示总价；没有上限只返回报价，有上限才提交。复用 `billingRequestId/--request-id`，费用上限不影响请求指纹。
- 明确拒绝退款；付费 POST 结果不明保留预扣并返回不可重试的回执。供应商接受后保存失败保留 task ID，不退款伪装成失败再生成。没有隐式 fallback。
- Agent 在同一工具实例内对相同请求复用成功/不明/保存失败回执；MCP 使用已有持久化 reservation 幂等。Agent 跨进程/跨聊天以及旧 HTTP 入口没有新增完整的持久化提交幂等协议，不将同一执行内防重声明成全系统 exactly-once。

## 验证证据

本次证据目录：`evidence/seedance25-native4k-20261118/`；原始供应商实测目录：`evidence/seedance25-native4k-20261117/`。大媒体、运行日志和临时验收环境保留本地未跟踪，不带入提交。

| 验证 | 结果与边界 |
|---|---|
| 真实 Agent 路由 | 5/5：普通请求保持默认；模糊高清选择 Kling 4.0/1080p；失败恢复未升级；两种明确原生4K请求均选择 Native + 4K 并先取报价。真实 DeepSeek 推理，媒体/生产工具在提交前拦截，见 `native4k-routing.json`。 |
| 针对性回归 | 10文件130项通过；包含原生4K价格/最终输入、Agent报价与回执、MCP扣费/重放/失败、HTTP边界及普通/Flash视频回归，见 `unit-tests-final.log`。 |
| 隔离 PostgreSQL | PGlite 执行实际价格迁移及计费 SQL 函数，8项通过：扣一次、指纹冲突、拒绝退款一次、轮询失败退款一次、不明结果保留、余额不足原子回滚、Agent snapshot退款幂等、迁移保留markup。见 `sql-acceptance.json`；共享DB写入0。 |
| CLI 与工程门禁 | CLI smoke/upload、`tsc --noEmit`、UI i18n（无新增硬编码）、`build:skill-sync`、`check:skill-sync`、diff whitespace 检查通过。Skill路由证据刷新4/4，无媒体生成。 |
| 实际 Editor 用户路径 | 真正的 Editor/useProject 组件、提取执行的实际 Agent 工具与 createVideo 适配器；本地 fixture 替代账户/DB/存储，并用确定性 Agent 事件编排与原供应商任务回放。显示946总价→单次预扣→样片进入时间线→持久化→刷新重开→3840×2160原HEVC播放至4.05秒结束，无媒体错误。见 `ui-cost-before-submit.png`、`ui-product-playback.png`、`ui-product-reopen.png`、`product-acceptance-summary.json`。不是登录生产账户的新一次端到端生成。 |
| 浏览器 | 内置浏览器实际报告 iab 不可用，按规则回退 Playwright。测试代理曾因响应取消而退出，修复代理后重开通过；不是线上故障。临时 QA 页面已移出 src，保留 `qa-page.tsx.fixture` 供复现。 |

原样片任务 `task-unified-1794893734-4v2jbnjp` 已验证3840×2160、HEVC Main10、4.041667秒、AAC音轨；本次复用原片，没有重复供应商验证或新增付费媒体 POST。原始播放文件：`evidence/seedance25-native4k-20261117/native4k.mp4`。人工听感未验收，HEVC兼容性不推广到所有设备。

## 费用与剩余项

沿用同一 session 的 $5 目标/$10 上限。原媒体回执 $4.728；先前累计估算 $4.739223456–$4.750446912。本轮新增路由推理800,287输入token（缓存676,352）、10,967输出token，按仓库对应DeepSeek峰/谷价估算 $0.027199506–$0.054399012，累计 **$4.766422962–$4.804845924**。未核销发票；新付费媒体 POST=0、总计=1，见 `cost-summary.json`。没有重置或修改其他候选预算。

阶段为 **code_ready + provider_live_verified + isolated_product_verified**，可以审查，仍保留 **production/live_verified=false**。剩余发布验收：共享价格行激活、真实登录账户的扣费/保存重开、1080p和4K reference/edit/extend真实生成、移动设备/其他播放器，以及网站与npm正式发布。上述剩余项不应被这次 fixture 结果替代。用户当前要求先交付候选，因此本次停在可审查本地提交。
