# 自然语言 Skill 路由：受控实测

2026-10-14。按用户要求，对外目录移除 `motion-design-video`、`source-video-studio`、
`website-to-video`、`reference-video-studio` 四项。保留9个工作流入口与普通需求自动路由。
不删除内部 Skill；详细制作继续由内部 Skill 负责。

## 方法与边界

- 复用当前 Makaron `buildSystemPrompt`、Skill manifest、`createTools` 描述与 schema，使用自动选择的 `gpt-6-luna` 模型进行实际推理。
- 不传 `--skill`，不传 Active skill 前缀，也不在用户请求里写目标 Skill 名称；目标名仅用于事后核对。
- 使用模拟素材元信息，没有实际上传、媒体分析或生产项目写入。
- 只允许本机读取 Skill/提示词。其他工具全部以捕获器替代，任何调用都会被拦截并结束该例。不能可靠拦截的 provider 工具完全禁用。
- 每例最多5步、模型请求不重试。只测3类关键需求，不启动完整制作或付费媒体生成。
- 这是带真实模型的本地受控路由测试，不是生产 CLI → worker → 成片端到端验收。

## 结果

| 自然语言需求 | 实际读取 | 生成请求 | 结果 |
| --- | --- | --- | --- |
| 60秒故事，跨段人物/场景一致，导演规划与分镜 | long-video-director、long-video-anchor、long-video-storyboard | 0 | 正确选择，输出计划后停止 |
| 替换人物并保留参考片镜头顺序、时长、运镜与节拍 | video-edit、replication-protocol | 0 | 正确选择 replication，输出计划后停止 |
| 30秒中文产品讲解，旁白与字幕 | explainer-video | 0 | 正确选择，输出计划后停止 |

3/3 通过。没有任何非 read_file 工具请求；因此不是“试图生成但被拦截后仍算通过”。
图片/视频/音频生成、分析、代码执行、导出和项目写入实际执行数均为0。
实际费用只可能涉及本次模型推理；未用供应商账单核算精确金额，不把预检称为免费。

这证明三个具体自然语言请求能激活对应 Skill，并遵守本轮停止范围。
没有验证所有剩余入口、重复稳定性、原项目修复或完整制作质量。
生产 CLI 没有禁用生成的独立 dry-run 开关；对外文档给出明确的规划-only需求写法。
本测试的硬拦截只用于评测，不宣称已加入生产。

原始请求、读取路径、模型回答与 token usage 见 `natural-routing-results.json`。
入口仍为候选，未覆盖本机已安装 Skill、未更新插件 cache、未部署或发 npm。
