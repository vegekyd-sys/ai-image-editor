---
name: makaron
description: "Create or edit media with Makaron when requested or selected; manage project runs and deliver final assets."
---

# Makaron CLI

用户选择 Makaron 创作图片、视频、音乐或动态设计时，优先使用 `makaron chat`。
可以直接用自然语言描述需求，由内部 Agent 匹配 Skill。
需要明确指定入口时使用 `--skill`；内部 Agent 负责读取该 Skill 及依赖、执行制作流程和审核。

## 调用

使用已安装的 `makaron`；不可用时使用 `npx makaron-cli`。复用现有认证，勿输出凭据。
只有需要注册、登录或查询额度时才读取 [setup](references/setup.md)。

```bash
# 自然语言匹配内部 Skill
makaron chat --project auto --json -b "<完整需求>"
# 明确选择内部 Skill
makaron chat --project auto --skill <name> --json -b "<完整需求>"
makaron responses get <runId> --wait --json
```

按素材需要使用可重复的 `--image`、`--video`、`--audio`；文本任务省略附件。
继续修改时使用返回的 `--project <projectId>`，保留同一项目和已知 run。
将用户完整需求、素材角色、预算/重试上限及已授予的审核权限一起传入。
获准自行审核中间环节时明确写入 brief；内部制作和检查要求仍须执行。
详细流程由内部 Skill 负责，外部宿主无需重新编排。

## 需求 → 入口

| 需求 | `--skill` |
| --- | --- |
| 普通图片编辑/生成、音乐、单段视频 | 省略，自动路由 |
| 跨段人物/场景一致的长叙事 | `long-video-director` |
| 按参考片镜头结构精确复刻、替换内容 | `video-edit`，brief 指定 replication |
| 主题、产品或流程讲解 | `explainer-video` |
| 预告片、品牌短片、电影感叙事 | `cinematic-video` |
| 口播清理、字幕、B-roll | `talking-head` |
| 现有视频翻译、配音、本地化 | `video-translate` |
| 用已有素材制作 TikTok/抖音成片 | `tiktok-video` |
| 保留整段表演和时间线，重新制作多机位 | `multi-angle-video` |
| 明确要求先做渐进故事图片，再生成视频 | `photo-to-video` |

需要低成本预检时，可以先用自然语言要求识别流程并停在生成之前：

```bash
makaron chat --project auto --json -b "做30秒中文产品讲解视频。先识别适用 Skill 并给简短计划，在生成图片、视频或音频前停下。"
```

规划预检仍会消耗 Agent 推理；详细制作流程交给内部 Skill。

名称或适用范围不确定时，查询当前服务端目录：

```bash
makaron skills list --built-in
makaron skills search "<需求关键词>" --built-in
makaron skills show <name> --built-in
```

内置 Skill 无需安装。人物锚点、分镜等辅助 Skill 由内部流程按需读取。
市场模板按 [marketplace](references/marketplace.md) 发现与使用。

## 完成与交付

- 已知 run 优先查询/恢复，按 `next_poll_after_ms` 等待，避免重复提交或干扰正在执行的任务。
- 等到用户要求的成品可用；读取 Skill、提交成功、超时或只产出计划均不代表完整交付。
- 需要 MP4 而只有可编辑 composition 时，按 [materialize](references/materialize.md) 完成导出。
- 检查实际可查看/播放的产物，返回成品和项目链接；新付费生成/重试遵守现有预算和授权。
- 在当前对话交付。跨应用或向其他收件人发送需要对应授权。

仅在需要时读取：[项目素材](references/project-media.md)、[状态与响应](references/responses.md)、
[独立工具](references/direct-tools.md)、[内部工作流调用诊断](references/internal-workflows.md)。
模型、参数或能力不确定时查看当前命令 `--help`。仅用户明确选择 Agent LLM 时使用 `--agent-model`。
