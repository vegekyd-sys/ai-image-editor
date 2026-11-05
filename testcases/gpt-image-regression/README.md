# GPT Image 迁移回归集 v1

恢复自 2026-09-10 的 GPT Image 2.5 接入验收。原 session 当前标题为「验证 Nano Banana Lite 图生图」，ID `01a0839a-5924-7620-beb6-fb0e59b5e837`；核心验收 turn `01a08a72-2a6c-7d53-80c2-365bbe5663d7`。当时的文件位于已移除的 `ai-image-editor-image25/.artifacts/image25/default-scenarios/`，本次从 `.jsonl.zst` 归档恢复了脚本、13 张成图查看副本、素材来源、逐项时间和费用。

`manifest.json` 是固定题集：广告、中文信息图、电商详情、文字海报、App UI、网站、原创插画、六格分镜、人像保真、双参考、已透明产品再抠图、复杂广告抠图、透明机器人贴纸。保持原提示词、顺序、素材角色、比例和已知失败项。它包含素材 SHA-256、原路径和历史数据；新模型沿用此文件，不悄悄换题。新增能力用扩展集补充。

## 复跑

在仓库根目录运行，使用私有 env 中现有 FAL_KEY。会真实计费。当前默认配对为 2.5 low 与 2.6 low / high reasoning，模型顺序交替，每格一次。

```sh
node --env-file=<private-env> --import tsx scripts/gpt-image-regression.ts
node --env-file=<private-env> --import tsx scripts/gpt-image-regression-application.ts
```

第一条对两个显式 fal 端点使用同一份固定输入和提示词；第二条复现原十个共享 `editImage` 调用，非透明项传旧 `openai` 参数，透明项保持自动路由，断言实际是 2.6 Flare / fal。三项 Agent 测试另用 `makaron chat` 运行 manifest 中的原始用户指令：广告与信息图新建专用项目，广告抠图继续刚才的广告项目。记录每个 run，不在响应慢或下载失败时重新提交。

可筛选 `IMAGE_REGRESSION_CASES=poster,sticker`、`IMAGE_REGRESSION_VERSIONS=2.5,2.6`；用 `IMAGE_REGRESSION_OUTPUT=<new-directory>` 开新实验。已有 receipt 为 complete/rejected 时不再提交；POST 结果未知时必须停止，已接受请求只查询原 ID。应用脚本保留每次尝试，失败不自动重跑。独立目录记录每次实验，不能覆盖失败记录。

## 怎么判定

- 文字检查逐字、指定数字/价格、日期、数量、分镜标签；风格好看不能抵消文字错误。
- 人像/商品分别检查身份、姿态、服装、包装、商标与局部细节；双参考检查两张都生效。
- alpha 存在与抠图质量分别判定；透明图须查看棋盘格、深浅底上的边缘、光晕与残留。原 2.5 复杂广告抠图和机器人贴纸 **视觉未通过**，不得抹掉。
- 耗时区分供应商图片调用、共享工具、完整 Agent、下载/保存；每格一次只能描述样本，不能推断 P95 或 SLA。
- 费用使用对应端点当前报价 × 原任务 billable units；Agent 文字费另计；未知失败费用保持未知。
- 原历史 Agent 会扩写工具提示词，新直接配对使用原始用户指令，不能宣称完整复现历史隐藏扩写。当前 Agent 路径单列。
- 人像和可乐重新从原 URL 下载，旧原文件 SHA 不存在，不能声称与旧文件字节相同；历史 session 查看副本可能缩放/重编码。广告抠图的固定输入为原 session 的公共广告查看副本，两版本本次使用完全相同字节。

## 原 session 的其他验收

详见 `docs/experiments/image25-integration.md` 和本次报告覆盖对照表：订阅原生图片型号是否可锁定、CLI 杯子改色/透明图、供应商审核拒绝、GET 查询/下载恢复不得重发付费 POST、计费精确行、历史元数据、选择器/四语、CLI/MCP/Skill。原私人人像审核样本不纳入公开 fixture；未恢复原文件的样本不算复测。Segmind 和 Nano Banana Lite 属原 session 的额外供应商研究，当前迁移集不凭空将其计为 2.6 已覆盖。

GIF/SVG、各质量/推理档位、mascot、管理员 Codex Subscription → Agent → fal 链路属于 2.6 扩展集，证据在 `evidence/gpt-image26-upgrade/`。原生 Codex 图片型号是否真为 2.6 必须另证，不能用 Agent 调用 fal 的成功替代。
