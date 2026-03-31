# Makaron Skill 开发指南

Skill 让你为 Makaron 的 AI Agent 添加新能力 — 角色一致性、特定工作流、风格模板等。每个 Skill 是一个 zip 包，包含一个 `SKILL.md` 指令文件和可选的参考图片。

## 快速开始

### 1. 创建 SKILL.md

```yaml
---
name: my-character
description: >
  Generate images featuring My Character, a friendly robot
  with blue eyes and chrome body.
allowed-tools: generate_image analyze_image
metadata:
  makaron:
    icon: "🤖"
    color: "#4A90D9"
    referenceImages:
      - assets/character-sheet.jpg
    tags: [character, robot]
---

# My Character

You are generating images of My Character — a friendly robot with:
- Chrome body with rounded edges
- Glowing blue eyes (always consistent)
- Small antenna on top

When the user asks to generate or edit images, always maintain
character consistency by referencing the character sheet.

## Rules
- Keep the character proportions consistent across all generations
- The blue eye glow is the signature feature — never change it
- Can be placed in any scene or environment
```

### 2. 添加参考图片

```
my-character/
├── SKILL.md
└── assets/
    └── character-sheet.jpg
```

`assets/` 里的图片会自动上传到云端，`SKILL.md` 中的相对路径会被替换为公开 URL。

### 3. 打包为 zip

```bash
cd my-character
zip -r ../my-character.zip SKILL.md assets/
```

### 4. 上传

在 Makaron 项目页点击 `+ Skill` 按钮，选择 zip 文件上传。

---

## SKILL.md 格式

### Frontmatter（YAML 头部）

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 唯一标识符，kebab-case（如 `my-character`） |
| `description` | ✅ | Skill 描述，用于 UI 展示和 Agent 理解 |
| `allowed-tools` | | 允许的工具列表（空格分隔或数组），省略则允许全部 |

#### `metadata.makaron` 扩展字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `icon` | string | Emoji 图标（如 `"🤖"`） |
| `color` | string | 16 进制颜色（如 `"#4A90D9"`），用于 UI pill 高亮 |
| `referenceImages` | string[] | 参考图路径列表（本地用 `assets/xxx`，上传后自动替换为 URL） |
| `tags` | string[] | 标签（如 `[character, brand]`） |
| `tipsEnabled` | boolean | 是否启用 Tips 自动生成（默认 true） |
| `tipsCount` | number | Tips 数量 |
| `modelPreference` | string[] | 推荐模型（如 `[gemini]`） |
| `faceProtection` | string | 人脸保护级别：`strict` / `default` / `none` |
| `defaultAspectRatio` | string | 默认输出比例（如 `"16:9"`） |

### Body（Markdown 指令）

`---` 之后的所有内容是 Skill 的核心指令，会被注入到 Agent 的 system prompt 中。写法自由，支持完整 Markdown 语法。

**最佳实践**：
- 开头用一句话说清楚这个 Skill 做什么
- 用列表描述角色/风格的关键特征
- 用 `## Rules` 章节列出约束条件
- 保持简洁 — Agent 能理解简短明确的指令

---

## 可用工具

Skill 可以通过 `allowed-tools` 限制 Agent 能调用的工具：

| 工具 | 说明 |
|------|------|
| `generate_image` | 生成或编辑图片（img2img / txt2img） |
| `analyze_image` | 分析图片内容（Agent 用视觉能力看图） |
| `generate_animation` | 提交视频脚本渲染（Agent 先在 CUI 写脚本，再调此 tool 提交） |
| `rotate_camera` | 3D 视角旋转 |

示例：只允许生图和分析：
```yaml
allowed-tools: generate_image analyze_image
```

省略 `allowed-tools` = 允许全部工具。

---

## 参考图片

参考图片让 Agent 在生图时保持角色/风格一致性。

### 工作原理

1. `referenceImages` 中的图片会作为 **reference snapshot** 显示在 Editor 的 timeline 左侧（虚线圆点）
2. Agent 通过 `<<<image_N>>>` 自然引用这些图片
3. 调用 `generate_image` 时，参考图自动注入到生图模型

### 在 SKILL.md 中引用

```yaml
metadata:
  makaron:
    referenceImages:
      - assets/character-sheet.jpg
      - assets/style-reference.png
```

上传后 `assets/character-sheet.jpg` 会被自动替换为：
```
https://xxx.supabase.co/storage/v1/object/public/images/{user_id}/skills/my-character/character-sheet.jpg
```

### 建议
- 参考图用高清 JPEG（500KB-2MB）
- Character sheet（多角度/多表情）比单张效果图更好
- 最多 7 张参考图（受生图模型限制）

---

## Zip 打包规范

```
my-skill.zip
├── SKILL.md          ← 必须存在（可以在根目录或子目录）
└── assets/           ← 可选，存放参考图片
    ├── ref-1.jpg
    └── ref-2.png
```

**规则**：
- `SKILL.md` 可以在 zip 根目录或任意子目录中（解析器会自动查找）
- 只有 `assets/` 目录下的文件会被上传到云端
- 支持 `.jpg`、`.jpeg`、`.png` 格式
- 同名 Skill 重新上传会覆盖旧版本

---

## 示例 Skill

### 角色一致性（Character）

```yaml
---
name: pixel-wizard
description: >
  Generate images featuring Pixel Wizard, a cheeky bubble-ghost
  mascot with pixel expressions and a magic wand.
allowed-tools: generate_image analyze_image
metadata:
  makaron:
    icon: "🧙"
    color: "#3D2FBF"
    referenceImages:
      - assets/character-sheet.jpg
    tags: [mascot, character]
---

# Pixel Wizard

Generate images featuring Pixel Wizard — a cheeky, slightly cowardly
bubble-ghost with pixel-art facial expressions and a small magic wand.

The reference image is the official character sheet showing multiple
angles and expressions. Use it to maintain visual consistency.

## Key Features
- Translucent purple/pink bubble body
- Pixel-art eyes and mouth (□ shapes)
- Small wizard hat (dark purple)
- Magic wand with star tip

## Rules
- Always reference the character sheet for consistency
- Expressions can vary but pixel-art style must be maintained
- Can be placed in any scene — photos, illustrations, abstract backgrounds
```

### 工作流（Workflow）

```yaml
---
name: photo-to-video
description: >
  Turn a single photo into a wild video story with 3 acts.
allowed-tools: generate_image analyze_image generate_animation
metadata:
  makaron:
    tipsEnabled: false
    tags: [video, workflow]
---

# Photo-to-Video

1. Analyze the photo
2. Generate 3 progressive images (each more surprising)
3. Write a video script tying them together

## Rules
- Be BOLD. The wilder the better.
- Do NOT ask for confirmation between steps. Just go.
```

---

## API

Skills 也可以通过 API 管理：

```
GET  /api/skills          → 获取所有 skill 列表
POST /api/skills          → 上传 zip（FormData, field: "file"）
DELETE /api/skills        → 删除 skill（body: { name: "xxx" }）
```

需要登录态（Cookie auth）。
