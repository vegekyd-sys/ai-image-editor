# Vast 退役候选的图片计费门槛

这是 Preview/worktree 的验收记录，不是生产切换或 Vast 停机许可。Production 与 Preview 共用 Supabase；发布前必须重新只读核价，并在目标版本上验收真实出图及扣费。

| 路径 | `credit_pricing.tool_name` | credits/次 | 供应商标价/次 |
| --- | --- | ---: | ---: |
| 生产 Vast 旋转（保持原价） | `rotate_camera` | 2 | $0.010（历史值） |
| 候选 fal 旋转，≤1 MP | `rotate_camera_fal` | 7 | $0.035 |
| Spicy 文生图（0 张输入） | `generate_image_qwen-spicy` | 3 | $0.013 |
| Spicy 单图编辑 | `edit_image_qwen-spicy` | 8 | $0.040 |
| Spicy 双图编辑 | `edit_image_qwen-spicy-2` | 9 | $0.043 |
| Spicy 三图编辑 | `edit_image_qwen-spicy-3` | 10 | $0.046 |

价格来自 `20260926200819_fal_rotation_pricing.sql` 和 `20260927075458_qwen_spicy_operation_pricing.sql`；供应商标价是核价依据，不等同于某次请求的实际账单。缺价必须拒绝请求；不能默认免费，也不能把多图按单图扣。生产仍使用旧 Vast 旋转 SKU，候选版本上线时才会切到 fal SKU。

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

- 候选代码已将旧 `qwen` 映射到 `qwen-spicy`；NSFW 和 Enhance 主路径走 Spicy。`pony`/`wai` 明确退役并报错，不要求风格等价替代。相机旋转走 fal，使用独立的 `rotate_camera_fal` 价目。Preview 的 MCP 真实出图和扣费已验收；51 次多角度测试得到 50 张图、1 次供应商内容策略拒绝。生产尚未切到该候选版本。
- 停机前只剩三个实际动作：① 发布候选到生产，并在生产真实验收 Spicy（含旧 `qwen` 调用和 NSFW）、Enhance、fal 旋转及扣费；② 确认旧 Vast 调用已排空，再卸载本机每 5 分钟运行的 `com.makaron.qwen-vast-self-heal`，否则停机后它会自动拉起 GPU；③ 收到用户明确停机指令后再停止 Vast。当前不做这三步。
- 附带清理：内置 `src/skills/comfyui/SKILL.md` 和 CLI 帮助/文档仍宣称 Pony/WAI 可用，应在发布时同步更正；生产的 `COMFYUI_*`/`VAST_API_KEY` 环境变量、旧健康检查与 `comfyui.makaron.app` 域名在确认没有外部消费者后再退役。它们不是继续租用 GPU 的理由，但不能盲删。
- Vast 主实例 `48270326` 仍运行，约 $0.40/小时 GPU + $0.083/小时磁盘；冷备 `38761988` 已停止但仍约 $0.042/小时磁盘。停主实例只省 GPU 费，不会自动删除两块盘；销毁实例属于另一个需要明确授权的决定。

## 发布前检查

1. 在将要发布的提交与环境上核对模型配置、六条 SKU 和费用；Preview/Production 共库，不能把 Preview 扣费当作生产路由验收。
2. 在生产真实运行 Spicy、Enhance 和 fal 旋转，核对图片、余额、usage 记录，并确认没有旧 Vast 流量。上述 Tips 报价及归因问题保留为已知问题。
3. 用户确认停机时，先停自愈任务，再停止 Vast 主实例并持续观察；冷备和磁盘另行决定，不自动销毁。
