---
name: video-design
description: >
  Design mode video creation — cinematic animated compositions using Remotion.
  Makes photos come alive with motion, emotion, and storytelling.
allowed-tools: run_code analyze_image
metadata:
  makaron:
    icon: "🎬"
    color: "#8B5CF6"
    tags: [video, animation, remotion, design, cinematic]
    tipsEnabled: false
---

# Video Design

目标：做出让人 WOW 的视频。

## 四问自检（Plan 阶段回答，Code 阶段实现，Verify 阶段验收）

**Q1：剪辑方式是素材决定的吗？**
看这组素材的内容、情绪、节奏——它们自然地暗示了什么样的剪辑方式？
说不清为什么选这个剪辑方式 = 太通用 = 不通过。
→ Plan：写出"为什么选这种剪辑"（一句话）
→ Code：动画类型、时长分配必须匹配

**Q2：这是视频还是网页？**
全屏图片为主体。没有按钮、没有白色底、没有卡片布局、没有 UI 元素。
截图看起来像网页 = 不通过。
→ Code：AbsoluteFill + 全屏，禁止白底/卡片/圆角容器

**Q3：每个动画动作有情绪吗？**
每个镜头运动、每个转场、每个文字出现都要传达一种情绪。
动画只是"动了一下"没有情绪 = 不通过。
→ Code：动画参数（速度/方向/缓动）全部匹配情绪

**Q4：把文字去掉，画面会不会少了什么？**
花字是画面构图的一部分——占屏幕 1/3 以上、粗到不可能忽略、带描边阴影渐变、弹入缩放抖动。
文字小而优雅 = 字幕条不是花字。去掉文字画面没变化 = 不通过。
→ Code：fontSize ≥ 64, fontWeight ≥ 800, textShadow 必须有, 入场动效必须有

**Q4 补充：花字写什么？**
花字文案必须从画面内容中来——是对画面的回应、放大、点睛。
"那年夏天"、"memories"、"生活记录" = 万能文案 = 放到任何视频都行 = 不通过。
看到画面里有什么，写出只属于这组照片的文字。
花字和画面的关系：看到文字就能猜到画面是什么，看到画面就觉得这句话说得对。

## 工作流

### Phase 1 — Plan（编码蓝图）

在写代码之前，先输出结构化规划。用户实时看到 streaming。

用观众看得懂的语言描述画面，但要具体到写代码时知道该怎么实现。

格式（手机友好——不用表格）：
```
## 视频规划

**剪辑理由** (Q1): 一句话

**画布**: 1080×1920 竖版 | **时长**: Ns

Scene 1 (0-3s): <<<image_1>>> Brooklyn Bridge 砖楼长廊
- 横图，上方展示完整画面，下方模糊背景透出
- 缓慢向右推镜，画面微微放大
- 花字: "桥那头是曼哈顿" 大字，底部居中，逐字弹射入场
- 淡出过渡到下一场

Scene 2 (3-7s): <<<image_2>>> DUMBO 街头女生街拍
- 竖图全屏，人物居上
- 慢慢推近，画面微微偏暖
- 花字: "DUMBO的风" / "永远在吹" 两行从左右交替飞入
- 叠加金色暖光氛围层
```

每个 Scene 写清楚：画面怎么放、怎么动、花字写什么 + 怎么出现、怎么过渡到下一场。

时长：12-25 秒（3 张图 → 12-15s, 5 张 → 15-20s, 7 张 → 20-25s）

### Phase 2 — Code

一次 `run_code`（render）写完全部场景。写代码前先说 1-2 句。完成后保存到 workspace。

可以随时 patch 迭代——修问题、调动画、改文字。

### Phase 3 — Verify（批量 preview_frame）

一次 turn 内调用多个 preview_frame（开头、转场点、结尾）。

## Composition Patterns（参考库，自由组合）

理解原理后自由组合变形。四问驱动创意，patterns 降低编码门槛。

## 跨平台动效规则（iOS / Android / Web 通用）

所有动效必须在三端正常渲染：

- **Blur**：`overflow: hidden` 容器 + 图片放大 20% + `translate3d(0,0,0)` GPU 加速。blur ≤ 30px
- **Transform 动画**：只用 `transform`（scale/translate/rotate），不动 top/left/width/height
- **clip-path**：用 `polygon()`，不用 `path()`。顶点 ≤ 8 个
- **filter**：brightness/saturate/hue-rotate 都安全。同一元素不超过 3 个 filter
- **渐变氛围层**：用独立 div + `mix-blend-mode`，不叠在图片 background 上
- **阴影**：花字用 `textShadow`（不用 `filter: drop-shadow`）。animated 元素 box-shadow blur ≤ 60px
- **字体**：用知名字体 + fallback（`"Noto Sans SC", sans-serif`）

### 横图短视频模式 + 模糊背景

背景跟主图联动呼吸。图片居上方，下方模糊背景 + 花字区。遵守上方 Blur 规则。

### 电影感 Parallax 多层

三层不同速度 = 真实景深（远景图片慢、中景光晕中、近景花字快）。

### 碎裂转场

clip-path 多边形遮罩动画，多个不规则多边形组合 = 碎片效果。

### 色彩情绪转场

hue-rotate + saturate 动画 + mix-blend-mode overlay 渐变。场景间颜色"流动"。

### Kinetic Typography

花字不是"显示文字"——是文字在运动中讲故事：
- 逐字弹射 + 旋转入场（冲击感）
- 弹幕式分行飞入（多行从不同方向涌入）
- 缩放呼吸 + 颜色脉冲（节拍强调）

原则：每字独立运动、字体占屏 1/3、夸张到无法忽视、截图都好看。

## Editable（必须的）

每个 video design 必须包含：
1. `data-editable` 属性在关键文字元素上
2. 文字内容从 props 读取，不硬编码
3. return 值中包含 editables 数组

**能选中**：`data-editable` 放在文字所在的 div 上。逐字动画时放在包裹所有字符的父 div 上。

**帧感知**：花字在该出现的时候再渲染，不要 frame 0 全部显示。
