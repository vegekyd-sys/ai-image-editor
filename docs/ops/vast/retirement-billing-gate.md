# Vast 退役候选的图片计费门槛

这是 Preview、Production 和 Vast 停机的验收记录。Production 与 Preview 共用 Supabase；表内供应商价格为当时核价依据，不代表当前供应商结算金额。

| 路径 | `credit_pricing.tool_name` | credits/次 | 供应商标价/次 |
| --- | --- | ---: | ---: |
| 生产 Vast 旋转（保持原价） | `rotate_camera` | 2 | $0.010（历史值） |
| 候选 fal 旋转，≤1 MP | `rotate_camera_fal` | 7 | $0.035 |
| Spicy 文生图（0 张输入） | `generate_image_qwen-spicy` | 3 | $0.013 |
| Spicy 单图编辑 | `edit_image_qwen-spicy` | 8 | $0.040 |
| Spicy 双图编辑 | `edit_image_qwen-spicy-2` | 9 | $0.043 |
| Spicy 三图编辑 | `edit_image_qwen-spicy-3` | 10 | $0.046 |

价格来自 `20260926200819_fal_rotation_pricing.sql` 和 `20260927075458_qwen_spicy_operation_pricing.sql`；供应商标价是核价依据，不等同于某次请求的实际账单。缺价必须拒绝请求；不能默认免费，也不能把多图按单图扣。生产已切到 fal 旋转 SKU；旧 Vast SKU 仅供历史对照。

## 2026-09-27 Preview 证据

- 独立部署：`https://ai-image-editor-ptdu6bw3f-vegekyd-sys-projects.vercel.app`，提交 `7f5c9f69`；无生产 alias。
- 使用真实个人 API key 调用 Preview MCP，0/1/2/3 张输入的 Spicy 与 fal 旋转各成功一张。5 张均有可解码图片、对应的扣费响应、余额变化和 `usage_logs`；依次扣 3/8/9/10/7，总计 **37 credits**。对应供应商标价合计 **$0.177**，并非已对账的供应商实际支出。
- 本地原图及逐项报告在忽略的 `test-results/billing-preview-2026-09-27/`，不提交媒体或个人余额。复跑脚本：`node scripts/verify-image-billing-preview.mjs <unique-preview-deployment-url> --spend`；每次会真实扣费，不会自动重试。
- Preview 和 Production 使用同一个计费数据库。已只读核对六条价目，并在 Preview 的 Admin → Billing 页面看到全部新 SKU；旧 `rotate_camera` 仍为 2 credits。验收插入新 SKU，没有改旧价目或执行宽范围数据库迁移。
- 单测覆盖 Spicy 分型、无图不扣、余额不足、fallback 预检、Preview 扣费失败不返回付费图。目标测试、TypeScript、lint 与 Vercel build 通过。浏览器 Tips 的完整出图与扣费仍须按目标版本单独验收，不能把 MCP 成功当作 UI 成功。

## 已记录、暂缓修复的 Tips 问题

- Tips Preview 的预检报价显示 2 credits，但实际 Spicy 图片编辑可能扣 8 credits/张；两张时约 16 credits（某些多图路径更高）。预检与实际扣费不一致。后续修复时应让报价与所选模型、输入图数和实际输出数一致；当前按用户决定先记录，不在本次 Vast 退役中修复。
- Tips 生成的 `usage_logs.project_id` 为空，项目归因不完整；目前不影响扣费入账。按用户决定暂缓修复。

## Vast 停机覆盖范围（2026-09-27 只读审计）

- 生产已经由 `dev` 提交 `c9a73152` 发布到 `https://www.makaron.app`；CLI 0.15.4 已发布。旧 `qwen` 经 CLI/MCP 真实出图由 Spicy 处理，Pony/WAI 被输入校验拒绝；NSFW Spicy 编辑、Enhance、Spicy 0/1/2/3 图和 fal 旋转均有生产可解码输出及对应 SKU 扣费。2026-09-27 12:25 UTC 后的本轮生产调用合计 398 credits；查询不到新的旧 Qwen/Pony/WAI/旧旋转 SKU 记录。
- 生产多角度矩阵覆盖人像、动漫、产品各 17 组，共 51 组：50 张成功，**1 组性感人像 315°/30°/1.4 被 fal 内容审核 HTTP 422 拒绝**；与 Preview 同角度结果一致，失败项没有 Makaron usage 扣费记录。产物见本机忽略的 `test-results/camera-angle-preview-matrix/`。部分远近角度耗时 35–68 秒，产品壶嘴/把手存在生成式形变；不能承诺严格 3D 几何一致。
- 用户接受 fal 1/51 的内容审核限制。已登录的生产 Chrome 项目 `/projects/8bd9d5bf-964e-4f4e-9182-8d5b58773a85` 中点击 Enhance「电影感光影强化」：Spicy 生成了可见缩略图和可打开的 Draft；只读计费核对新增 `edit_image_qwen-spicy`、`source=app`、8 credits。未点击「继续编辑」，不将验收草稿加入用户时间轴。生成图会重绘版式、丢失原海报部分文字，属于生成质量限制，不等同于无图或路由失败。
- 2026-09-27 停机前禁用并 bootout 本机 `com.makaron.qwen-vast-self-heal`（`launchctl print-disabled` 显示 disabled），避免其每 5 分钟自动拉起 GPU。随后停止主实例 `48270326`。只读复核主实例和冷备 `38761988` 均为 `actual_status=exited`、`intended_status=stopped`、GPU 小时费用为 0；两块磁盘仍计费。生产的 `COMFYUI_*`/`VAST_API_KEY` 环境变量、旧域名在确认无外部消费者后再退役，不盲删。
- 停机后生产 `GET /api/health` 为 healthy；经新版 CLI `makaron-cli@0.15.4` 调用生产 Qwen Spicy 文生图，实际得到可解码的 1024×1024 PNG，扣 3 credits、余额从 82496 到 82493，确认此链路不依赖已停 GPU。产物在忽略的 `test-results/vast-retirement-poststop-spicy.png`。
- Vast 主实例 `48270326` 停后仍约 $0.083/小时磁盘；冷备 `38761988` 停后仍约 $0.042/小时磁盘，合计约 $0.125/小时（$3/天、$90/30 天）。相比停机前省约 $0.40/小时 GPU。停机不会自动删除磁盘；用户随后明确授权观察 3 天，在 2026-09-30 到期且生产无异常时销毁这两台实例，之前不提前销毁。
- 零 Vast 持续费恢复材料：公开 GHCR 镜像 `ghcr.io/vegekyd-sys/makaron-vast-qwen-serverless@sha256:960c21f4861e019ec1177363eabdfe938cc67942977caba8651bffbf680767a6` 可匿名获取；Qwen 服务源码仍在公开 GitHub 仓库 `vegekyd-sys/makaron-vast-qwen-serverless`。用户要求不占本机空间，临时的本机源码备份已删除。镜像约 34.6 GB，未在新 Vast 实例做过恢复演练。**要使 Vast 持续费用真正归零，最终需销毁主实例和现有冷备及其磁盘；仅停止仍约 $3/天。**

## 发布前检查

1. 已完成：用户接受 fal 单角度审核限制；生产 Tips UI 真实预览和扣费、停机后 Spicy 出图均通过。上述 Tips 报价及归因问题保留为已知问题。
2. 用户已授权保留两台停止实例观察 3 天；当前不得提前销毁。已建立同线程每日观察任务，2026-09-30 22:15（北京时间）之后，只有生产切换和镜像可用性复核均通过、实例未被复用时，才销毁这两台实例及磁盘。若有问题则保留并报告。恢复时仍需重新租 GPU、下载约 34.6 GB 镜像；尚未做新实例恢复演练。
