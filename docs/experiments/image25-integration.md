# Image 2.5 接入与比较（2026-09-09）

状态：仅独立 worktree 准备；产品接入未完成，未合并、未部署、未修改共享配置。

分支：`codex/image25-integration`，基线：`fc1217e5`。

## 已核实

- 官方模型为 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。Flare 偏重日常生成速度，Sunburst 偏重编辑精度。
- 两者支持 Images API 的 generations / edits、PNG 透明输出，以及 low / medium / high / xhigh / max / auto。Image 2 对照应采用共同支持的 low / medium / high。
- 官方文档：https://developers.openai.com/api/docs/guides/image-generation
- 官方模型：https://developers.openai.com/api/docs/models/gpt-image-2.5-flare 和 https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst

## 当前可用性障碍

- 现有 OpenRouter `/api/v1/images` 对两个完整 2.5 模型 ID 都返回 HTTP 404 / No model found。
- 现有 Azure 资源以两个官方模型名作为部署名调用，均返回 HTTP 404 / DeploymentNotFound。这不能排除资源使用不同部署名的可能。
- PiAPI `/v1/models` 返回 HTTP 200，但未列出名称匹配 Image 2.5 的模型；这不是生成接口不支持的充分证明。
- 项目已检查的本地环境文件未配置官方 `OPENAI_API_KEY`。

因此尚无真实 2.5 输出，不能宣称质量提升或速度提升，也不迁移当前默认模型。下一步需要确认可用供应商、模型/部署 ID 和对应凭据来源。

## 个人 GPT 订阅实测

Azure 开通已由用户交给同事；本任务停止 Azure 管理门户操作。以下测试只使用现有个人订阅 Relay，无 API 回退，无应用数据库写入。

已从当前 Vercel Preview 只读核对 Relay URL / 签名配置，与本地测试配置相同。签名 `/v1/usage` 成功，返回 Pro 套餐。三次请求固定同一产品摄影提示词，主模型 `gpt-5.6-terra`，图片工具请求 `quality=low`、`size=1024x1024`、`background=opaque`。

| 请求图片模型 | 完整响应耗时 | 原始尺寸 | 服务端回传图片工具模型 |
| --- | --- | --- | --- |
| `gpt-image-2.5-flare` | 70.479 秒 | 1448×1086 | `gpt-image-2-codex` |
| `gpt-image-2.5-sunburst` | 87.925 秒 | 1254×1254 | `gpt-image-2-codex` |
| `gpt-image-2` | 87.809 秒 | 1254×1254 | `gpt-image-2-codex` |

三次都是 HTTP 200、完成事件和可解码 PNG；已目视查看原图，杯子上的 MAKARON 拼写正确，陶瓷釉面、布料和光照可辨。所有响应的 `response.completed.response.tools` 都回传 `quality=auto`、`size=auto`。表中名称只是请求值，不能据此把这些输出标成 Image 2 / Flare / Sunburst 的有效 A/B。

仓库 Relay 的 `forwardResponses` 将原始请求 body 直接转发，未包含图片模型或质量改写逻辑；本次未登录远端核对已部署代码散列。因此无法把改写位置断言为已验证的远端代码事实。订阅服务回传了统一别名，也不代表已证明底层权重仍是旧 Image 2：它可能是持续更新的订阅别名，响应没有提供足以确认 2.5 的版本证据。

结论：个人订阅图片链路可用，但目前无法显式确认 2.5 Flare / Sunburst 的独立选择，也无法锁定质量和尺寸。不得据此得出版本质量或提速结论。先保留现有产品默认与命名，等可明确选择模型的供应商部署后完成迁移。

原图及脱敏摘要位于本 worktree 的 `.artifacts/image25/`，不包含原始 SSE、OAuth token 或签名凭据。可复用脚本为 `scripts/compare-codex-image25.ts`，使用 gitignored env 运行；模型确认失败会返回非零退出码，区别于生图失败。

补充编辑验收：以第一张红杯为输入，请求只把杯釉改为钴蓝。个人订阅完成响应 145.962 秒，解码并保存完成 146.004 秒，输出 1448×1086 PNG。目视检查杯子已变蓝，MAKARON 字样、构图、布料和背景保持一致；未做逐像素保真声明。服务端仍回传统一订阅别名和 auto 参数，脚本按预期返回退出码 1，原因是 `explicitModelConfirmed=false`，并非编辑失败。产物为 `.artifacts/image25/subscription-edit/`。

本次变更只有实验文档与比较脚本。TypeScript 全项目检查通过；未修改产品运行时代码、未合并或部署。

## 对比脚本

`scripts/compare-image25.mjs` 面向官方或兼容的 Images API，顺序调用三个明确模型，不自动重试或回退，不写应用数据库。通过环境加载 API key；不将密钥放在命令行或报告中。

```sh
# 环境中先配置 OPENAI_API_KEY；默认每模型一次，运行会产生供应商费用。
node scripts/compare-image25.mjs

# 编辑：多个输入按命令行顺序提交，第一张作为基础图。
IMAGE_BENCH_PROMPT='Change only the cup color to cobalt blue. Preserve all other details.' \
node scripts/compare-image25.mjs /absolute/path/source.png
```

可选环境变量：`IMAGE_BENCH_BASE_URL`、`IMAGE_BENCH_MODELS`（逗号分隔）、`IMAGE_BENCH_QUALITY`、`IMAGE_BENCH_SIZE`、`IMAGE_BENCH_BACKGROUND`、`IMAGE_BENCH_REPEATS`（1–5）、`IMAGE_BENCH_OUTPUT`。

报告保存提示词、尺寸、质量、背景、模型 ID、请求头耗时、完整响应耗时、图片解码并保存后的耗时、像素尺寸、透明通道和原始 usage。保存原始输出，不经过应用 JPEG 转换。重复实验轮换模型顺序；同名 quality 不保证相同费用或计算量。原始 API 输出与应用最终显示结果还需分别验收。

已通过脚本语法检查与模拟响应的三个模型生成、PNG 解码、透明度和报告合同验证；模拟结果不属于模型质量或速度证据。

后续接入范围：确认供应商后完成模型调用、实际模型与计费记录、文生图/编辑/多参考图/透明背景的真实验收，再提供同条件视觉比较。自然语言路由优化与产品清晰度选项留在后续任务。
