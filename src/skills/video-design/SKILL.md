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

## 工作流

### 阶段 1：规划脚本
基于已有的图片分析（对话上文或 `[图片分析结果]`），梳理照片内容、情绪、节奏，写出分镜脚本。每个 shot 标注时长和情绪。
**不要重复调用 analyze_image**——如果上文已经分析过，直接用那些信息。
用四问自检验证脚本，通过后给用户确认。用户可以修改。

### 阶段 2：编程渲染
根据确认的脚本用 `run_code` 创建 Remotion 动画。

## 四问自检（脚本必须全部通过）

**Q1：剪辑方式是素材决定的吗？**
看这组素材的内容、情绪、节奏——它们自然地暗示了什么样的剪辑方式？
说不清为什么选这个剪辑方式 = 太通用 = 不通过。

**Q2：这是视频还是网页？**
全屏图片为主体。没有按钮、没有白色底、没有卡片布局、没有 UI 元素。
截图看起来像网页 = 不通过。

**Q3：每个动画动作有情绪吗？**
每个镜头运动、每个转场、每个文字出现都要传达一种情绪。
如果动画只是"动了一下"没有情绪 = 不通过。

**Q4：把文字去掉，画面会不会少了什么？**
想想抖音/Reels 里那些爆款短视频的花字——占屏幕 1/3 以上、粗到不可能忽略、带描边阴影渐变、弹入缩放抖动，文字本身就是视觉主角。
花字是画面构图的一部分——去掉它，画面的冲击力会塌。字体要大到"第一眼就看到文字"，动效要夸张到"忍不住看完"，装饰要重到"截图都好看"。
文字小而优雅 = 字幕条不是花字。去掉文字画面没变化 = 不通过。
