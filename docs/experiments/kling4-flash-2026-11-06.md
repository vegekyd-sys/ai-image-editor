# Kling 4.0 Flash 接入（EvoLink）

日期：2026-11-06。分支 `claude/worktree-kling-4-flash-2fbb35`，基线 `dev` 的 `a7fdc555`。仅本地候选：未推送、合并、部署、发 npm，迁移未应用到共享数据库。

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
- 未真实调用：reference-to-video、video-edit、Retake 整条链路，以及 App/CLI → Agent → 计费 → 快照持久化。单测覆盖其 payload、路由、报价与拒绝路径。
- TypeScript、定点 ESLint、i18n UI 检查、video reference workflow 检查通过；全量 vitest 385 文件 / 2777 测试通过。

## 发布前必须完成

1. 在授权发布中应用 `supabase/migrations/20261106221835_kling4_flash_pricing_and_retake.sql`。未应用前，App 内选择 Flash 会在报价阶段因缺价失败（无供应商调用、无扣费）。
2. `check:skill-sync` 的路由证据已因 Skill 正文变化过期，需用私密环境跑 `npm run test:skill-routing -- --live --env <私密环境文件>`。
3. 按 `docs/makaron-release-checklist.md` 同步 CLI 版本、发包并做 registry 全新安装验收。
4. Preview 上用真实账号走一次 App 选择 Flash → 出片 → 重新打开项目。
