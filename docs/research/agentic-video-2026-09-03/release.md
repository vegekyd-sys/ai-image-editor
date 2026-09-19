# Gemini 3.8 Flash 生产切换记录

2026-09-03 20:51 Asia/Shanghai 已完成正式域名切换和真实 CLI 验证。用户在了解 Preview 的速度、价格及质量回退后明确选择替换。

- 发布源：canonical dev，合入提交 `d705fad6724f0d9d15f31624e37df9b517e8c348`。
- 默认：`gemini-3.8-flash` / static / low；Describe、上传预分析、CLI/MCP 使用统一 helper，截图定位不在本次替换范围。
- 生产部署：`dpl_FyBtE7Eig5J6Ar3etJCCnxMYvS6R`，https://ai-image-editor-5isphjgev-vegekyd-sys-projects.vercel.app。
- `https://www.makaron.app` 和 `https://makaron.app` 均已显式绑定该部署，重新 inspect 确认 ID 一致。
- 首页返回 200（最终 /home），`/api/health` 200、healthy 13/13。[域名与健康证据](./production-acceptance.json)
- 生产 Google key 与 Preview/local 不同；发布前用生产 key 跑真实视频成功，无须修改任何环境变量。[生产凭据探针](./production-key-smoke.json)

## 发布门禁

新合入提交通过 TypeScript、252 个测试文件 / 1,501 个测试、CLI smoke、本地 Turbopack build、Vercel cloud build。四语言 changelog 的 lint / i18n / Agent startup / video-reference-workflow 检查全部通过。

`npm run release:prod` 的部署步骤完成，但末尾系统 curl 的健康检查出现 LibreSSL `SSL_ERROR_SYSCALL`，导致包装脚本 exit 1。没有重发部署：之后用 Node HTTPS 对相同正式域名补做首页和 health 检查，并用真实 CLI 完成下面四项验收。部署 Ready 本身未被当成线上验收。

## 正式域名真实请求

| 任务 | 端到端耗时 | 实际 credits |
| --- | ---: | ---: |
| 57 秒广告概述 | 12.762 s | 2 |
| 46–48 秒局部画面 | 4.165 s | 1 |
| 人物介绍标签 | 4.671 s | 1 |
| 15 秒 Makaron 介绍片，含上传 | 11.408 s | 1 |

四次响应都显示 `model: gemini-3.8-flash; processing: static; thinking: low`。对应四条 ledger，模型均为 3.8，按 token 核算共 5 credits，没有该轮 analyze_video 重复扣费记录。

[完整响应](./production-after-cli.json) · [真实用量和扣费](./production-after-billing.json)

这是上线后的可用性、模型和计费验收，只有小样本；不宣称质量无损或稳定延迟 SLA。介绍片无音轨却被描述为电子配乐的已知问题在生产复验仍出现，没有把本次发布写成该问题已经修复。切换前的完整比较见 [implementation-38.md](./implementation-38.md)。

## Git 与回滚信息

代码已在本机合入 dev 并提交。GitHub HTTPS fetch/push 连接超时，系统 Git 与 bundled Git 的有限重试均未恢复；SSH 连接返回 publickey 拒绝。没有覆盖远端分支或重写历史。远端同步尚未完成，不影响已上传到 Vercel 的生产代码。

前一生产部署：`dpl_E636sH1J2DatQH81K9YSdjR2z5g5`，https://ai-image-editor-6koib4yo2-vegekyd-sys-projects.vercel.app。保留旧部署供需要时回滚；本次没有执行回滚。
