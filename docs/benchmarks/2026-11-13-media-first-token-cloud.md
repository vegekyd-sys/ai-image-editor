# 首字云端对照：Production vs 独立 Preview（2026-11-13）

Preview：[https://ai-image-editor-dt35bmxhv-vegekyd-sys-projects.vercel.app](https://ai-image-editor-dt35bmxhv-vegekyd-sys-projects.vercel.app)。已 Ready 并验证首页、认证 API 和健康端点；未绑定共享 alias。此处为上线前的独立 Preview 对照。后续已获用户授权合入并上线，见[发布验收](2026-11-13-media-first-token-release.md)。

## 结论

- 图片首字 P50 11.76→5.49 秒，成功首流 6/6 对 6/6；中位数改善约 53.3%。但 Preview 首条图片为 19.51 秒，比线上最慢的 14.94 秒还慢，不能声称每次都更快。
- 纯视频首字 P50 9.48→10.02 秒，约慢 0.54 秒；这轮没有首字收益。完整首流结束中位数为 16.32→11.64 秒，工具重复分析减少，但不能用它替代首字验收。
- 图片+视频成功首流的 P50 为 20.78→12.42 秒；线上原始首流 5/6 有正文，Preview 为 6/6。线上缺失样本的同一 run 后台最终完成，不用完成时间补首字，也不把成功子集的改善冒充完整组通过。

这组实测以真实 Production 与 Preview 为准，与此前本机数据分开。首字候选对图片有明确的小样本收益；纯视频仍需要进一步优化，不能把整组结果表述为所有媒体场景首字均有改善。后续发布只在 changelog 描述图片与图片+视频的收益。

## 版本、环境与方法

- 测试窗口：2026-11-13 20:35:19–20:46:01（Asia/Shanghai）。
- 生产在本轮开始时已更新到 `a9079073`（Flash Retake）。为避免掺入功能差异，先把首字补丁重放到这个基线。原本机版本由本地 tag `codex/media-first-token-local-20261113` 保留。
- Preview 运行代码：`d05b66970815bb766c6a429e84ff54f7816f9af1`；两端 Vercel region 均为 `hnd1`。部署后查实的源码 SHA 与计划一致，Preview aliases 为空。
- 开始、每轮及结束均核对生产 deployment，六轮期间保持同一个生产版本。两端 Agent/Google/数据库相关配置与凭据一致，未修改任何共享环境变量。
- Auto 默认实际为 `deepseek-flash`；全部 36 个 run 均为 DeepSeek、单 attempt，无 provider retry 或 failover，thinking high 未改。视频分析仍是既有 Gemini 3.8/static/low。
- 图片、视频、混合三场景，各六组，依次交错 Production/Preview 与 Preview/Production。使用相同测试账号、同一份固定图片和约 9.8MB/15.046秒视频，每次新项目与通用上传描述。
- 实际走认证的公网 `POST /api/agent`，同一计时客户端；时钟从请求发出到第一个非空 `content`。上传和测试项目准备在计时外，授权、上下文、视频理解、图片读取及模型等待都计时。状态、reasoning、后台恢复的最终文本不算首字。
- 部署后两端只做空 POST 的 400 门禁烟测，没有丢弃模型计时样本。首条计时样本全部保留。首轮附近还执行过两端只读健康检查；没有并行 build/test。
- 后端 run 最终均完成：18/18 对 18/18；原始首流完整结束为 Production 17/18、Preview 18/18。所有生成工具均未调用，实际工具只有 analyze_video、preview_frame、transcribe_audio。

## 首字结果

P75 使用线性插值。混合生产的延迟分位数仅基于收到正文的 5 条，必须与原始首流有效率同时看。

| 场景 | 生产首流正文 | Preview 首流正文 | P50 生产→Preview | P75 生产→Preview | Max 生产→Preview |
| --- | --- | --- | ---: | ---: | ---: |
| 图片 | 6/6 | 6/6 | 11.76s→5.49s | 14.23s→6.54s | 14.94s→19.51s |
| 视频 | 6/6 | 6/6 | 9.48s→10.02s | 9.72s→10.27s | 10.68s→10.90s |
| 图片+视频 | 5/6 | 6/6 | 20.78s→12.42s | 23.42s→12.87s | 27.54s→14.25s |

每轮首字原值（毫秒）：

| 场景 | 生产 1–6 | Preview 1–6 |
| --- | --- | --- |
| 图片 | 14769, 12632, 10894, 9781, 9367, 14940 | 19511, 5747, 4735, 3263, 6799, 5237 |
| 视频 | 9668, 9285, 10678, 7681, 9023, 9737 | 10335, 10078, 7717, 8043, 10900, 9958 |
| 图片+视频 | 20775, 缺正文, 18303, 16719, 27543, 23417 | 12653, 12181, 11817, 10792, 14247, 12944 |

## 整轮与失败观察

下表是原始 SSE 完整结束的耗时，不是首字，也不包含失败首流的后台恢复时间。混合生产只计算 5 个完整首流。

| 场景 | SSE 结束 P50 生产→Preview |
| --- | ---: |
| 图片 | 13.18s→6.61s |
| 视频 | 16.32s→11.64s |
| 图片+视频 | 22.17s→13.73s |

生产第 2 轮混合请求：HTTP 已成功，原 SSE 只有 status，10.815 秒时连接 terminated。只查询同一个 run，最终 completed，在请求后约 25.9 秒观察到完成；没有创建新 run。它是原始首流交付失败，不是模型没有完成，也没有证据证明 Preview 修复了该断流根因。

纯视频六条中，生产额外调用 analyze_video 2 次、preview_frame 4 次、transcribe_audio 1 次；Preview 只调用 preview_frame 2 次。候选摘要保留首尾，减少部分补看动作，但纯视频第一段正文仍略慢。

Preview 首条图片为 19.511 秒，其余为 4.735–6.799 秒。未删除该慢样本，也没有足够完整 phase trace 把它确定归因为冷启动、CDN 或模型推理。

## 验证与边界

- 重新对齐生产基线后，3035 项测试通过、2 跳过；CLI 0.17.19 smoke/upload 通过。
- 四项受控路由预检通过，最多五步、零重试、只有本地 read_file 可执行，媒体生成和项目写入均为零；新源码指纹证据已提交。
- 本地生产 webpack build/TypeScript/postbuild 门禁通过；Vercel 的 Turbopack build 和运行时门禁也通过，最大 API trace 为 189.75MB，102 个 API trace 均在 220MB 门槛内，CRC32C/FFmpeg 包装检查通过。
- Production 与 Preview `/api/health` 均 HTTP 200、healthy。无效的认证空 POST 两端均正确返回 400，真实媒体规划请求也已完成验证。
- 只读抽查回复可对应岩壁、森林、瀑布以及舞台和中文片尾标题。两版仍有六/七角色计数、末镜景别等细节不一致，不能据此宣布理解质量不退化或胜出。
- 只覆盖一个图片和一个视频家族的重复固定输入、新空项目。不是六种图片/视频覆盖，也不是长历史、多图批量、新文件冷缓存、完整创作质量或 iOS 真机验收。
- 指标是公网 API 原始 SSE 请求到正文，不是网页点击到 DOM；网页持久化事件重连的可见时间未测。

## 证据

本机私有证据目录：`/Users/tianyicai/.codex/artifacts/makaron-media-ttft-20261113/cloud-ab/`。`plan.json` 固定了顺序和计时口径；`compare.cjs` 是执行器；`summary.json` 与 `summarize.py` 是原始统计；每条有 metrics、首流正文和同一 run 的最终 receipt。版本、区域、alias、配置一致性、健康检查、构建和测试记录亦保留。私有 env、auth、完整 deployment 元数据与媒体 URL 不进入 Git。
