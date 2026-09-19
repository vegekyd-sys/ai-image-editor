# fal H3 Max 1080P 接入验收

2026-09-08。已合入 dev、同步 GitHub 并上线，生产运行时代码 `03f6c969`；正式域名的 Makaron chat CLI 验收通过。下方保留第一阶段本地接入记录（`6e5a94a6`），末节为上线验收。

## 能力

- `fal-h3-max` 增加 `1080p`，默认仍为 `768p`；5–15 秒整数时长。
- 参考图片、视频、音频的原有限额和路由保持；无参考时使用 H3 Max T2V。
- UI 从统一能力表提供分辨率；Agent 工具参数、MCP discovery、CLI 帮助和公开 Skill 三份镜像同步。四语言模型说明已补齐。
- `minimax-h3-max` 仍是 Turbo，保持 480p/768p。
- fal 明确描述 1080P 为从原生 768P 做 latent refinement，不能宣传为原生 1080P 生成。
- 冻结的旧版 Core Prompt 回滚保持原文；当前视频指南新增 1080P 的修改由显式合同 amendment 验证。

官方来源：
- [R2V API schema](https://fal.ai/models/minimax/h3-max/reference-to-video/api)
- [T2V API schema](https://fal.ai/models/minimax/h3-max/text-to-video/api)
- [当前模型价格](https://fal.ai/models/minimax/h3-max/reference-to-video)

## 实测

相同已上传的 5.184 秒书店参考视频，要求保持男子、服装、场景与构图，将红书改成蓝书。顺序执行，无并发。以下每个时长只有一次样本，不是平均性能承诺。

| 路径 | 请求时长 | 返回 URL 耗时 | 实际媒体 | fal 账单 | Makaron 扣费 |
|---|---:|---:|---|---:|---:|
| 本地真实 adapter → fal | 5s | 31.441s | 1920×1080、24fps、5.184s、H.264 + AAC | $0.80 | 无客户扣费 |
| 本地 Makaron `/api/mcp` → 认证/预检/计费 → fal → 状态结算 | 10s | 54.701s | 1920×1080、24fps、10.144s、H.264 + AAC | $1.60 | 320 credits，completed |

耗时包含提交、供应商排队/生成及 3 秒轮询；第二项包含本地 Next 首次编译、认证和计费。均不包含上传原片、下载输出和 Agent 写剧本，不能当作正式线上端到端测速。

两个输出完整 FFmpeg 解码无错误；抽帧确认同一男子、书店及蓝书。10 秒输出在 Chrome 原生播放器完整播放到 10.144 秒，`ended=true`、无媒体错误。

- [5 秒样片](https://v3b.fal.media/files/b/0aa99392/9JpmzBs6MNdyUck2JHXom_minimax-h3.mp4)
- [10 秒产品接口样片](https://v3b.fal.media/files/b/0aa993df/C40uEGO2Viao1IgN7FJDm_minimax-h3.mp4)

## 计费

新增唯一条目 `video:fal-h3-max:1080p:generate`：输出 $0.16/s，沿用 2× 定价，即 32 credits/s。图片/音频参考 token 条款沿用 fal 公布价格。

fal 的逐请求 Billing events 显示上述两次视频参考请求分别仅收 $0.80 / $1.60，视频参考本身未加价；1080P 价格项据此将视频参考 token 系数设为 0。该实测与旧文档中仅列 480P/768P 的视频参考 token 表不同，不将旧档公式外推到新档位。若 fal 调整实际扣费，可通过现有 Admin pricing 修改下一次报价；现有 480p/768p 价格不变。

账单请求：
- 5s：`01a08014-5cc7-73e3-a4b1-21c513a310cc`
- 10s：`01a0801c-8dd5-73e0-add4-ab0b6733a983`
- Makaron 幂等账单：`c5062193-fe6c-4800-8368-c474d76dfcb4`

新增价格行已通过幂等 INSERT-equivalent 写入共享 catalog 以完成真实产品验收；没有覆盖既有价格。迁移 `20260908082500_h3_max_1080p_pricing.sql` 使用 `ON CONFLICT DO NOTHING`，部署时可安全执行，本地阶段未登记迁移历史；上线时已通过管理 API 在事务中执行幂等迁移并登记版本。价格预置期间，旧生产应用仍拒绝此分辨率，没有提前开放功能。

## 检查

- 全量 Vitest：1715 passed，1 skipped。
- H3 Max/Turbo adapter + 集成：42 passed。
- ESLint 无错误（2 个既有 warning）；i18n、Agent startup、视频参考合同检查通过。
- CLI smoke 和公开 Agent docs lint 通过。
- 独立 runner 的 Next production webpack 构建通过；日志在 `artifacts/h3max-1080p/build.log`。

本地证据在开发 worktree 的 `artifacts/h3max-1080p/`，包括原始请求、持久化幂等 receipt、catalog 前后值和完成账单；不纳入公开提交。


## 正式上线与 chat CLI 验收（2026-09-08）

- dev 已同步到 GitHub；生产代码 `03f6c9694291db1870d80108a14d6d5d3c3bc5b4`。
- 正式部署 `dpl_BRAnaX9svkwCFxRJ98BRs9rsFKZf`，部署 URL `ai-image-editor-61md07d03-vegekyd-sys-projects.vercel.app`。`www.makaron.app` 与 `makaron.app` 均已核对指向此部署。
- 从 canonical dev 执行 `npm run release:prod`；TypeScript、1715 项测试（1 skipped）、CLI smoke、本地生产构建、Vercel 远程构建通过；上线后 `/api/health` 13 项 healthy。
- AI_PROVIDER、图片/Agent provider、FAL_KEY、Supabase 环境与已验收环境一致，没有修改共享环境变量。
- 1080P 价格迁移 `20260908082500` 已登记；原价格项不变。
- CLI 0.14.8 已发布，npm `latest` 为 0.14.8，fresh npx 可运行。

实际生成通过 CLI 0.14.8 的 `chat --project auto --video <source> --json -b <prompt>` 提交到 `https://www.makaron.app`，随后 `responses get <runId> --wait --json` 等待产物。npm 发布处理期间使用仓库内同版本 CLI 程序执行生成；发布完成后，另用 `npx -y makaron-cli@0.14.8 responses get <runId> --wait --json` 再次确认成片。

用户提示只要求“5 秒、1080P、16:9，参考书店视频，仅把红书改成蓝书”，没有指定模型。服务端 `executionRequest` 没有 videoModel/videoResolution 锁定字段。实际自动选择：

- 模型：`fal-h3-max`
- Endpoint：`minimax/h3-max/reference-to-video`
- 分辨率：`1080p`
- Task：`fal-h3max-reference-01a0802d-2772-7b90-97c0-c3498ebe2fea`
- Agent run：`e62f96f7-162e-44bd-a2cc-ae67ed7fec87`，completed、attempt 1、owner 正式域名。
- CLI 从提交到收到完整视频结果：105.739 秒；返回的 video elapsed_seconds 为 28 秒。只有一次线上样本。
- 成片：1920×1080、24fps、H.264 + AAC、实际时长 5.184 秒。完整 FFmpeg 解码无错误。
- 已持久化到项目 CDN，封面也已保存；刷新真实项目后完整播放到 5.184 秒、ended=true、无媒体错误。画面保持男子、绿外套、书店与拿书动作，蓝色封面在首尾一致。
- usage_logs：create_video / fal-h3-max 扣 160 credits；analyze_video 扣 1 credit；个人 Codex 订阅 Agent 记录为 0。合计 161 credits。

[线上验收项目](https://www.makaron.app/projects/706c9cb3-4666-419c-b8e4-67a6156900e9)

[已保存的 1080P 成片](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/706c9cb3-4666-419c-b8e4-67a6156900e9/videos/f72ee11f-482d-4fa2-bf49-c07e4b24b6f5.mp4)

正式验收本地证据位于 canonical dev 的 `artifacts/h3max-1080p-release/`：部署/alias/health、迁移回执、CLI 原始请求与响应、npm CLI 响应、最终 snapshot/执行记录、usage_logs、ffprobe 与可播放 MP4。均为忽略文件。

回滚候选为上线前部署 `dpl_5nuMdEg3GSKDEXCGK7v7KwH9fYaX`（`ai-image-editor-leknimtnt-vegekyd-sys-projects.vercel.app`）；若需回退，只回退应用即可，新增价格行不影响旧版本。
