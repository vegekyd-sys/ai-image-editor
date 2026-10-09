# 通用图片图库：本地尝试

正常 Makaron 编辑器里的图片消息支持多张图片，不按模型区分 UI。同一条消息关联的普通图片 snapshot 全部展示，点击图片用确切 snapshot ID 切换画布，编号仍对应整个项目时间线。视频与 design poster 沿用各自的展示合同。

## 图片与 Prompt

每次 `generate_image` 调用记录独立的 `PhotoMetadata.imageGeneration`：请求 ID、Prompt、实际模型和输入图片 URL。供应商一次返回多张图片时，这些图片保留同一个请求 ID。数据通过现有 image 事件和 DualWriter 保存，重新打开后仍能对应。

- 不同调用各图下面显示自己的可折叠 Prompt。
- 同一个请求、相同 Prompt 和模型的一批候选共用一张 Prompt 卡，不虚构每张候选的独立提示词。
- 普通模型记录工具请求的生成 Prompt；Midjourney 优先显示准备后实际提交的英文 Prompt。
- 历史记录按 run 和事件序号，从 `tool_call → image.snapshotId` 恢复对应关系。旧 MJ 中文输入标为转换前需求，已保存的实际提交 Prompt 不覆盖。读取恢复不批量改写历史数据库。
- 只有消息最后一条旧 Prompt 时，只关联最后一张图片；其余图片显示未记录，不复制最后一条冒充各图 Prompt。
- 即使旧消息缺失 `has_image` 标记，尝试版仍可从已保存 photo snapshots 展示图库。

## 试用与回退

开发模式默认启用；生产默认关闭，只有显式设置 `NEXT_PUBLIC_IMAGE_GALLERY_EXPERIMENT=1` 才启用。当前只在 3041 的专用本地 runner 试用，未合并、未部署。

正常项目 URL 是尝试版；在末尾加 `?imageGallery=classic` 可比较只展示最后一张图片的样式。该模式仍使用最后一张对应的 Prompt 与 snapshot ID。

尝试前保存的分支 `codex/image-gallery-before-experiment` 指向 `3c5c57e7`，可恢复本次通用图库尝试前的版本，包括既有 Midjourney 接入与空画布修复。

## 本地验证

40 个相关测试文件、331 项测试通过，覆盖图片批次、独立 Prompt、历史恢复、DualWriter、Agent callbacks、模型与媒体合同；之后的历史缺失图片标记修复另跑 30 项相关测试通过。TypeScript、四语 UI、core prompt 检查通过。

隔离验收账号使用 GPT Image 2.5 Flare 真实生成红、蓝、白宇航服三张图片，三次调用分别保存不同请求 ID 和 Prompt。自然 Agent 回合将三次调用保存为不同消息，三图均显示；在该隔离测试项目中将三张图片归入同一消息，复现一条回复内三图的展示情况，保留真实图片和各自生成 metadata。桌面 1280×900、窄屏 390×844 验证三图、各自 Prompt、第二/第三张选图、重新打开及 classic 模式。窄屏无水平溢出，最终检查无页面或 console error。

用户既有项目重新打开后，两批四图均可显示；原有视频保留。本次没有向用户项目提交新生成请求，也没有修改其媒体、Prompt 或计费记录。图片质量和最终布局是否保留，仍以用户试用反馈为准。
