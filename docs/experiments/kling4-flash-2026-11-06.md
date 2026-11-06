# Kling 4.0 Flash 接入（EvoLink）

日期：2026-11-06。分支 `claude/worktree-kling-4-flash-2fbb35`，基线 `dev` 的 `a7fdc555`。代码仅本地候选：未推送、合并、部署、发 npm。共享数据库迁移已于 2026-11-06 应用（见下）。

## 供应商合同

2026-10-22 时 Flash 没有可调用 API，代码里只保留了拒绝占位。现在 EvoLink 已上架四条独立路由，字段与 Kling 4.0 相同：

| 项 | Kling 4.0 Flash | Kling 4.0 |
| --- | --- | --- |
| 模型 ID | `kling-v4-flash-{text-to-video,image-to-video,reference-to-video,video-edit}` | `kling-v4-*` |
| 输出 | 仅 720p，整数 3–20s | 720p/1080p，3–30s |
| 参考 | 10 图 + 5 段视频，视频每段 ≥3s、合计 ≤20s | 合计 ≤30s |
| 编辑源片 | 1 段，3–20s，`duration` 默认 `auto` | 3–30s |
| 计费 | 文生/仅图参考 $0.094/s；带参考视频或编辑 $0.063/s ×（输出 + max(视频秒数四舍五入, 输出)） | $0.157 / $0.094，编辑源片向上取整 |

依据：[Flash 模型页与价目](https://evolink.ai/kling-4-0-flash)、[reference-to-video 合同](https://evolink.ai/docs/en/api-manual/video-series/kling/kling-v4-flash-reference-to-video)、[video-edit 合同](https://evolink.ai/docs/en/api-manual/video-series/kling/kling-v4-flash-video-edit)、匿名价目接口 `GET https://api.evolink.ai/web/api/models/pricing`。

## 实现

- `kling-4-flash` 与 `kling-4` 共用一条 Kling 4 家族路径（`isKling4FamilyModel`、`src/lib/kling4.ts` 显式传 variant）。两者之间不互相 fallback；单次 POST，未知提交结果不重发。
- 与 Kling 4.0 一样不暴露 image-to-video 首帧路由，图片按 feature reference 处理。
- 计费：`media_pricing` 新增 `video:kling-4-flash:720p:{generate,edit}`；`calculateMediaQuote` 对 Flash 视频秒数四舍五入。Retake 支持 Flash（显式选择，默认仍是 Kling 4.0），迁移同时放开 `video_retake_jobs.model_id`。
- 已同步：模型选择器（四语）、Agent/MCP 工具描述、prompts、内置 Skill、CLI help/校验/README/SKILL。

## 验收

- 真实供应商冒烟：经 `createKling4Task` 提交 3s 文生视频，task `task-unified-1793975060-v44zdqi6`，约 64s 完成（供应商 `duration` 62s）。下载为 1280×720、24fps、3.04s H.264 + AAC，画面符合提示词。供应商回执 `usage.cost.usd = 0.282`，与 3 × $0.094 估价一致。
- 未真实调用：reference-to-video、video-edit、Retake。CLI → Agent → 计费 → 快照持久化已在下文端到端验证。单测覆盖其 payload、路由、报价与拒绝路径。
- TypeScript、定点 ESLint、i18n UI 检查、video reference workflow 检查通过；全量 vitest 385 文件 / 2777 测试通过。

## 共享数据库迁移（已应用）

2026-11-06 22:39 CST 经用户授权，用 Management API 在单个事务里应用 `20261106221835_kling4_flash_pricing_and_retake.sql`，并登记 `supabase_migrations.schema_migrations`。应用前核对线上 Retake 约束和 `kling-4` 价格行与迁移前提一致；应用后 `video:kling-4-flash:720p:{generate,edit}`（0.094 / 0.063，markup 2）在线，约束包含 `kling-4-flash`。

## CLI chat 端到端（本地 3110 服务，本分支代码 + 共享数据库）

`MAKARON_URL=http://localhost:3110 makaron chat --project auto --image public/brand/makaron-spark-pixel-wizard-concepts.png "...用 kling-4-flash 做 20 秒单镜头..."`

- 第一轮 Agent（gpt-6-luna）按脚本优先流程只出脚本、等确认（2 credits）；第二轮回复“确认”后一次提交。项目 `cd29e045-e5bb-414a-b4ea-919d19b7c50a`，run `25cf12d2-9c49-4751-b36d-7ba9caf4e83f`，task `task-unified-1793976386-nimpngm7`，snapshot `d6a579ad-e9f1-407f-86c7-d7154bcc3dfa`。
- 计费：`create_video · kling-4-flash` 376 credits = 20 × $0.094 × 2 × 100，与价格行一致；无退款。
- 成片：1280×720、24fps、20.04s，H.264 + AAC，音轨全程有声（平均 -17.6 dB，无 >0.8s 静音）。快照 `video_meta.status=completed`，视频与 poster 均已持久化到 `cdn.makaron.app`。
- 内容：角色还原度高，五个信息节拍按顺序出现。缺陷：约 11s 出现屏幕文字“文字可参考 更省”（“更省”错位，且脚本要求不生成额外文字）；约 19s Pixel Wizard 被复制成两只，原本应与 Spark 击掌。中文台词未做转写核对。

## Flash Retake（同一项目）

目标：把 17.6–20.04s 结尾的第二只 Pixel Wizard 改成 Spark，和原来那只击掌。

- 第一次（run `ce5736a9-…`）在提交前失败，报 `Image unavailable or too large`，没有建任务、没有扣视频费。根因不在参考图：`cdn.makaron.app` 的 R2 缓存层（`x-makaron-cache: HIT-R2`）对不带 Range 的 GET 也回 206 + 完整 content-range，而 `readProviderImage` 只接受 200，于是把源视频判成不可读。Agent 把它误报成了参考图问题。Worker 原因：`services/media-r2-cache/src/worker.mjs` 的 `serveR2()` 用 `object.range` 判断 206，但 R2 `get()` 不带 range 时也会返回 `range`。
- 本分支修复 `ba5cf7ae`：只接受覆盖完整对象（`bytes 0-(N-1)/N`）的 206，真正的部分内容仍拒绝；有单测。Worker 未改，线上影响另开会话调研。
- 第二次（run `90733406-f256-4fba-80f5-1f7264589983`，job `fe05388a-a8cd-4c89-accc-b8bc99f7be02`）成功：context 17.04–20.04s，生成 3s，Flash edit。计费 `video:kling-4-flash:720p:edit` (3+3)×$0.063 = $0.378 → 76 credits，reservation completed。
- 验收：成片与原片同为 481 帧、20.041667s、1280×720/24fps；AAC 数据包 SHA-256 与原片一致；区间外 2/10/16/17.3s 抽帧（160×90 灰度）平均差 0.17–0.25/255。结尾不再有第二只 wizard，Spark 星芒约 18s 从左侧进场，19.3s 与 Pixel Wizard 击掌并迸出粒子。Spark 是无脸的星芒形态，不是设定图第 7 格那种带表情的 companion sprite。

## 发布前必须完成

1. `check:skill-sync` 的路由证据已因 Skill 正文变化过期，需用私密环境跑 `npm run test:skill-routing -- --live --env <私密环境文件>`。
2. 按 `docs/makaron-release-checklist.md` 同步 CLI 版本、发包并做 registry 全新安装验收。
3. Preview 上用真实账号走一次 App 选择 Flash → 出片 → 重新打开项目。
