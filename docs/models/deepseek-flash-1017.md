# DeepSeek Flash 1017 默认 Agent 发布

本轮将 `deepseek-flash`（供应商当前 1017）设为无配置和 Auto 的默认 Agent。生产及 Preview 的 `AGENT_MODEL=deepseek-flash`，显式 Luna/Sol 与个人订阅选项继续可选。`write_video_script` 同样遵循默认配置。

## 能力与交付

- Flash 原生处理用户图片和工具返回的预览帧；工具图片转换成兼容的后续 user 图像消息，保留工具结果身份及文本。小 PNG/WebP 不再误标为 JPEG。
- 保留稳定 system prompt 前缀，启动时安全预取项目与工具；避免每轮用户输入破坏缓存。
- 修复首条流消息绑定、持久化终态事件排空；同一 materialize 参数重查原任务状态，失败不再标记 pending。
- CLI 0.17.4 更新模型帮助与 Skill；`chat --stream` 提前断流后轮询同一个 run，并跳过已输出的正文前缀，不重新提交生成。
- 产品更新日志覆盖简体、繁体、英语和日语。

## 计费

官方价格来源：https://api-docs.deepseek.com/quick_start/pricing/

数据库 `deepseek/deepseek-flash` 精确行保存高峰供应商 USD/百万 tokens：未缓存输入 0.30，缓存命中 0.006，输出 1.20，markup 2。按每次模型请求开始时间计算高低峰，低峰乘 0.5，逐步累加供应商成本后统一扣费；独立视频脚本也返回未加价的真实供应商成本，由统一账本应用一次 markup。缺少精确定价时拒绝付费推理，不借用其他 DeepSeek 行。

2026 年中国法定节假日已覆盖；新增年份前须按国务院日历更新 `deepseek-flash-rate.ts`。未知年份的工作日高峰拒绝猜价；周末和非高峰小时仍按明确的低峰规则计算。

## 验证与实际边界

原配对作品、耗时和钱包账单见 `docs/benchmarks/2026-10-17-deepseek1017-round2.md`；首字数据及保留的失败样本见 `docs/benchmarks/2026-10-17-deepseek1017-ttft.md`。无图 CLI 首字有所改善，原生识图规划仍有约 12–25 秒的有效样本，不能宣称所有任务都提速。独立新 Preview 登录态的浏览器首字尚未复验，用户选择用 Makaron Chat CLI 验收。

本次复核增加默认回退、精确定价和独立脚本 PNG/低峰成本测试，CLI 覆盖空正文和部分正文断流后恢复同一个 run。正式发版依照 canonical dev 的 `release:prod`、线上 Chat 实跑以及 NPM 全新安装验收。

## 回退

需要回退默认模型时，将 Production/Preview 的 `AGENT_MODEL` 调回 `gpt-6-luna` 并重新部署已验证版本。供应商 key 的旧值仅保存在本机私密备份，不进入仓库；Flash 模型价格行无需删除。此默认切换不会修改已生成项目或媒体。
