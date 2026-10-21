# Sandbox 恢复、共享缓存与截图持久化：修复验收

2026-10-21。独立分支 `codex/makaron-sandbox-cost-20261021`，运行时代码 `f8f04d24`。Preview：<https://ai-image-editor-izeapqkkp-vegekyd-sys-projects.vercel.app>，部署 `dpl_5BuGNeoPM3UEaktcfLjkHrdzFQXQ`，Ready。未合并、未发布生产；没有修改共享 Preview 变量、git-dev 别名或生产 Snapshot。

## 结论及范围

同一个真实大项目的三轮原生 Agent 检查通过：首次冷启动之后，间隔 35 秒的第二、三轮均在约 30 秒内完成；实际工具、共享快照、永久截图、文件索引、CUI 回放事件和消息关联均已核对。

暖态七帧和快照恢复七帧接近或快于原 8 核对照。单帧释放后仍有可量化的重建开销：6.331 秒，对照保温 4.773 秒，约多 1.6 秒。因此这里的通过指本项目、多轮、多帧、持久交付路径，不是承诺每种请求都零恢复开销或所有项目都无需更高规格。

沿用上轮冻结的“珊瑚验厂-外到内新版”：1080×1920、20 秒、30 fps、8 路视频约 459 MB、另含配音和音乐。私有副本 `a4aa309f-11f7-46b1-9da0-fadf2006c2a3`；原项目只读。本轮不生成新媒体、不导出、不 publish。沿用现有 SDK 和生产 Remotion Snapshot，实际快照 renderer 为 4.0.448，没有替换共享运行时。数据库仍是共享数据库，测试只写私有副本及服务端私有缓存。

## 修复

1. **一批帧共用浏览器与 composition 解析。** 原先每帧都启动 Node、打开浏览器并重新选择 composition；现在同一批次只打开一次浏览器，仍按精确帧号串行 capture。没有通过缩放、降 JPEG 质量、减少检查帧数或代理素材加速。曾探索稀疏 `renderFrames`，但固定运行时忽略新 `frames[]` 参数且 `everyNthFrame` 对齐规则与本地版本不同，已放弃该路径；最终使用已验证的 `renderStill`，避免渲染额外帧或移动时间线。
2. **跨进程持久检查点。** `remotion-preview-cache` 是私有 Supabase bucket，只存不到 1 KB 的快照指针，不存源视频。键包含用户／项目 scope、素材集合、运行时与 CPU 规格；Preview 再按 deployment 隔离。指针不放在用户可改写的 workspace 中。首次批次完成后立即开始制作并保存检查点，通常数秒内可供另一个函数进程读取；恢复的 VM 空闲 25 秒后停止，复用既有检查点。没有共享一个可被并发写入的活动 VM。
3. **截图持久化。** 现场原始日志确认上传与索引曾出现 `fetch failed`，并伴随 Supabase 请求 `ETIMEDOUT`；原代码忽略失败，返回图像但没有 workspace URL，因而未产生 CUI 截图事件。现对相同 bytes／相同主键的幂等上传与索引 upsert 做最多三次重试，间隔 250／1000 ms；权限等永久错误不重试。Remotion 分支的任意帧或拼图保存失败会明确返回持久化错误，不能再以空 URL 宣称成功。不会重试付费生成提交。

私有 bucket 已创建并核对为 `public=false`，上限 16 KiB、仅 JSON；没有新增业务表、修改 RLS 或开放用户访问策略。准备脚本：`scripts/setup-remotion-preview-cache.mjs`。实际跨进程读写成功；匿名访问的 HTTP 验证另存验收产物，不能把网络错误当作权限拒绝。

## 大项目回放

下表均为服务端耗时；客户端另有 CLI、网络及 workspace 读取开销。

| 请求 | 本轮 4 核／8 GiB | 说明 |
|---|---:|---|
| 完全冷启动单帧 | 62.998 秒 | 下载 56.952 秒；同批 8 核对照冷启动 63.443 秒、下载 57.057 秒 |
| 从磁盘检查点恢复，七帧 | 23.811 秒 | 七帧 `[30,120,210,300,390,480,570]`；前轮 4 核恢复为 33.323 秒，8 核暖态三轮中位 24.707 秒 |
| 同 VM 暖态七帧 | 20.917 秒 | 同一组帧，8 核暖态中位 24.707 秒 |
| 不规则三帧 | 11.587 秒 | `[75,211,501]`，验证不是只支持等间距采样 |
| 闲置 35 秒后七个新位置 | 24.585 秒 | `[60,180,270,360,450,510,585]`；同帧 8 核这次暖态 38.536 秒，机器波动较大，不只引用这一较慢对照 |
| 绕过本地池，读取共享检查点，七帧 | 29.173 秒 | `freshSession=true` 是全新池的验证，不冒称启动了新 OS 进程；实际进程间命中见下节 |
| 再闲置 35 秒后单帧 | 6.331 秒 | 同帧 8 核保温 4.773 秒；保留这个差异，不称为完全无感 |

所有有同帧对照的 JPEG SHA-256 一致，包括新增七个位置和不规则三帧。原生检查第 540 帧另与前轮已保存帧核对。已查看真实帧图和三轮拼图，未发现本改动造成的黑帧、缺素材或比例变化。

本轮最大 `cgroup-v2 memory.peak` 为 `1,718,886,400` 字节，约 **1.60 GiB / 分配 8 GiB**。这是整个 VM 的内核高水位，包含缓存，不是仅 Node heap。无 OOM。CPU 保留 4 核；没有因内存够用就重新启用曾回退的 2 核。

源证据位于 `artifacts/sandbox-cost/large-project/`：`candidate-shared-batch-4/results.json`、`control-unseen-8/results.json`、`shared-metrics.json`、原始帧及 `agent-shared-*-capture.jpg`。这些本地产物 gitignored；报告、实现与测试进入分支。

## 三轮真实 Agent 与截图

使用安装的 Makaron CLI，指向本次 Preview，正常 API 用户身份，默认 `deepseek-flash`，未覆盖模型。每轮完成后再等 35 秒，避免把 25 秒保温内的命中误认作恢复成功。

| 轮次 | run ID | 实际工具 | 工具耗时 | 客户端总耗时 | 永久交付 |
|---|---|---|---:|---:|---|
| 1 | `1267a6e7-8461-4317-9443-eb8ee0857a7a` | run_code 幂等 props patch → preview_frame [4,10,16] | 64.592 秒 | 81.232 秒 | 3 帧＋拼图，4 文件、captured 事件、has_image 消息齐全 |
| 2 | `0a8864bc-47b1-400c-906a-d7c7ebbc5c2d` | preview_frame [6,12,18] | 16.619 秒 | 30.023 秒 | 同上 |
| 3 | `946cdfcb-0be3-4f61-bb9e-3d00a8d06910` | preview_frame [2,9,17]，三个新位置 | 13.317 秒 | 29.919 秒 | 同上 |

全部 completed；不是仅根据终态判定。数据库事件确认执行；每轮四条文件索引、12 个文件 HTTP 200、图像及对应消息 `has_image=true` 已核对。截图 URL 保存在 `agent_events`，由现有项目回放逻辑还原，不要求 URL 出现在消息正文。

原生首轮的进程标识为 `7ff39ad8-a0f3-4a4f-9055-484561d546bd`；第三轮为 `d22c5d56-4873-40ec-bd78-e3b9f04e5b46`，明确不同。第三轮日志为 `cacheOrigin=shared-checkpoint`，三个新位置的素材预取只需 0.711 秒。第二、三轮的 VM 均以首轮检查点 `snap_eSUYj4qcZQhfY2SCbaST0bKbDvES` 为 source，不是重新从基础快照下载八个源文件。供应商记录的 ingress 分别约 16.6 MB／6.6 MB，首轮约 473 MB。

本次同时启动的测量端点与 Agent 在首轮都未命中，各自创建了一份约 1 GB 的检查点。之后共享指针指向其中一份，跨进程恢复已验证。**当前没有全局并发冷启动 single-flight**，不宣称并发首次请求必定只生成一份快照；两份成本均已记录，旧快照按期限到期。

另做真实存储故障注入：第一张 JPEG 上传人为抛出 `fetch failed`／`ETIMEDOUT`，第二次成功，索引存在，下载 HTTP 200 且原始 bytes 一致。持久网络失败与权限错误不被伪装成成功，对应失败分支已由测试验证。

相关回执：`agent-shared-verification.json`、`agent-shared-message-verification.json`、`agent-shared-models.json`、`frame540-prior-verification.json`、`persistence-retry-live.json`、`agent-events-*.json`。

## 实际资源与成本

按供应商列表的运行时间、Active CPU 和 egress 建模，采用 [Vercel 当前 iad1 计价](https://vercel.com/docs/sandbox/pricing)：内存 `$0.0212/GB-hour`，CPU `$0.128/hour`，快照 `$0.08/GB-month`，creation `$0.60/1M`。网络另按 `$0.15/GB` 作保守上界；当前 Pro 文档将其计入 Flat Rate CDN，不能把这个上界冒称实际单独扣款。

三轮原生 Agent 的 Remotion 截帧对应三个 VM，全部已停止。普通 `run_code` 的媒体 VM 仍按原逻辑计费，不纳入本次截帧节省比较：

| VM | 存活时间 | 来源 |
|---|---:|---|
| `sbx_HcORvDEWKXNWFBDUg24XDU3o9wBp` | 66.571 秒 | 基础快照，首次下载 |
| `sbx_a7RpQdXt1gmOA3V7sTnwh7YaKAQA` | 40.683 秒 | 共享检查点恢复 |
| `sbx_Nyc2FAaNQqaF5b87nInKWbhAysvq` | 37.009 秒 | 同一共享检查点恢复 |

| 三轮截帧资源估算 | 金额 |
|---|---:|
| 内存（每 VM 至少一分钟） | $0.00879 |
| 内存（再保守地按整分钟向上取整） | $0.01131 |
| 实际 Active CPU | $0.00263 |
| egress 上界 | $0.000665 |
| 一份检查点一天 | $0.002676 |
| 三次 creation | $0.0000018 |
| **合计** | **约 $0.0148–0.0173** |

旧方案即使三轮都共用一个 16 GB、保留 600 秒的 VM，**仅内存**也约 `$0.05653`，尚未计 CPU 与网络。用候选上述全部直接资源费与这个较低旧成本相比，降幅约 **69–74%**。这是本项目三轮序列的费用测算，不是整张账单已下降，也不意味着旧版每三轮总能复用同一个 VM。

测量端点七次调用＋原生 Agent 三轮，共 8 个 Remotion VM、两份检查点，按每 VM 至少一分钟与一天快照估算，直接费用上界合计约 `$0.0419`；不含单独的对照、前期兼容性探测、普通媒体执行、构建、模型及函数费用。所有候选 VM 已核对 stopped，也停止了自己创建、验收后仍保温的两个 8 核对照，没有停止其他任务实例。

**账单预测：同等用量的一张 $300 级账单，保守预计省约 $110–150，降到约 $150–190。** 计算只使用已核实的 `$196.30` Sandbox 内存费，假定其中 85–95% 归属于可改造的 Remotion 路径，并为其他项目、普通媒体和计量差异留出空间；对这部分采用 65–80% 的净节省情景，约 `$108–149`。其余 SKU 先视为不下降，不把 CPU 可能的额外收益算进去。情景低端低于本项目实测降幅，作为函数后台等待、元数据请求、快照数量及素材更替差异的余量。

上述范围依赖调用密度、源集合复用和项目分布。SDK 使用可能顺延检查点到期时间；静态指针到期后会重建，所以活跃项目可能出现短期快照重叠。不能将“一份快照一天约 $0.0027”误认为整个平台所有项目的快照总费。最终应发布后用同等调用量和实际快照 GB-days 对账；目前生产没有本分支产生的已实现节省。

费用原始量及公式：`shared-resource-cost.json`、`shared-cost-model.json`、`shared-final-instances.json`、`shared-final-snapshots.json`。

## 验证、配置与下一步边界

针对改动的 12 文件 54 测试通过；现有图片回调与 DualWriter 的 2 文件 39 测试通过，合计 **14 文件 93 项**。`tsc --noEmit`、`git diff --check` 通过，远程构建 Ready。覆盖跨来源／部署隔离、过期指针、共享读取、取消及租约、批量输出顺序、网络重试和截图失败不得返回成功。

本 Preview 使用下列 deployment-only 配置：

```text
REMOTION_PREVIEW_SANDBOX_VCPUS=4
REMOTION_PREVIEW_IDLE_MS=25000
REMOTION_PREVIEW_SHARED_CACHE=true
REMOTION_PREVIEW_BATCH_RENDERER=true
```

共享缓存与批量浏览器仍由上述两个开关显式启用；准备私有 bucket 的脚本需服务端环境。回退可关闭两个开关并覆盖为 8 核，但跨进程重新下载与旧成本也会回来；不能只合并源码、不带配置就声称启用了本轮方案。

内置浏览器已展示新版 Preview 首页。新域名未登录编辑器，不能据此声称编辑器 GUI 全流程通过；真实用户身份、多轮工具与图片持久回放证据通过原生 CLI 和持久化记录验证。未测 4K／更长或更复杂项目，MP4 Lambda 主路径未变。

生产发布保留为后续单独动作。本轮交付是可复核的 Preview、代码、测试、真实项目回执与成本模型。前轮未通过结论保留在[上一轮报告](makaron-sandbox-large-project-preview-acceptance-2026-10-21.md)，已由本轮结果更新。
