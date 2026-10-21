# Sandbox 降本方案：生产发布与真实调用验收

2026-10-21，用户明确授权上线。已合入 canonical `dev` 并推送，按 `npm run release:prod` 发布。生产版本 `f8a885aa166fef0297a33e2f95c60613fefb4cdc`；部署 `dpl_HF3cJTtBcqeqfoYVLftD9pJBVim8`，Ready，规范域名 <https://www.makaron.app> 已指向该部署。运行时代码来自 Preview 验收的 `f8f04d24`，同时保留此前已上线的 `a33fec24` 4K 导出修复。本文是发布后的验收，先前报告的“未上线”属于历史阶段。

## 生产配置与发布检查

生产环境已写入、回读并在真实日志核实：

```text
REMOTION_PREVIEW_SANDBOX_VCPUS=4
REMOTION_PREVIEW_IDLE_MS=25000
REMOTION_PREVIEW_SHARED_CACHE=true
REMOTION_PREVIEW_BATCH_RENDERER=true
REMOTION_PREVIEW_METRICS=true
```

原 `REMOTION_SNAPSHOT_ID`、`MEDIA_SANDBOX_SNAPSHOT_ID` 均保留，MP4 仍使用 Lambda；未升级 SDK 或运行时快照。私有 `remotion-preview-cache` bucket 已用生产服务端配置验证：`public=false`、16 KiB 上限、只存检查点指针。生产内部 QA 测量端点实测返回 404，没有启用 Preview 专用验收接口。

发布门禁补跑受控路由预检：3/3 通过、媒体操作 0。完整 Vitest 2547 项通过、1 项跳过；CLI smoke、TypeScript、生产构建与服务器依赖打包检查均通过。上线后 `/api/health` 12/12 healthy。生产首页及更新弹窗在内置浏览器核对，未见 console error/warn。

CLI/npm 无新增参数或对外合同，未发包；npm `latest` 为 `makaron-cli@0.17.4`。registry 全新安装后核对版本、chat help，实际打包的 9 个文件与仓库逐字节一致。下述生产调用使用这份全新安装的 CLI。

canonical 工作区原有两项其他任务修改临时保存后已原样恢复，二进制 diff 与发布前一致，没有纳入发布提交。

## 真实大项目四轮

沿用已验收的私有副本 `a4aa309f-11f7-46b1-9da0-fadf2006c2a3`，冻结源为“珊瑚验厂-外到内新版”：1080×1920、20 秒、30 fps、8 路视频约 459 MB，另有配音和音乐。原项目只读。默认 DeepSeek Flash，原生 `makaron chat → preview_frame`；首轮另有一次幂等 props patch。每轮 completed 后等待 35 秒，再开始下一轮，不把 25 秒保温内的调用当成恢复。

| 轮次 | 实际时间点（秒） | preview_frame 工具耗时 | CLI 总耗时 | 预取 | 永久文件 |
|---|---|---:|---:|---:|---:|
| 1，冷启动 | 4,10,16 | 68.007 秒 | 81.942 秒 | 51.999 秒 | 3 帧+拼图=4 |
| 2，释放后 | 6,12,18 | 14.318 秒 | 29.637 秒 | 0.637 秒 | 4 |
| 3，释放后 | 2,9,17 | 15.261 秒 | 29.498 秒 | 0.672 秒 | 4 |
| 4，释放后 | 1,7,10,13,16,19 | 21.272 秒 | 38.867 秒 | 0.679 秒 | 6 帧+拼图=7 |

四轮 run ID：

- `7e97fb49-042e-4c46-bf44-c049427a4a8f`
- `7af6f971-1a60-4faf-ad91-90c7d13a56d1`
- `5ed1babc-bf89-4526-a577-4da6a0f47211`
- `4a790550-c9cb-485a-8eae-eee313641931`

四个进程标识分别为 `99d50934-a84c-419d-942b-78de19851544`、`3c1b529d-dda9-4715-a8fc-ee9ac6d0b99e`、`d479341d-7083-48b6-97c9-28c217323a68`、`c5319b7a-9ee4-4c0a-9b11-2b69461a5625`。后三轮日志均为 `cacheOrigin=shared-checkpoint`，对应 VM 的 sourceSnapshot 均为首轮创建的 `snap_E7FDEJmiCqnPxUkEw4TyuqhqUWhn`，证明生产实际跨进程命中。它们的 ingress 约 8.2、9.5、8.1 MB，冷启动约 467.4 MB。

内核 `cgroup-v2 memory.peak` 最大 1,725,935,616 字节，约 **1.61 GiB / 分配 8 GiB**。四个 VM 寿命为 73.645、38.609、39.110、45.099 秒，全部自动到达 stopped，无手动停止或影响其他生产任务。

第四轮最初计划七帧，Agent 实际选择六帧。补发严格七帧请求 `9104723b-4b52-443d-ab45-06273188b2ed` 后确认：现有 Agent `preview_frame` schema 每批上限 6 帧，超限校验拦截，没有产生 VM 或截图。因此这次生产验收为 **四轮有效渲染、每批最多六帧**；七帧属于之前 Preview 的底层渲染器验收，不混作生产 Agent 成功证据。没有为测试扩大工具合同。

## 截图持久化

19 个永久文件全部重新下载 HTTP 200：15 张独立帧、4 张拼图。15 张独立帧 SHA-256 全部与已验收基线一致，实际查看拼图，未发现本改动导致的黑帧、素材缺失或比例变化。

四轮均有 `workspace_files` 索引、`preview_frame_captured` 事件和对应 `messages.has_image=true`，事件的 messageId 与消息匹配，具备现有 CUI 重开回放所需记录。未把图片仅存在某次内存响应当成持久化成功。本轮通过 CLI、服务端事件及永久图片回读验证；未登录编辑器 GUI，不宣称 GUI 全流程已验收。暂时网络故障重试的真实注入证据沿用 Preview；没有在生产人为制造服务故障。

## 实际资源计量与费用

供应商 API 核实上述四个 `iad1` Remotion VM 和一份 1,003,580,013 字节的检查点；排除同期其他项目、普通媒体执行、Agent 模型、函数及构建费用。四个 VM 的内存按每实例至少一分钟和更保守的整分钟进位给出两种计量，CPU 使用供应商 `activeCpuDurationMs`，没有把预留核数乘墙钟时间当成活跃 CPU。

按 [Vercel 当前公开计价](https://vercel.com/docs/sandbox/pricing)（内存 $0.0212/GB-hour、CPU $0.128/hour、快照 $0.08/GB-month）：

| 项目 | 四轮费用 |
|---|---:|
| 内存 | $0.01195–0.01413 |
| 活跃 CPU | $0.004412 |
| VM 创建 | $0.0000024 |
| 一份检查点完整保留一天 | $0.002676 |
| 传出流量保守上界 | $0.000931 |
| **合计，含一天快照预留** | **$0.01904–0.02216** |

Pro 的 Sandbox transfer 包含在 Flat Rate CDN；上界仍按区域表 $0.15/GB 留余量，不能把上界说成 Pro 实际另收的 Sandbox 网络费。截至计量时点的快照实际存活仅数分钟，存储累计约 $0.000015；表中一天费用是预留，并非此时已收取一天费用。

旧版一个 16 GB VM 保温 600 秒，仅内存就约 $0.05653，CPU/网络另计。用本次四轮全部上述资源费用与旧版这一内存下限比较，降低约 **61–66%**。这是本项目序列的供应商真实用量乘单价，**不是已结算账单，也不代表整月已经省下该比例**。

同等月用量预计节省 $110–150、$300 级账单降至约 $150–190 的情景仍作为预测保留，不能用这几分钟代替整月业务量和最终账单。最终应按同等调用量、项目分布和实际快照 GB-days 对账。

## 证据与回滚

原始计量及回执在 gitignored 的 `artifacts/sandbox-cost/large-project/`：`agent-production-round-*-result.json`、`agent-production-verification.json`、`agent-production-message-verification.json`、`production-qa-metrics.json`、`production-resource-cost.json`，以及原始日志和实际图片。发布日志、环境回读、CLI parity 和首页更新截图在 `artifacts/sandbox-cost/`。没有把凭据或完整环境文件提交。

回滚目标为此前生产部署 `dpl_7jE9MQF2KXwGKnYnFPSnC8czH9Yu`（`a33fec24`）；旧部署和基础运行时快照保留。本次五个生产变量在旧环境原本不存在，完整回退时应同时恢复配置；关闭共享缓存／批量渲染并将规格改回 8 核可回到较高成本行为。生产未发生需要回滚的故障。
