# H3 Max：发起请求到拿到视频 URL 的速度（2026-09-05）

已完成 18 个成功样本；共 20 次提交（原计划 18 个有效样本）。

## 测量方式

- 运行位置：Mac；独立 worktree `codex/h3max-reference`。没有改动或部署生产。
- 所有输出为 768p，时长为 5 / 10 / 15 秒；每个组合两轮，自己最多一个生成任务在途。第二轮倒转时长与路由顺序。
- 主指标：调用本地适配器开始，直到供应商结果 JSON 中读到有效视频 URL。包括本机图片预检、提交传输、排队、提示词扩写、推理和轮询；不包含输入素材预上传、输出下载或后续 URL 可访问性检查。
- 轮询间隔 500ms，此外仍有 HTTP 往返与 JSON 读取时间；URL 就绪时刻的观测可能晚于真实完成时刻。
- I2V 与单图 R2V 使用同一张 1024×576 人物图片和同一个英文动作提示词，均用 balanced 扩写。随机种子由供应商选择。
- 视频编辑组输入为同长的 5 / 10 / 15 秒参考片，要求把红书变蓝。源片来自前一轮 5.184 秒递书视频；本地循环并精确截成各长度，随后上传供应商。该组用于看输入长度带来的耗时，不作为长镜头连续性质量测试。
- 这是本机直连接口的测量，不等于生产 App 的点击到展示延迟；未计入 Makaron 认证、计费、持久化、App 轮询与 UI 更新。
- 每组仅 2 次，均值/范围用于本次观察，不能当作稳定 SLA、P50/P95 或明确的冷/热启动成绩。

## URL 耗时（秒）

| 输出时长 | 原 I2V：均值（范围） | 单图 R2V：均值（范围） | 视频编辑 R2V：均值（范围） |
|---|---|---|---|
| 5s | 8.1 (6.5–9.7) | 9.0 (8.9–9.1) | 23.3 (23.2–23.5) |
| 10s | 11.6 (10.2–13.1) | 24.6 (14.9–34.3) | 50.0 (49.9–50.1) |
| 15s | 14.6 (13.8–15.4) | 24.9 (24.9–25.0) | 93.4 (92.0–94.8) |

## 每次测量与公网成片 URL

| 路径 | 时长 | 轮次 | 提交返回 | 视频 URL | 供应商推理 | 链接检查 | 成片 |
|---|---|---|---|---|---|---|---|
| 原 H3 Max Turbo 单图 I2V | 5s | 1 | 5.36s | 9.75s | 1.72s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f08/meIf_NpVWzCXDfs_gveNF_minimax-h3.mp4) |
| 原 H3 Max Turbo 单图 I2V | 5s | 2 | 2.56s | 6.53s | 1.53s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f2c/u3dQ15q_66nxRk9y-cUdx_minimax-h3.mp4) |
| 新 H3 Max 单图 R2V | 5s | 1 | 2.06s | 9.05s | 3.51s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f09/_ekdsFqvKsetJncfe6ZjP_minimax-h3.mp4) |
| 新 H3 Max 单图 R2V | 5s | 2 | 3.10s | 8.94s | 3.61s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f2b/gv3JTLtMZU_Qc9vLnQufL_minimax-h3.mp4) |
| 新 H3 Max 视频编辑 R2V | 5s | 1 | 0.26s | 23.51s | 9.81s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f0b/JiWkZtQ1b9QdBpY38QLqQ_minimax-h3.mp4) |
| 新 H3 Max 视频编辑 R2V | 5s | 2 | 0.27s | 23.16s | 9.74s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f29/F4fV9GtBkL-kF_mRv6cDq_minimax-h3.mp4) |
| 原 H3 Max Turbo 单图 I2V | 10s | 1 | 1.68s | 10.18s | 4.25s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f0c/WhE727fpqiK0haw19NRPq_minimax-h3.mp4) |
| 原 H3 Max Turbo 单图 I2V | 10s | 2 | 4.71s | 13.06s | 4.29s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f28/uKlmVQ6ka2ZCkc2s06z6c_minimax-h3.mp4) |
| 新 H3 Max 单图 R2V | 10s | 1 | 1.02s | 14.86s | 10.21s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f25/lfKaksyA-ljTJoPZ8f6WQ_minimax-h3.mp4) |
| 新 H3 Max 单图 R2V | 10s | 2 | 19.41s | 34.28s | 10.04s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f26/eTO69EIX777voO9wMUQib_minimax-h3.mp4) |
| 新 H3 Max 视频编辑 R2V | 10s | 1 | 0.26s | 49.94s | 33.71s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f27/3U1fi9VyBdM8bE6JaDTaF_minimax-h3.mp4) |
| 新 H3 Max 视频编辑 R2V | 10s | 2 | 0.26s | 50.12s | 33.54s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f1f/O2GxIBFdD64V-s5apdQp5_minimax-h3.mp4) |
| 原 H3 Max Turbo 单图 I2V | 15s | 1 | 1.25s | 13.77s | 8.19s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f14/LnfUZimnE5CB1SpvqCALj_minimax-h3.mp4) |
| 原 H3 Max Turbo 单图 I2V | 15s | 2 | 2.44s | 15.43s | 9.76s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f1d/7W1M287RkCOhKUK_Y5zgt_minimax-h3.mp4) |
| 新 H3 Max 单图 R2V | 15s | 1 | 0.80s | 24.87s | 19.26s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f16/-aOeqCY0GhbVF2ZfU92Kz_minimax-h3.mp4) |
| 新 H3 Max 单图 R2V | 15s | 2 | 0.71s | 25.00s | 19.23s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f1a/LhgMxWeNyDXc6mjQC00u6_minimax-h3.mp4) |
| r2v-video | 15s | 1 | — | not-completed | — | — | — |
| 新 H3 Max 视频编辑 R2V | 15s | 1 | 0.80s | 94.79s | 72.84s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f32/4cxuiEmmUnUjBxwuYX24W_minimax-h3.mp4) |
| 新 H3 Max 视频编辑 R2V | 15s | 2 | 0.25s | 92.01s | 72.56s | 206 video/mp4 | [视频](https://v3b.fal.media/files/b/0aa92f3b/hqu_C0BaGtRNGBz152rlQ_minimax-h3.mp4) |
| r2v-video | 15s | 2 | — | not-completed | — | — | — |

## 15 秒视频输入修正

最初的 15 秒循环片源标称 24fps，但实际仅 358 帧，平均 23.8667fps，低于供应商 23.899fps 的门槛；两次都在结果端点返回 422 video_frame_rate_error，没有视频 URL。这是本地循环/裁切片源的帧率问题，不能计作生成延迟或成功。
补测把源片转为恒定 30fps，15 秒准确 450 帧，保留原始两次失败记录并以 -cfr30 后缀记录新请求。主表只统计成功拿 URL 的结果；15 秒编辑组使用修正后的 30fps 输入，5/10 秒编辑组仍使用原片源，输入帧率不完全一致。

## 可复现证据

- 脚本：`scripts/h3max-speed-benchmark.ts`。运行前需要本地人物图和精确时长的参考视频；详细素材与状态在 `artifacts/h3max-speed/`（git ignored）。
- 每个任务在付费提交前写意图文件；存在结果或不确定状态文件时跳过，不会自动重复生成。
- JSON 保存路由、源片 URL/时长、请求时长、真实 task ID、提示词、供应商种子、队列状态观察、URL 时点、推理时间和 URL 检查；不保存 API key。
- 每条公网 URL 在计时结束后使用 Range 请求验证 HTTP 状态和媒体类型；ffprobe 另行检查真实视频时长/分辨率，检查耗时不进入 URL 指标。
- 官方接口：[Turbo I2V](https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api) / [Max R2V](https://fal.ai/models/minimax/h3-max/reference-to-video/api)。

## 本次结论

- 单图 I2V 拿 URL：5 秒输出 6.53–9.75 秒；10 秒输出 10.18–13.06 秒；15 秒输出 13.77–15.43 秒。
- 单图 R2V：5 秒输出 8.94–9.05 秒；10 秒输出 14.86–34.28 秒；15 秒输出 24.87–25.00 秒。
- 同长度视频编辑 R2V：5 秒输出 23.16–23.51 秒；10 秒输出 49.94–50.12 秒；15 秒输出（源片修正为恒定 30fps）92.01–94.79 秒。
- 10 秒单图 R2V 的慢样本，提交返回花了 19.41 秒（另一次 1.02 秒），供应商推理两次都是约 10 秒。延迟主要发生在提交阶段；现有记录不能进一步区分本机传输、供应商入口或扩写等因素。没有删除这个较慢样本。
- 所有 18 条成功结果的公网 URL 均验证为 HTTP 206 + video/mp4；ffprobe 全部通过。5 / 10 / 15 秒请求的真实 MP4 时长分别为 5.184 / 10.144 / 15.104 秒。媒体检查发生在各自拿 URL 计时结束之后；部分 ffprobe 核验在后续生成期间运行，共享本机网络，因此本次不是完全隔离的网络性能基准。
- 最初 15 秒源片帧率不合规的两次请求返回 422，没有生成 URL，不进入成功延迟统计。修正输入后的两条 15 秒结果单独记录，完整尝试数为 20，成功数为 18。
- 本次只新增实验脚本与报告，未修改产品运行逻辑。脚本 ESLint 与 diff 检查通过；真实调用、URL 检查和 ffprobe 为端到端证据。
