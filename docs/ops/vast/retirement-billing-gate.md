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
- 单测覆盖 Spicy 分型、无图不扣、余额不足、fallback 预检、Preview 扣费失败不返回付费图。目标测试、TypeScript、lint 与 Vercel build 通过。浏览器上传到 Tips Preview 的端到端路径尚未验收：当前浏览器文件选择器不可用，不能把 MCP 成功当作 UI 成功。

## 发布前检查

1. 在将要发布的提交与环境上核对模型配置（尤其 `MULEROUTER_Z_IMAGE_PROMPT_EXTEND`）、六条 SKU、Admin 可见性及费用；重新检查 Preview/Production 是否仍共库。
2. 在浏览器里走真实的 Tips Preview 和相机旋转入口，核对输出、余额与 usage 记录；文件上传问题需要先解决，不得用 API 测试代替。
3. 若浏览器或账单异常，保持 Vast 在线；确认生产流量已切走且无 fallback，并获得明确停机指令后才停止 Vast。
