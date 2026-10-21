# Makaron Sandbox 成本审计与本地降本候选

最新进展：[恢复与共享缓存修复、三轮真实验收和账单节省模型](makaron-sandbox-preview-recovery-acceptance-2026-10-21.md)。下文保留原始账单与第一阶段实验。

日期：2026-10-21。基线：`dev@07081d87`。独立分支：`codex/makaron-sandbox-cost-20261021`。

状态更新：下文保留第一阶段审计和本地实验的历史记录。之后已部署隔离 Preview，并以真实大项目发现 2 核及即时释放的体验回退；当前采用 4 核候选、25 秒释放和磁盘快照，完整结果见 [真实大项目 Preview 验收](makaron-sandbox-large-project-preview-acceptance-2026-10-21.md)。未合并、未发布生产，生产账单尚无实际降幅。

## 结论

优先解决 Remotion 截帧 VM 的超时保活，再分阶段降低截帧规格。普通 `run_code` 媒体 VM 已在 finally 停止，现阶段不是主要内存浪费来源。线上 `REMOTION_RENDERER=lambda`，MP4 主导出走 AWS Lambda；这项配置不会使 `preview_frame` 停用 Vercel Sandbox。

已付 `$300.12` 的账单中，Sandbox 内存 `$196.30`；Sandbox CPU、流量和快照另计 `$28.79`。以下资源时间审计覆盖范围比这张阶段性账单更晚，不能把估算金额直接当作账单对账。

## 现场证据

使用安装的 `@vercel/sandbox@1.9.3` 的只读 `Sandbox.list`，从账期起点 `2026-10-09T07:00:00Z` 到 `2026-10-21T09:45:09.719Z`，遍历出 Makaron 项目的 6,658 条实例记录。资源分组如下：

| 类型 | 数量 | 规格 | 中位运行时间 | 至少达到超时上限 98% 的实例 | 内存费用估算（原始运行时间） |
|---|---:|---|---:|---:|---:|
| Remotion，10 分钟超时 | 2,614 | 8 vCPU / 16 GiB | 600.233 秒 | 2,607 | $147.62 |
| 同一 Remotion Snapshot，5 分钟超时 | 920 | 8 vCPU / 16 GiB | 300.646 秒 | 919 | $26.04 |
| 普通媒体代码 | 3,117 | 4 vCPU / 8 GiB | 7.555 秒 | 12 | $2.87 |
| 无 Snapshot 的媒体 VM | 7 | 4 vCPU / 8 GiB | 32.240 秒 | 2 | $0.04 |

原始记录及分组保存在 worktree 的 `artifacts/sandbox-cost/inventory.json`、`summary.json`。这些是资源时间估算；账单截止点、计量换算和最小计费时长会造成差异。按官方当前“至少 1 分钟”规则估算，普通媒体组约为 $9.47，仍明显小于 Remotion 组。列表将同项目内 Production、Preview 和本机实验都计入，不能将全部费用归因于真实生产用户。

抽查线上真实实例：

- `sbx_WoQ91a70OfRhLeNwfW0L34D8uh5V`，8 vCPU、16 GiB，运行 10 分钟。
- 最后一次截帧事件 `17:40:10`，用时约 3.5 秒。
- Sandbox 直到 `17:46:47` 才完成，末尾约 6 分 33 秒没有新命令。
- 控制台估算 compute list price 为 `$0.0589`。
- 详情：https://vercel.com/vegekyd-sys-projects/ai-image-editor/sandboxes/sbx_WoQ91a70OfRhLeNwfW0L34D8uh5V

代码中的原因：`remotion-server.ts` 原实现保留模块级 source-set pool，默认创建 8 核实例、10 分钟超时，没有完成/异常/取消后的 `stop()`。pool 仅属于当前函数进程，跨进程没有可保证的命中。真实记录显示多数实例仍一直活到超时。

## 候选改动

- Sandbox 归属一次截帧操作或一次显式多帧任务；成功、失败、取消、410 重试都执行清理。
- 新增 `renderDesignFrames()`；Agent contact sheet 继续串行渲染，并在整组内共用一次素材下载。最后一帧读取完后才停止，不会每一帧重建 VM。
- 默认截帧改用 2 vCPU / 4 GiB，支持独立的 `REMOTION_PREVIEW_SANDBOX_VCPUS`。保留原 `REMOTION_SANDBOX_VCPUS` 覆盖；无有效配置时用合法默认值。
- Sandbox MP4 fallback 仍为 8 vCPU；当前生产 Lambda MP4 导出路径保持原配置。
- `stop` 最多等待 10 秒；创建 RPC 在取消后才返回时仍安排 stop。清理失败不丢弃已生成的图像，10 分钟生命周期保留为兜底。
- 普通媒体执行器维持既有 4 核与 finally-stop，避免同时改变 FFmpeg 重任务容量。

## 真实对比

直接调用当前应用的 `renderDesignFrame` / `renderDesignFrames`，使用线上现有 Remotion Snapshot。没有新建或晋升 Snapshot、没有改共享环境配置、没有调用收费模型、没有写业务数据库。

三个固定工作负载均为 1080×1920：中文/英文字体；视频加字幕；四视频拼贴加字幕。固定取第 30、90 帧。素材为 W3C 托管的 Sintel 测试视频。

| 单帧调用耗时，含客户端/网络 | 原 8 核 | 原逻辑仅改 2 核 |
|---|---:|---:|
| 文字，帧 30 / 90 | 4.744 / 3.474 秒 | 4.220 / 2.547 秒 |
| 单视频，帧 30 / 90 | 7.187 / 4.787 秒 | 8.266 / 4.947 秒 |
| 四视频，帧 30 / 90 | 4.880 / 5.364 秒 | 5.741 / 5.885 秒 |

两种规格的 6 张 JPEG 全部逐字节一致。样本少，网络与冷启动波动存在，不据此宣称所有负载无速度退化。

随后以候选整组清理逻辑重新运行，每个任务包含两帧：

| 候选 2 核 | 两帧整组耗时，含创建/停止 | Vercel 实际 VM 存活时间 | 最终状态 |
|---|---:|---:|---|
| 文字 | 8.195 秒 | 7.466 秒 | stopped |
| 单视频 | 9.605 秒 | 9.295 秒 | stopped |
| 四视频 | 8.934 秒 | 8.738 秒 | stopped |

候选的 6 张 JPEG 同样与原 8 核基线逐字节一致，已检查对比图。真实实例均返回 `vcpus=2`、`memory=4096`、`status=stopped`。证据：`artifacts/sandbox-cost/candidate-2/stopped-instances.json`、`pixel-verification.json`、`comparison.png`。

局部验证：生命周期、跨项目隔离、单次素材下载、取消、晚到的 create、410 重试、清理失败、导出规格等测试，以及已有 Preview/Export 回归；TypeScript 检查通过。具体测试结果见本任务最终回报。

## 成本估算与上线顺序

官方当前内存计价为 `$0.0212 / GB-hour`，按分配容量乘存活时长收费，至少计 1 分钟；每核配 2 GB RAM：
https://vercel.com/docs/sandbox/pricing

按相同计量单位的理论比较：

- 原 16 GB × 10 分钟：约 `$0.05653 / VM` 内存费用。
- 仅从 8 核降至 2 核、存活时间不变：该项下降 75%。
- 2 核 / 4 GB、任务在 1 分钟内结束即停：约 `$0.001413 / VM`，较原 10 分钟 VM 下降 97.5%。
- 2 分钟任务即停：约 `$0.002827 / VM`，下降约 95%。

这些比例仅对应一次 VM 的内存计费。旧 VM 可能复用多个独立请求；新逻辑按任务建 VM，调用次数、CPU、网络、最低计费、实际缓存命中均会影响最终总费用，不能承诺整张账单下降相同比例。

建议先以 `REMOTION_PREVIEW_SANDBOX_VCPUS=8` 验证自动回收在隔离 Preview 的真实保存项目、连续 Agent 多轮、contact sheet、失败/取消上的完整路径，再在候选环境验证 2/4 核，最后按用户明确发布授权晋升。回退规格用 8 核覆盖，生命周期改动回退本候选提交。

## 待补的验收与风险

- 本轮验证了真实远程 Snapshot 渲染，但还没有隔离 Preview 的完整 `makaron chat → run_code → preview_frame` 和真实历史大项目回放。
- 4K、多层超大视频、复杂 SVG/滤镜尚未覆盖；4 GiB 可能不足，需要通过专用规格覆盖或后续自适应分档处理。
- 独立工具调用不再复用上一任务的 VM/下载缓存，大文件可能增加冷启动和重复下载时延。同一次 contact sheet 的下载缓存已保留并测试。
- 920 个 5 分钟实例与生产现行 10 分钟配置不同，可能由旧部署或脚本创建，未逐个确定来源；应用改动不能保证修复所有实验脚本。
- 未删除历史 Snapshot；其费用小，且可能是生产或旧部署兼容依赖。
- 未部署，所以没有上线后真实节省金额。

## 复现

只读审计（使用已登录 Vercel CLI，指定有 `.vercel/project.json` 的项目根目录）：

```sh
SANDBOX_AUDIT_PROJECT_PATH=/path/to/linked/project node scripts/audit-sandbox-cost.mjs
```

远程基准需要将生产配置仅保存到当前 worktree 的 `.env.sandbox-cost.production`（gitignored，勿输出凭据），以及可读的 Vercel CLI 登录。会创建临时计费 VM，finally 停止自己创建的实例：

```sh
BENCHMARK_MODE=candidate BENCHMARK_VCPUS=2 SANDBOX_AUDIT_PROJECT_PATH=/path/to/linked/project node --import tsx benchmarks/sandbox-preview-cost.ts
```

`BENCHMARK_MODE` 未指定时使用单帧调用；本地候选已经改变底层生命周期，重跑不会重现旧 pool 行为。历史基线 JSON 已保留，不能将候选重跑误记为原逻辑。
