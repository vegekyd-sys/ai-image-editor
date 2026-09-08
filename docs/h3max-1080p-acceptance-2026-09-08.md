# fal H3 Max 1080P 接入验收

2026-09-08。分支 `codex/h3max-1080p`，运行时代码 `6e5a94a6`。已完成本地产品接口和真实供应商验收；尚未合入 dev、推送或部署生产。

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

新增价格行已通过幂等 INSERT-equivalent 写入共享 catalog 以完成真实产品验收；没有覆盖既有价格。迁移 `20260908082500_h3_max_1080p_pricing.sql` 使用 `ON CONFLICT DO NOTHING`，部署时可安全执行，尚未登记迁移历史。旧生产应用仍拒绝此分辨率，因此增加价格不会开放尚未发布的功能。

## 检查

- 全量 Vitest：1715 passed，1 skipped。
- H3 Max/Turbo adapter + 集成：42 passed。
- ESLint 无错误（2 个既有 warning）；i18n、Agent startup、视频参考合同检查通过。
- CLI smoke 和公开 Agent docs lint 通过。
- 独立 runner 的 Next production webpack 构建通过；日志在 `artifacts/h3max-1080p/build.log`。

本地证据在开发 worktree 的 `artifacts/h3max-1080p/`，包括原始请求、持久化幂等 receipt、catalog 前后值和完成账单；不纳入公开提交。
