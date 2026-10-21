# Makaron Sandbox：真实大项目隔离 Preview 验收

后续更新：本文件保留第一轮未通过的历史结果。恢复速度、跨进程缓存与截图持久化的修复及三轮通过证据，见[后续修复验收](makaron-sandbox-preview-recovery-acceptance-2026-10-21.md)。

2026-10-21。独立 worktree：`makaron-sandbox-cost/ai-image-editor`，分支 `codex/makaron-sandbox-cost-20261021`。未合并、未发布生产。

## 当前结论

4 vCPU / 8 GiB 在同一暖 VM 上的连续多帧检查，与 8 vCPU / 16 GiB 对照接近，输出逐字节一致。2 核在重复测试中出现显著延迟，已将代码默认值改为 4 核，2 核仅保留显式配置能力。

**25 秒空闲释放后的体验尚未通过“无明显影响”验收。** 磁盘快照避免了重新下载大素材，但恢复后多帧仍较慢；真实 Agent 跨函数进程也未命中模块内缓存。这份结果支持继续优化候选，不支持宣称整体体验已经无损。

## 环境与真实项目

- 最终 4 核 Preview：<https://ai-image-editor-nw1mh5qmd-vegekyd-sys-projects.vercel.app>，部署 `dpl_5oA8gkkzKNXk1RcBAZRXsQSB1V6w`，Ready；构建来源 `1d159ca4`，deployment-only 覆盖 `REMOTION_PREVIEW_SANDBOX_VCPUS=4`、`REMOTION_PREVIEW_IDLE_MS=25000`。之后的源码改动仅将默认值由 2 改为已测的 4，并调整说明和测试，运行路径一致。
- 8 核对照：<https://ai-image-editor-poger7zac-vegekyd-sys-projects.vercel.app>，同一渲染实现、8 核、600 秒保留，用于容量与保温对照；不是整个旧版本的逐提交重放。
- 2 核快照实验：<https://ai-image-editor-pyv2h2j0n-vegekyd-sys-projects.vercel.app>，用于复现 2 核与恢复开销，不是推荐规格。
- 真实源项目“珊瑚验厂-外到内新版”，`f309f3d6-02a0-4194-85e6-9cb21d9161ad`，保存版本 `04fd195f-e442-5c6e-8f0d-c2b3c2896a89`。冻结副本：1080×1920、20 秒、30 fps、16,317 字符代码、8 路视频，另有配音及音乐。8 路视频 HEAD 合计 `458,524,121` 字节；这是素材体量大的项目，不代表长片或 4K 验收。
- 私有验收项目 `a4aa309f-11f7-46b1-9da0-fadf2006c2a3`，原样保存的验收 snapshot `8e8e6376-0d3b-4056-b7f7-1b5c71d4d51c`，由现有 CLI 账号拥有。原项目只读。未新生成媒体、未导出 MP4、未 publish。
- Preview 与生产仍连接同一数据库；隔离的是部署、私有项目行及 VM 归属，不是独立数据库。没有改共享 Preview 环境变量、git-dev 域名或生产 renderer / snapshot 配置。
- 使用当前生产 Remotion Snapshot `snap_xKNcVFyBs764bsOBBWwWQ2a1Hy1m`，保留 ABI；没有升级 SDK 或晋升新的公共运行时快照。MP4 主导出仍为 Lambda。

## 同条件连续多帧对照

每批固定 `[30,120,210,300,390,480,570]` 七帧，两个 Preview 同时开始，连续三批。下表为服务端渲染用时，含缓存检查、命令调用、JPEG 读取和内存采样；客户端另有 CLI、网络及 workspace 读取开销。

| 同暖 VM，7 帧 | 8 核对照 | 4 核候选 |
|---|---:|---:|
| 第 1 批 | 24.707 秒 | 24.444 秒 |
| 第 2 批 | 25.146 秒 | 23.581 秒 |
| 第 3 批 | 23.916 秒 | 24.444 秒 |
| 中位数 | 24.707 秒 | 24.444 秒 |

4 核相同三批客户端时间为 29.361、29.248、29.404 秒；8 核为 29.881、30.445、29.493 秒。全部七个位置的 JPEG SHA-256 与对照一致。已查看真实七帧及原生 Agent contact sheet，没有发现降规格导致的黑帧、缺素材或比例变化。

实际 Linux `cgroup-v2 memory.peak`：4 核三批峰值 `1,732,960,256` 字节，约 **1.61 GiB / 分配 8 GiB**；对照约 1.62 GiB / 16 GiB。包含整个 VM 的内核计账与缓存，不是 Node heap 推算。预取采用流式落盘，八个文件不同时装入 Agent 堆。

2 核第一轮七帧曾达到 24.991 秒，容易误判无退化。补测后，恢复的 2 核 VM 两批暖态仍需 38.019、36.879 秒，同轮 8 核仅需 24.014、25.697 秒。因此没有采用该最好单次结果作为结论。

证据：`artifacts/sandbox-cost/large-project/paired-four-results.json`、`paired-warm-results.json`、`large-project-contact-sheet.png`。这些本地验收产物 gitignored；报告与实现进入分支。

## 25 秒释放与恢复

按用户给出的 20–30 秒等待范围，候选在最后一个租约结束 25 秒后开始停止／做磁盘快照，活跃渲染期间不释放。使用 Next `after(Promise)` 保证响应结束后清理仍被执行；并发同 scope 操作串行，失败／取消立即退休。

| 实际场景 | 持续保温的 8 核 | 候选 |
|---|---:|---:|
| 不保留磁盘，闲置 35 秒后单帧 | 4.462 秒 | 2 核 64.406 秒，预取 58.746 秒：拒绝 |
| 保留磁盘，闲置 35 秒后单帧 | 4.462 秒 | 2 核 9.796 秒，再一次 9.462 秒 |
| 保留磁盘，闲置 35 秒后七帧 | 23.714 秒 | 4 核 33.323 秒，预取仅 0.658 秒 |
| 恢复 VM 后立即再查七帧 | 此轮对照换 VM，不作暖态比较 | 4 核 30.415 秒，仍比候选释放前暖态慢 |

4 核第一次完全冷启动单帧 57.514 秒，52.446 秒为素材下载；原 8 核冷启动样本 53.842–56.945 秒。网络波动影响较大，不据单次样本作严格相等判断。

磁盘快照只保存文件，停止付费计算资源。初次尝试 15 分钟过期被在线 API 拒绝，实际最短一天；已改为一天。每个模块、归属、来源及运行时组合只创建一次快照，后续恢复与停止复用同一份，避免每轮累积。

最后一批 8 核对照也换到了新 VM，预取 55.498 秒、总计 80.279 秒。这说明对照的进程内池也不能保证跨请求总是暖态；该轮不能用来宣称候选恢复后比旧方案快。

已用供应商清单核对 2 核回放：`sbx_xSA5CSG3DwmsIfEgkuaZR1YdDwdk` 做出 `snap_RLDboCyCvgptETFPlO4mhHUCsgHb` 后停止；两个恢复 VM `sbx_QZxaqmnsXSV4e2v5svrOp0hUOPJ6` 和 `sbx_augUn9LUKqMawRexjYKF4FDzxndD` 都以此为 `sourceSnapshotId`，均为 stopped，存活约 35 秒。没有每次生成一份新快照。初次快照停止会额外花数秒，需区分 25 秒开始释放与停止完成。

最终 4 核同样已核对：初始 VM `sbx_1lB1rGyha8HNMMrlPqe6Txe9XkzN` 存活 173.744 秒，快照 `snap_fHYHoUC0vkzMS9SpCIrsizvBy9EF`；恢复 VM `sbx_BnEoX8Pqr2kJaqMXLgh0nJJ76UkW` 存活 94.792 秒、来源为同一快照，两者 `vcpus=4`、`memory=8192`、最终 stopped。快照大小 `1,021,253,056` 字节。原始记录：`latest-4-instances.json`、`latest-checkpoints.json`。

## 真实 Agent 多轮

使用已安装 Makaron CLI `chat` 与 `responses get --wait`，指向隔离 Preview，通过现有用户 API 身份执行。没有改 Agent 模型，实际为默认 `deepseek-flash`。

2 核 Preview 已完成两轮真实路径，数据库 `agent_events` 确认实际执行工具，不仅检查终态：

| 轮次 | run ID | 实际动作 | preview_frame 工具耗时 | 客户端总耗时 |
|---|---|---|---:|---:|
| 1 | `67681447-3d69-4c30-bb5b-75037022af8b` | read_file → run_code 幂等 props patch → preview_frame [4,10,16] → 读取实际图像 | 72.468 秒 | 121.255 秒 |
| 2 | `d1726733-7bf3-47cf-a9ab-7f13d6861044` | preview_frame [6,12,18] | 67.325 秒 | 83.240 秒 |

两轮 completed，实际三帧 contact sheet 已下载查看。原始输出和事件在 `agent-round-*-result.json`、`agent-events-*.json`、`agent-*-capture.jpg`。

最终 4 核又执行了两轮相同原生路径：

| 轮次 | run ID | 工具序列 | preview_frame 工具耗时 | 客户端总耗时 | 图片交付证据 |
|---|---|---|---:|---:|---|
| 1 | `ed6e5bbd-fdff-4a4a-b363-7cc673ba2f47` | run_code ×3 → preview_frame [4,10,16] | 66.805 秒 | 94.836 秒 | 3 帧、contact sheet 和 captured 事件齐全 |
| 2 | `aea3ecd6-d03b-4739-a2d6-a9e733ca3a02` | preview_frame [6,12,18] | 72.603 秒 | 95.722 秒 | completed，但没有 captured 事件／文件索引，图片持久交付未通过 |

第 2 轮 `tool_result` 标记为移除预览像素的正常结果，Agent 给出了画面描述，但没有 `workspaceUrl` 对应的前端事件，按该时间段查询也未找到这轮四个 JPEG 的 `workspace_files` 索引。不能因 completed 就声称完整 CUI 图片交付成功；未将原因唯一归于本次降本，存储写入或索引失败原因尚未定位。第 1 轮 contact sheet 已保存查看。原始事件、结果及索引查询保存在 `agent-four-*`、`agent-events-*.json`。

**缓存限制：** 原生 Agent 各轮对应不同 VM，约 477–480 MB ingress，各自从基础运行时启动；其 source-set VM 池和磁盘恢复指针仍是模块局部，跨函数进程没有保证。未记录函数实例 ID，未将某次 VM 未命中唯一归因于特定调度原因。旧实现在这点上也只有进程内池，本次未添加共享存储协议。因此私有测量端点的连续命中，不能代表所有用户多轮均能命中。

## 成本边界

官方当前内存价格为 `$0.0212 / GB-hour`、每核 2 GB，至少一分钟；快照存储 `$0.08 / GB-month`。来源：[Sandbox pricing](https://vercel.com/docs/sandbox/pricing)、[Snapshots](https://vercel.com/docs/sandbox/concepts/snapshots)。

- 同样计算存活时长，4 核分配内存从 16 降到 8 GB，该项减少 50%。空闲释放可以进一步减少计算资源时间，但不是整张账单降幅承诺。
- 最终 4 核这组六次调用的两个 VM，按实际存活时间计，内存约 `$0.01265`，加一天快照约 `$0.00272`，合计约 `$0.01537`；与 16 GB 连续保留 600 秒的 `$0.05653` 比约少 73%。这是限定序列的内存加存储估算，且体验尚未全通过，不能直接推广到真实总费用。
- 实测一份快照约 1.01 GB，按 30 天折算的一天存储约 `$0.0027`。真实 API 最少保留一天；不同函数进程可能产生重复快照，需要计入，而不能当作免费缓存。
- 2 核六次回放三 VM，按真实 duration、各 VM 至少一分钟计，内存约 `$0.00667`，加一天快照约 `$0.00937`；对照单个 16 GB、600 秒约 `$0.05653`。约 83% 只是这组被否决的 2 核序列的内存加存储估算，不能套用为最终 4 核方案或账单实际降幅。
- CPU、流量、函数后台等待、重复快照、缓存未命中和构建费都另计。最终生产节省需发布后按相同调用量对照账单。当前生产尚无本分支带来的实际降幅。

## 验证与交付状态

最后规格调整后，针对生命周期、素材缓存、多帧隔离、取消、错误和导出的 9 个测试文件 **39 项通过**，`tsc --noEmit` 通过，`git diff --check` 通过。远程 Preview build Ready。测量端点仅在 Preview 且显式开启时存在，并绑定验收用户、私有项目和该项目 snapshot；无认证返回 401、错误项目返回 403，生产路径返回 404。

内置浏览器已展示最终 Preview 首页且未见 console error/warning；该新域名浏览器没有 Makaron 登录态，因此不声称已完成编辑器 GUI 全流程。真实身份、模型、工具和持久化回包使用原生 CLI 验证。未测 4K、长片、超多层滤镜，也未进行生产发布。

验收测量 VM 已核对停止；单独停止了自己创建、测试完成后仍保温的 8 核对照 VM，没有停止其他项目／任务的实例。测试快照均保留自动到期，不删除运行时基线。

本轮保留 4 核与 25 秒释放候选；严格的体验验收仍需解决释放后的延迟、跨进程缓存命中，以及最终原生第 2 轮的截图持久交付缺口。原始审计与较早即时释放实验见 [成本审计](makaron-sandbox-cost-2026-10-21.md)，其早期结论已由本报告的真实大项目结果更新。
