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
