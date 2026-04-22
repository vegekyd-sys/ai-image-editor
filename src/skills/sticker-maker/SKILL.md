---
name: sticker-maker
description: >
  Generate sticker/overlay assets from AI-generated images. Uses generate_image to create elements
  (characters, objects, effects) on clean backgrounds, then removes the background with sharp
  to produce transparent PNG files. Ready to use as overlays in design videos or compositions.
  Activate when user mentions: 贴纸, 素材, 透明底, sticker, overlay, 去背景, 抠图, PNG素材, design素材.
allowed-tools: generate_image analyze_image run_code
metadata:
  makaron:
    icon: "🩹"
    color: "#E040FB"
    tipsEnabled: false
    tags: [sticker, overlay, transparent, png, asset, workflow]
---

# Sticker Maker — 透明底素材生成器

将 AI 生成的图片转换为透明底 PNG 贴纸/素材，可直接用于 design 视频叠加。

## 核心工作流

### Step 1: 生成素材图
用 `generate_image` 生成目标元素。**关键 prompt 要求**：
- 必须指定 **色键绿背景**（"on a solid bright green chroma key background, #00FF00"）
- 绿幕比白底优势：不会误伤素材本身的白色/浅色部分（如高光、白衣服、浅色皮肤），去背景更精准
- 元素要完整、居中、不裁切
- 描述清楚元素的姿势、表情、风格
- 如果有角色参考图，通过 reference_image_indices 传入

**Prompt 模板**：
```
Generate [描述元素] on a solid bright green chroma key background (#00FF00).
The character/object should be centered, complete (no cropping),
with clear edges. [风格要求]. No text, no watermarks, no borders.
```

**备选背景色**（当素材本身含大量绿色时）：
- 品红色键 #FF00FF — 适合绿色/自然元素
- 纯蓝色键 #0000FF — 适合绿色+品红色元素

### Step 2: 去除背景 → 透明 PNG
用 `run_code` + sharp 去除色键绿背景（色彩距离算法 + 边缘抗锯齿 + 溢色修复）

### Step 3: 保存并提供下载
保存到 workspace，返回公开 storageUrl 供 design 视频直接使用

## 使用场景

### A. 为 design 视频生成贴纸素材
### B. 批量生成系列贴纸  
### C. 从现有图片抠图

## 注意事项

- 生成时首选色键绿背景，素材本身有绿色时改用品红/蓝色键
- threshold 参数：绿幕用 50-70，白底用 35-45
- 检查边缘质量：去背景后发布到 timeline 验证
- 在 design 中使用时直接用 storageUrl 作为 Img 的 src
