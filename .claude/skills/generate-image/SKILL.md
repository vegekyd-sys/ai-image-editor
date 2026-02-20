---
name: generate-image
description: Generate or edit an image using Gemini 3 via OpenRouter
allowed-tools: Bash, Read, Glob
---

# Generate Image — Gemini 3 via OpenRouter

调用 `scripts/generate-image.mjs`，通过 OpenRouter 使用 `gemini-3-pro-image-preview` 生成或编辑图片。

## 流程

1. 解析 `$ARGUMENTS`，提取 prompt、可选的输入图片路径、输出文件名等
2. 运行命令：

```
node scripts/generate-image.mjs <prompt> [--input <path>] [--output <filename>] [--aspect <ratio>]
```

3. 命令完成后：
   - 告知用户图片已保存到的路径
   - 如果模型返回了文字描述，一并展示

## 参数解析规则

从 `$ARGUMENTS` 中识别：

- **prompt**：不带 `--` 前缀的文字，即为生成提示词
- `--input <path>`：输入图片路径，**可重复多次**传入多张图（支持相对路径，相对于项目根目录）
- `--output <file>`：输出文件名（默认自动按时间戳命名，保存到 `generated-images/`）
- `--aspect <ratio>`：宽高比，如 `16:9`、`1:1`、`4:3`

## 示例

用户说"生成一张日落海边的图片"：
```
node scripts/generate-image.mjs "a beautiful sunset over the ocean, photorealistic"
```

用户说"把这张图变成油画风格 --input uploads/photo.jpg"：
```
node scripts/generate-image.mjs "transform this photo into oil painting style" --input uploads/photo.jpg
```

用户说"把这两张图合成一张 --input a.jpg --input b.png"：
```
node scripts/generate-image.mjs "merge these two images into one scene" --input a.jpg --input b.png
```

用户说"生成一张 16:9 的科技感背景"：
```
node scripts/generate-image.mjs "futuristic tech background, dark blue tones, glowing circuits" --aspect 16:9
```

## 注意

- 需要 `OPENROUTER_API_KEY` 在 `.env.local` 中配置
- 输出默认保存到 `generated-images/` 目录
- 生成图片通常需要几秒到十几秒，等待即可
