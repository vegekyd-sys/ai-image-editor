# Seedream 5.5 接入合同

Makaron ID 为 `seedream-5.5`，通过现有 EvoLink 账号调用 `doubao-seedream-5.5`。模型可在网页选择器、Agent、MCP 与 CLI 显式选择；不加入 Auto，不替换默认模型，也不在失败后自动重发或换供应商。

## 参数与素材

- 支持文生图、带参考图生成、原图编辑。最多 10 张输入，包含编辑原图；顺序保持不变。
- Makaron 输入合同为可公开读取的 HTTPS PNG/JPEG/WebP 静态图。单张最多 30MB / 36MP，宽高均大于 14，比例为 1:16–16:1。更广的上游格式未在 Makaron 宣称支持。
- `makaron chat --image` 沿用项目上传；`makaron edit --image/--ref` 对 Seedream 自动将本地文件通过现有签名上传接口上传，不再把 data URL 直接发给 EvoLink。直接 MCP 调用方须先上传并传 HTTPS URL。
- 输出 PNG（默认）或 JPEG；`background` 为 auto/opaque/transparent。透明输出必须是 PNG，并解码检查实际 alpha，不接抠图 fallback。
- 分辨率为 1K / 1.5K / 2K，方图分别为 1024 / 1536 / 2048。支持供应商正式比例预设：1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9、9:21。
- 无比例的编辑使用 `size=auto`；文生图默认 1:1。暂不开放供应商任意像素尺寸接口。
- 固定 `prompt_priority=standard`。GPT quality/reasoning、GIF/SVG/WebP 输出、4K 和其他不支持的组合，在付费提交前失败。

## 计费

[EvoLink 正式价格](https://evolink.ai/seedream-5-5)：1K 与 1.5K 输出每张 $0.016，2K 每张 $0.028；所有输入图每张另加 $0.0064。透明 PNG 无额外费用。

`providerCostUsd = outputTierUsd + inputCount × 0.0064`。输入数量包括原图与所有参考图。共享计费函数仅对完整费用乘 `token_rates.markup` 后向上取整一次，1 credit=$0.01，不分别对每张输入取整。

| 输入数量 | 1K / 1.5K，markup=2 | 2K，markup=2 |
| --- | ---: | ---: |
| 0 | $0.016 → 4 credits | $0.028 → 6 credits |
| 1 | $0.0224 → 5 credits | $0.0344 → 7 credits |
| 2 | $0.0288 → 6 credits | $0.0408 → 9 credits |
| 10 | $0.0800 → 16 credits | $0.0920 → 19 credits |

App/CLI chat 的 Agent 推理单独计费，直接 CLI edit 没有 chat Agent 费用。生成前检查余额，成功且图片已下载、解码、格式及 alpha 合同通过后才调用一次现有扣费事务，扣费失败不向用户发布新图；供应商拒绝、参数失败、超时不会被当作图片成功扣费。异步结果未知时保留原任务，不自动重试。供应商已消费但本次图片没有交付的支出与产品 credits 分开审计。

必须存在精确、启用、正有限 markup 的 `seedream-5.5` 行；不从其他 Seedream 或 OpenAI 行推测价格。候选迁移为 `supabase/migrations/20261112185220_seedream55_evolink_pricing.sql`，默认 markup=2，token 单价为零（固定 provider USD 路径），不会覆盖已有管理员价格或重新启用停用行。迁移在候选验收中仅应用于隔离 PostgreSQL，不提前写共享数据库。

## 回执与保存

一次付费 POST 返回任务后，先保存私有 workspace 回执，再 GET 同一任务。App/chat 回执在项目的 `seedream55/<taskId>.json`，HTTP/MCP 的直接 edit 回执在当前用户 workspace 的 `seedream55/<taskId>.json`。完成、失败均更新回执；取消、超时或查询异常保留 task ID。GET 的瞬时失败可有限重试，POST 从不自动重发。

成功快照保留精确 model/provider/providerModel、task ID、实际提交 prompt、输入 URL、分辨率、比例、背景与格式；原生 PNG/JPEG 字节进入现有存储、图片导出与项目重开路径。工具回传实际路由，Agent 的选择器上下文和最终汇报以实际路由为准。

运维只读查询：`pnpm exec tsx scripts/seedream55-query.ts <taskId> --env <private-env-file>`。原始回执与媒体 URL 不写共享日志或公开文档。

## 合入与发布前提

1. 用户评审并决定合入候选；本次不合入、不 push、不部署、不发布 NPM。
2. 正式发布时先核实 EvoLink 价格与账号权限，在选定数据库应用价格迁移，确认精确启用行。缺少该行的部署会在提交前拒绝候选生成。
3. 按正常发布流程验证 Web 与 CLI/help/README/bundled Skill 同步，并从 registry 全新安装验收；本地 tarball 安装验收不等同于 NPM 已发布。

`doubao-seedream-5.5-layerize` 是多结果分层任务，本轮仅调研与独立小样验证。它不属于此单图后端，不可冒充普通图片模型注册；需另外设计按实际产物数结算、图层 manifest 和可编辑 composition 合同。
