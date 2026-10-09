# Seedance 2.5 Eco 与 ByteDance Fast 视频超分

2026-10-04。状态：独立分支实现、供应商 1080p / 2K / 4K 样片验证；未部署生产，数据库迁移未应用。分支 `codex/seedance25-480p-upscale`。

## 产品决定与用法

用户已选定名称 **Seedance 2.5 Eco** 和默认增强方案 **ByteDance Fast**。Eco 是 Makaron 组合路线名：EvoLink Seedance 2.5 生成 480p → fal 托管的 ByteDance Fast 超分；不能称为供应商官方新型号或原生高清。

| 入口 | 行为 |
|---|---|
| 模型选择 Seedance 2.5 Eco | 一次提交，默认交付 1080p，可选 720p / 2K / 4K；生成与增强共享一个任务与时间线结果 |
| Agent `upscale_video` | 对已有一段视频超分，无新 prompt 生成；支持 Media Index 或外部视频 URL，默认 1080p，可选 2K / 4K |
| MCP `makaron_upscale_video` | URL + resolution，支持可重用 billingRequestId；轮询现有状态工具 |
| CLI | `makaron chat` 驱动已有视频超分；`video create --video-model seedance-2.5-eco --video-resolution 4k` 创建 Eco 视频 |

既有原生 `seedance-2.5` 路由保留。GUI 与状态文案同步 zh / zh-Hant / ja / en。独立增强即使生成模型选择器被锁定，也使用 ByteDance Fast；不误带时间线图片、音频或其它视频。现有视频超分无需脚本审核；Eco 新生成遵循原有生成授权合同。

fal API 的目标枚举还包括 6K / 8K，但公开价仅列到 4K。本版上限为已定价、已实测的 4K；后续确认更高档价格与输出后扩展能力表、报价和交付校验，不推测价格或借 scale_ratio 绕过上限。

## 持久化与交付

实现入口：`src/lib/bytedance-video-upscale.ts`、`video-upscale-media.ts`、`video-upscale-pipeline.ts`。根任务为 `video-pipeline-UUID`，service-only 表 `video_upscale_jobs` 保存所有者、项目、目标、阶段、生成/增强回执、基础/最终 URL、媒体信息、超分预留积分和退款结果。

```mermaid
flowchart LR
  A[Eco 一次创建] --> B[EvoLink 480p]
  C[已有视频超分] --> D[保存与探测原片]
  B --> D
  D --> E[ByteDance Fast]
  E --> F[复制原音轨并验证媒体]
  F --> G[永久保存高清文件]
  E -->|Eco 增强确认失败| H[保留 480p 只退增强费用]
```

App snapshot、旧 animate、Agent Run、MCP 状态查询与 Cron 使用同一 `advanceVideoPipeline`。生成完成不表示 Eco 根任务完成；只在最终文件进入永久存储后交付完成。生成与增强不在创建请求内等待。轮询推进下载、探测、原音轨复用与存储；阶段保存后可续跑，当前使用 API 服务端媒体运行时，并有 FFmpeg 打包检查。

数据库租约与 updated_at CAS 防止旧状态轮询再次提交；调用供应商前保存 submitting_upscale 意图，付费 POST 不自动重试。请求不确定或回执无法保存时保留根任务，凭日志中的根 ID / 子任务 ID 人工核对；不把缺失回执解释为可以再生成。网络查询、下载、存储失败继续恢复同一任务。Cron 独立恢复根任务，不将生成+超分机械套入旧的单供应商 30 分钟退款规则。

原片和高清片写入不同 Storage key。保留原帧率、画幅、时长和原音轨；不默认插帧、不重新压缩视频音频。校验短边达到 1080 / 1440 / 2160，时长差 ≤0.25s，fps 差 ≤0.02，画幅比例差 ≤0.02；ffprobe 能读取帧数时要求相同。无 ffprobe 时使用 FFmpeg 头部解析。供应商可能按源画幅舍入，实际 4K 样片为 3844×2160，不虚报精确 3840×2160。

独立超分初始限制为 60 秒、512MB、1–60fps；当前输出 MP4。更长片需先分段。删除时间线占位沿用原有 abandoned 行为，不等同供应商取消；当前未新增供应商取消 API 或退款承诺。

## 计费与失败

Eco 报价从数据库读取原生 480p 和对应超分费率，分别舍入积分再相加；不重复 markup。管理员修改费率立即影响新报价，旧任务使用预留费用。独立增强先下载并测量真实时长与 fps，再预检余额并提交。30fps 档按公开费率，超过 30fps 使用公开 60fps 的双倍档，不假设 24fps 折扣。

Eco 默认交付于 2026-10-05 按最终产品决定设为 1080p，显式选择 720p / 2K / 4K 仍优先。720p 实际使用供应商 1080p 超分后再以 Lanczos 缩小，因此两档供应商费率均为 $0.0072/s（≤30fps），720p 不具有超分推理成本或速度优势；缩小过程还需要额外编码。此默认值变更不改独立超分工具的 1080p 默认值，也不改变已有任务和价格。

| 结果 | 行为 |
|---|---|
| 生成确认失败 | 使用现有整单失败结算 |
| Eco 增强确认失败 | 原片永久保留；completed + enhancementStatus=failed + actualResolution=480p；仅退超分预留积分 |
| 独立增强确认失败 | 使用现有整单失败结算 |
| 查询或交付失败 | 保存原任务、继续恢复，不再次付费推理或提前退款 |

生成确认失败时，根任务保留供应商的错误码和说明（例如 `content_policy_violation`），经既有状态查询传给 Agent 和任务卡；供应商没有给出细节时才使用通用生成失败说明。生成失败不启动超分，也不自动重新提交付费任务。审核拦截不等于分辨率不支持；供应商未说明具体触发内容时，不推断是哪项素材或措辞导致。

部分退款 RPC 锁定所有者对应根记录，减去已经退款的金额，支持 App / MCP / Cron 并发重复结算。MCP 根任务继续由原有 reservation 结算，增强失败的 Eco 返回可用原片，不触发整单退款。当前按报价预留收费；未新增按供应商实际账单或容器舍入时长的自动补扣。供应商费用下述均为公开估算。

## 验证与发布边界

同一条原始 480p 吉祥物视频跑通 ByteDance Fast 1080p / 2K / 4K。新增 2K / 4K 两次无重试，没有新增 Seedance；生产媒体交付 helper 实际处理输出，24fps / 241 帧 / 10.08s，AAC payload 与源片相同，全片解码通过。新增 2K / 4K 估价共 $0.435456。竖屏、方形、无声的交付 helper 使用本地合成片验证；不等于这些场景的供应商画质验收。详情见实验文档。

回归覆盖 Agent 锁定模型后的独立增强、唯一 ready source、单时间线产物、拥有者隔离、重复/过时轮询、未知 POST、部分退款、查询失败、存储续跑和费率组合。迁移用本地 PGlite/PostgreSQL 执行，检查语法、服务权限、所有者、租约和退款幂等；退款底层账本为测试 stub，不声称生产账本验收。

发布前需按 release 流程处理两个迁移及对应应用版本：先部署兼容 Seedance 480p 新计价代码，再应用既有 `20261003194718_seedance25_480p_pricing.sql` 中需要的列/报价变更；新增 `20261004110000_video_upscale_pipeline.sql` 提供表、RPC 与超分价格。实际生产应用和迁移次序应按 release 检查确认，不能将共享 Preview 当隔离数据库。当前没有应用生产迁移、合入或部署，也没有声称真实 App Agent 端到端已验收。

## 与 Wan 3 的关系与来源

Wan 3 的 2K / 4K 是 MuleRouter/CarrotHub 的单供应商 Pro 任务；Eco 有两个供应商，由 Makaron 持久化根任务统一推进。复用分辨率选择、报价、任务卡、状态与时间线体验，不能把 Seedance 原片作为 Wan 参考图重生成来冒充纯超分。

FlashVSR 原项目为 OpenImagingLab，前次 API 托管供应商为 fal；当前选择 ByteDance Fast，Proteus 保留实验对比。单样本中经济路线主要节省成本，不能据此宣称端到端生成速度比原生 1080p 更快。

来源：[fal ByteDance 参数](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api)、[fal ByteDance 公开价格](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video)、[同源超分实测](../experiments/seedance25-upscale-options-2026-10-04.md)。

本次验证结果：全量 Vitest 316 文件 / 1,994 用例通过（1 项既有 live test 跳过）；TypeScript、i18n、Agent startup、video-reference workflow 与 discovery 同步检查通过；ESLint 无错误（3 项既有警告）。共享 node_modules 的 worktree 下 Turbopack 拒绝越界 symlink，使用已有 webpack 路径完成生产构建；10 个 CRC32C 路由与 9 个媒体路由的 FFmpeg trace 检查通过。本地播放器与两条高清视频 HTTP 200、JS 语法正确；此前浏览器 URL 安全策略拒绝访问，未绕过或声称新页面真实浏览器播放已验收。
