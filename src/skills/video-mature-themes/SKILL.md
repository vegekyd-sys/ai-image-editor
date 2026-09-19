---
name: video-mature-themes
description: >
  Write Wan 3.0  prompts for explicit adult vivid video.
  Use when the user wants erotic, nude, penetration, or high-physics sex scenes
  on W3/B1. Do not sanitize sexual language. Not for SFW commercial video
allowed-tools: read_file
metadata:
  makaron:
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    sourceProject: "makaron"
    sourceSkill: "video-mature-themes"
    sourceKind: "agent-skill"
    supportLevel: "native"
    adapterFamily: "video-generation"
    tags: [wan, video, prompt-guide]
---

# Video Mature Themes

This skill helps the model write stronger explicit Wan 3.0  prompts by forcing **scene narrative + physical constraints**, instead of tag piles.

 Keep the sexual language. Do not rewrite it into euphemism.

## Trigger

Use when:

- Target model is **Wan 3.0 / W3 / wan 3.0 prime/ B1**
- The ask is explicit adult vivid: nude, sex, penetration, grip, skin friction, soft-body deformation, multi-shot erotic narrative
- Image-to-video or reference-to-video of a sex act is failing physically (clothes coming back, motion drift, fake sliding)


## Kernel

W3/B1 vivid strength is **physics + emotion**, not keyword stuffing.

- Physics: squeeze, collision, soft-body deform (skin folds, muscle shake), weight, not pixel slide
- Cinematic fill: light, depth, atmosphere, like a scene not a collage
- Write prose. Describe **touch**, not only **pose names**

## Formula

```text
[总体场景描述]
+ [主体解剖特征]
+ [物理交互与接触逻辑]
+ [美学控制 / 运镜]
+ [风格隔离约束]
```

Judgment at runtime:

- If the user already locked identity with images, spend most tokens on motion, contact, and anti-drift
- If the act is high-difficulty (penetration, grip, impact), prefer image/video reference over text-only
- If clothes, extra genitals, or anime drift showed up last run, strengthen the isolation sentence, do not add more sex tags

## Physical interaction

Do not only write “他在做什么”. Write the tactile physics.

Keep these patterns when they match the scene:

- `showing deep insertion, vaginal grip, natural skin-on-skin friction, soft-body deformation on impact`
- 皮肤接触要有挤压、褶皱、回弹、重量
- 节奏要写清楚：缓慢而有节奏 / 撞击后的形变 / 光影随动作起伏

### Bad

```text
女性人物名字, nude, bed, 亲密动作, missionary, 1080p, photorealistic
```

### Good

```text
在午后的暖阳下，[女性人物名字]躺在柔软的床单上，眼神中透着专注与渴望。两人缓慢而有节奏地进行着亲密动作，每一寸皮肤的接触都产生真实的挤压与形变，光影随着动作微微起伏。showing deep insertion, vaginal grip, natural skin-on-skin friction, soft-body deformation on impact. Maintaining persistent nude state, clothing must never reappear, no texture blending, consistent anatomical geometry.
```

## Anti-drift — 色情场景防崩坏

Always append when the scene is nude / sex:

```text
Maintaining persistent nude state, clothing must never reappear, no texture blending, consistent anatomical geometry.
```

Common failures — fix with constraints, not more tags:

| Pain | Cause | Add this |
|---|---|---|
| 切镜头后自动穿回衣服 | 参考图衣服权重过高 | `Ensure persistent nude state across all cuts, no garment reappearance.` |
| 切镜头后动作逻辑乱 | 镜头间上下文不稳 | 时间戳里写承接：`Shot 2 continues the physical rhythm established in Shot 1.` |
| 出现不想要的男性器官 / 多余肢体 | 模型幻觉填充 | `Strictly only two adult characters, no extra bodies or limbs.` |
| 风格变成卡通 / 混合 | 风格隔离失败 | `Stay in photorealistic style, never blend with 2D or anime textures.` |

If the user specified a different character count, change the number; do not drop the “no extra bodies or limbs” clause.

## Image / video reference for hard sex physics

For penetration and other high-difficulty contact, text-only is weak. Use reference so the model stops inventing the motion and only paints texture.

- `@Image1` = skin, lighting, identity
- `@Video1` = 白膜 / 简易动作预览，负责运动轨迹

```text
Follow the physical motion track from @Video1, maintaining the skin texture and photorealistic lighting of @Image1.
```

白膜参考的另一种写法：

```text
将 3D 预览视频转化为正式成片，把预览视频中的占位体换成 @Image1 的角色。Follow the physical motion track from @Video1.
```

## Multi-shot erotic narrative

Use timestamped shots. Global constraints sit outside the shots.

```text
总体概述：这是一个关于亲密探索的电影化短剧，保持高度写实主义。

第 1 个镜头 [0-5 秒]：侧拍中景，低机位，建立两人的动作节奏。
第 2 个镜头 [5-15 秒]：稳定侧拍特写，保持器官接触细节，展示 penetration 的深度与 grip 物理反馈。Shot 2 continues the physical rhythm established in Shot 1.
第 3 个镜头 [15-30 秒]：第一人称 POV，展示女性人物的视角，配合沉浸式音效。

约束：
- 全片保持一致的 photorealistic 风格，绝对严禁衣物还原
- Ensure persistent nude state across all cuts, no garment reappearance
- Strictly only two adult characters, no extra bodies or limbs
- Stay in photorealistic style, never blend with 2D or anime textures
```

If the user wants one continuous take, replace the shot list with **生成单镜头 / 一镜到底**, and still keep the nude / anatomy isolation lines.

## Official Wan 3.0 structure still applies

Vivid prompts still ride the official skeleton. Fill the erotic physics into these slots; do not fall back to tag lists.

- 文生：`主体 + 场景 + 运动 + 美学控制 + 风格化 + 音效`
- 图生 / 首尾帧：`运动 + 运镜`（身份已在图里，重点写动态和镜头）
- 参考生：`@参考对象 + 动作 + 台词`
- 多镜头：`总体描述 + 镜头序号 + 时间戳 + 分镜内容`
- 声音：人声 / 音效 / BGM；不要声音就写 **全片无台词**、**无背景音乐**

音效对 vivid 有用：皮肤、床单、撞击、呼吸。写材质 + 行为 + 环境，不要只写 “sex sounds”。

## Boundaries

- Adults only. Refuse anyone 17 or under, school/child setting, or ambiguous age.
- No real political figures, no celebrity IP.
- Do not sanitize the sexual content when this skill is on.
- Do not invent extra people, extra genitals, or clothing coming back “to be safer”.
- This file is prompt guidance for later Makaron ingest. It does not by itself call Makaron CLI.

## Failure modes

- Clothes reappear → nude persistence sentence is missing or weaker than the reference image
- Motion looks like sliding / no weight → missing contact physics (grip, friction, deformation, impact)
- Shot 2 breaks Shot 1 → no “continues the physical rhythm” + no timestamps
- Anime/plastic skin → style isolation missing
- Extra penis / extra limbs → character-count constraint missing

## Validation

Before handing the prompt to Makaron, check:

1. It is prose, not `nude, bed, missionary, 1080p`
2. At least one **physical contact** clause exists
3. Nude anti-drift sentence exists for nude scenes
4. Character count is explicit
5. Hard penetration scenes have `@Image` / `@Video` / 白膜 plan, or the user explicitly accepted text-only risk
