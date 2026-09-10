# DeepSeek V4.1 Flash 接入与 Scene → TikTok 实测

## 状态与范围

- 独立分支：`feat/deepseek-flash-41-20260910`；worktree：`/Users/tianyicai/ai-image-editor-deepseek-flash-41`。
- 本地运行及真实供应商测试，未合并 dev、未部署生产、未发布 npm；Auto 默认模型未修改。
- 复用既有账户创建一个测试项目。共享计费数据库只新增 `deepseek/deepseek-flash` 行，未修改既有模型价格；对应 migration 使用 `ON CONFLICT DO NOTHING`。
- 独立测试 runner 位于 `/Users/tianyicai/ai-image-editor-flash41-runner`，避免占用已有的 dirty runner。

## 接入合同

官方模型 ID 是 `deepseek-flash`，模型版本是 DeepSeek V4.1 Flash，支持原生图片输入和工具调用。依据：[官方入口](https://api-docs.deepseek.com/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[价格](https://api-docs.deepseek.com/quick_start/pricing/)，均于 2026-09-10 核验；真实 `/models` 也返回该 ID。

- 模型目录、四语选择器和 CLI `--agent-model deepseek-flash` 均已添加。
- 新模型使用固定版本 `@ai-sdk/deepseek@3.0.42`；开启 high thinking。旧 V4 Pro 路由保持原样。
- SDK 只以 `deepseek-v4` 名称识别跨用户轮次的推理回传，因此增加 patch-package 补丁，纳入正式的新名称。否则新用户消息之前的推理会被静默丢弃。
- 计费目录采用官方高峰 USD 单价：输入 0.30、输出 1.20、缓存命中 0.006 / 百万 token，沿用 2 倍产品倍率。低峰供应商成本为一半；目录计费并非供应商实扣金额。

## 验证

- 36 项相关测试通过：模型目录、模型选择器、原生视觉、跨轮推理 wire contract。
- CLI smoke、`check:i18n-ui`、`check:agent-discovery`、`tsc --noEmit --incremental false` 通过。
- `scripts/smoke-deepseek-flash.ts` 真实 API：流式输出、连续两次依赖工具调用、携带历史的下一轮追问、图片识别均通过；5 次请求共约 7 秒。该小测试不代表视频制作耗时。
- Native adapter 的线级测试确认请求发送正式模型 ID、保留旧轮次 reasoning、直接传 image_url，并保留缓存 token 统计。

## 样片

项目：[Zhenfeng Toys TikTok](https://www.makaron.app/projects/5cce0479-db85-440f-a383-21cf3a7020d6)。Scene 的振丰玩具项目返回 6 个来源范围、合计 23.25 秒，覆盖动态公仔、注塑、仓库、包装、分拣、装车。原片均为 1080×1920。

Scene 输出的 `media_type` 在临时 handoff manifest 中添加当前 Makaron CLI 要求的 `type: video`；原片 URL 和 start/end 保持不变。没有将 Scene 凭据传给 Makaron。

1. 首轮 run：`7787be70-3a00-4736-81f8-cd1cc1734539`，CLI 明确选择 `deepseek-flash`，自动读取 TikTok Skill；只生成一次旁白+BGM 母版并执行 ASR。
2. 原片 FFmpeg 读取两次遭遇 TLS EOF，模型自行换 Node fetch 后恢复；额外素材下载/探测耗时约 112 秒，不应算成纯模型推理耗时。
3. Agent 执行 529.922 秒；从提交到首轮实际 MP4 完成为约 574.083 秒（9 分 34 秒），其中导出约 51.76 秒。
4. 首轮模型 token：未缓存输入 275,224、缓存输入 1,558,528、输出 59,040；模型计费 33 积分。此数不含音频、ASR、渲染；也不是供应商账单金额。
5. 首轮实际 MP4 可播放、有声音，但 CTA 的 `catalog` 与琥珀色胶囊背景同色，导致关键字不可见。模型虽然读取预览图并声称检查通过，仍漏掉该问题。预览曾出现的仓库黑帧未出现在实际导出的 MP4。
6. 带实际成片截图的修正 run：`4fdb2f75-3c3b-4d19-9e39-b02f7b919c5a`。同一模型按具体反馈修正 CTA；复用音轨与素材，无新增音频生成。修正版可编辑 snapshot：`73376d1a-ffa6-5f14-8bf0-112f8d393994`。
7. 修正版默认导出实际是 720×1280；原生高清导出通过 Makaron CLI `materialize --snapshot 73376d1a-ffa6-5f14-8bf0-112f8d393994 --profile source` 执行，不将已编码的 720p 放大冒充原生 1080p。

## 质量结论

该样本证明模型可以驱动真实销售素材的脚本、配音、ASR、合成、预览和导出，也能根据截图反馈修复问题。它不证明模型可以可靠地自动验收自己的视频，更不证明销售转化率提升。当前更适合低成本生成初稿并保留外部视觉检查。

修正版 720p 已完整解码，H.264 + AAC 双声道、30fps、25.045 秒；检查了 13 个关键时点（包含全部字幕中点与结尾），CTA 完整可读，未检测到持续 0.1 秒以上且覆盖 98% 画面的黑帧，音频平均电平约 −13.3 dB。
