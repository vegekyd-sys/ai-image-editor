# 视频编辑能力梳理：统一到「局部编辑」

2026-10-08。基于 `codex/video-retake` 当前代码梳理；以下删除与迁移属于建议，本次未删除旧工具。

## 名称与产品合同

面向用户使用「局部编辑」（繁中「局部編輯」、日文「部分編集」、英文「Edit segment」）。说明：选择一段视频，描述要改变的内容，其他部分保持不变。按钮、选区状态与聊天上下文使用同一名称。保留内部 `inspect_retake` / `retake_video`、CLI `video retake` 与 MCP `makaron_retake_video` 名称，兼容已有调用。

当前支持选择 0.1–15 秒，源视频最长 120 秒、最高 60 fps；默认 FAL H3 Max，可选 Seedance 2.5。先理解所选画面与前后动作，再扩写需求，生成后拼回完整视频，保留原声与总时长。这里的“保持不变”指选区外内容不改；完整视频重新编码不承诺字节一致。LTX 不在支持模型中。

生成状态按用户更正保持原样，本次不调整模型状态显示。

## 当前能力与处理建议

| 当前入口 / 能力 | 建议 | 原因与边界 |
| --- | --- | --- |
| GUI「从这帧改视频」：截帧、把截图放入聊天 | 删除旧入口与专用回调，统一到局部编辑 | GUI 已优先走 `onRetake`；局部编辑同时给出时间范围，避免截图定位和额外问答。通用截帧工具仍保留。 |
| 截图定位 → 裁前中后 → 生成 → 询问拼回 → 拼接的片段修复流程 | 保留定位，替换后续重复流程 | 用户只给截图时仍需定位；定位得到区间后可以走理解与局部编辑。旧流程可保留为内部对比资料，不作为默认产品路径。 |
| 选区内改变人物、物体、背景、特效、镜头 | 统一到局部编辑 | 用户意图是改这一段；时间线选区与聊天共用请求。复杂动作、文字和精细实体修改仍需真实输出验收，不能只凭生成完成判定成功。 |
| 整条视频换风格 / 全片改角色 / 参考复刻 | 保留整片编辑、复刻能力 | 局部编辑最多 15 秒，并保留原音轨；长视频的全片修改与镜头结构复刻不是同一合同。短片满足上述边界时可选中全片。 |
| 裁剪、删除、重排、变速、画幅、转码 | 保留精确剪辑 | 应用 FFmpeg 或已有 Remotion 时间线操作，确定性更强，不需要重新生成画面。 |
| 字幕、标题、Logo、画中画、转场 | 保留可编辑叠加与合成 | 需要准确文字、位置与时间控制，走 Remotion 的可编辑结构。局部生成不能替代这些精确操作。 |
| 配乐、旁白、翻译、配音、对口型 | 保留声音及口型能力 | 局部编辑恢复原始音轨，不能承担改台词或翻译配音的合同。可组合使用，不能默认归并。 |
| 延长视频、新增开头 / 结尾 | 保留延长能力 | 会改变总时长，与局部编辑的等长替换不同。 |
| 超分、提高画质 | 保留画质能力 | 改善清晰度，与改变片段内容不同。 |
| 口播精剪、找高光、长片拆短片 | 保留语义选片及剪辑流程 | 需要理解全片、转录与剪辑；局部编辑可作为单个镜头的修补步骤。 |
| CLI 与 MCP 的既有视频编辑 API | 保留兼容 | `makaron_edit_video` 还支持整片编辑与不同参数合同；不能直接删除或把所有调用改成 15 秒局部编辑。 |

## 建议执行顺序

1. 本次：完成产品改名、聊天路由别名及四语言一致性；保持生成状态不变。
2. 下一步：删除「从这帧改视频」的专用 UI 分支与状态，检查全部调用方；保留 `preview_frame` 的分析和关键帧用途。
3. 再迁移截图修复：截图定位出区间 → `inspect_retake` → `retake_video` → 自动交付完整视频，移除默认流程中的重复裁剪和二次拼回确认。需覆盖截图定位、源片偏移及真实聊天产物。
4. 统一其他有明确区间的生成式编辑意图；保留整片编辑与精确剪辑的路由边界。内部 API 继续兼容。

“画面理解 → 基于画面扩写 → 首尾衔接”仍是验收标准。此前四种视频回归中，滑板、图书馆取书、玩具案例通过各自要求；格斗案例仍未达到完整要求，因此不把局部编辑描述为能可靠完成所有视频修改。本次只做名称与路由说明调整，不重新提交付费生成。

## 代码依据

- UI 与旧入口：`src/components/VideoResultCard.tsx`、`src/components/Editor.tsx`（`handleVideoFrameEdit` / `handleVideoFrameCaptured` / `onRetake`）。
- 选区聊天：`src/components/AgentChatView.tsx`、`src/lib/locales/{zh,zh-Hant,ja,en}.ts`。
- 理解与执行合同：`src/lib/prompts/agent.md`、`src/lib/agent-tools.ts`、`src/lib/video-retake-contract.ts`、`src/lib/video-retake-media.ts`。
- 旧修复流程：`src/skills/video-segment-edit/SKILL.md`。
- 整片编辑与复刻：`src/skills/video-edit/SKILL.md`、`src/skills/video-edit/references/{editing-protocol,replication-protocol}.md`、`src/lib/prompts/animate.md`。
- 精确剪辑与声音：`src/skills/video-ffmpeg-lab/SKILL.md`、`src/skills/video-translate/SKILL.md`、`src/skills/talking-head/SKILL.md`、`src/skills/content-repurpose/SKILL.md`。
- 外部接口：`src/mcp/server.ts`（`makaron_retake_video` / `makaron_edit_video`）、`packages/makaron-cli/bin/makaron.mjs`。
- 之前的真实视频结果：`docs/research/video-retake-comparison-2026-10-07.md`。
