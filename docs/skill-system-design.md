# Makaron Skill System — 产品设计文档

> Version: 0.1 Draft | Date: 2026-03-30

## 1. 概述

### 什么是 Skill

Skill 是 Makaron Agent 的 **App**。每个 Skill 是一组打包在一起的指令、参考素材和配置，让 Agent 获得某个领域的专业能力。

用户上传一张照片，激活的 Skills 会在 Tips Bar 生成对应分类的建议卡片；在 CUI 里，Agent 根据用户意图自动选择合适的 Skill 执行。

### 设计原则

1. **兼容 AgentSkills 开放标准**（agentskills.io）— SKILL.md 格式，Claude Code / OpenClaw / Cursor 等 30+ 产品通用
2. **Makaron 扩展通过 `metadata.makaron`** — 跟 OpenClaw 的 `metadata.openclaw` 同样的模式，不污染标准字段
3. **Skill 输出到生态** — Makaron Skill 可发布到 ClawHub，外部通过 Makaron MCP Server 调用
4. **对话式创建** — 用户在 CUI 里跟 Agent 对话创建 Skill，不需要写代码

---

## 2. Skill 定义格式

### 2.1 目录结构（AgentSkills 标准）

```
skill-name/
  SKILL.md              # 必需：YAML frontmatter + markdown 指令
  assets/               # 可选：参考图、模板等
    ref-1.jpg
    ref-2.jpg
  scripts/              # 可选：可执行脚本（未来）
  references/           # 可选：额外文档（未来）
```

### 2.2 SKILL.md 完整格式

```markdown
---
# ─── AgentSkills 标准字段 ───
name: mascot-xiaohuo                    # 必需，1-64字符，小写+连字符
description: >                          # 必需，≤1024字符
  Generate images featuring XiaoHuo mascot in various scenes and poses.
  Use when user wants to create mascot content or brand materials.
allowed-tools: generate_image analyze_image   # 可选，空格分隔

# ─── Makaron 扩展 ───
metadata:
  makaron:
    # 展示
    icon: "🔥"                          # Tips Bar 分类 icon
    color: "#FF6B35"                    # 主题色（Tips Bar tab 高亮色）

    # Tips 生成
    tipsCount: 2                        # 每次生成几个 tips（默认 2）
    tipsEnabled: true                   # 是否在 Tips Bar 显示分类（默认 true）

    # 模型
    modelPreference: [pony, gemini]     # 优先模型链（覆盖默认路由）

    # 参考图
    referenceImages:                    # assets/ 下的参考图路径
      - assets/ref-1.jpg
      - assets/ref-2.jpg

    # 约束
    faceProtection: none                # strict | default | none
    defaultAspectRatio: "1:1"           # 默认输出比例

    # 元信息
    builtIn: false                      # 预置 skill 不可删除
    tags: [mascot, character, brand]    # marketplace 分类标签
---

# XiaoHuo Mascot

You are generating images of XiaoHuo (小火), a cute fire-themed mascot character.

## Character Definition
- Species: Stylized flame creature with big round eyes
- Color palette: Orange #FF6B35 → Red #E63946 gradient body, yellow-white flame tip
- Personality: Energetic, curious, slightly mischievous
- Style: Anime/chibi

## Reference Images
Reference images show XiaoHuo from multiple angles. ALWAYS maintain:
- Exact color palette
- Eye shape and size ratio
- Flame tip shape on head

## Generation Rules
1. Place XiaoHuo naturally in the user's photo scene
2. Match lighting and perspective of the original photo
3. XiaoHuo should interact with scene elements (sitting, peeking, sleeping)
4. Size: 15-30% of frame — prominent but not overwhelming
5. Style must be consistent across generations

## Tips Generation Guidelines
When generating tips for this skill:
- Each tip places XiaoHuo in a different pose/interaction with the scene
- Vary poses: sitting, standing, peeking, sleeping, excited, eating
- editPrompt must describe the character: "XiaoHuo character (orange-red flame creature with big round eyes, see reference images)..."
- Consider scene context: food photo → XiaoHuo eating; outdoor → XiaoHuo exploring
```

### 2.3 字段说明

#### AgentSkills 标准字段

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | ✅ | 唯一 ID，小写+连字符，≤64 字符，必须与目录名一致 |
| `description` | ✅ | 功能描述 + 使用时机，≤1024 字符。Agent 靠此判断何时激活 Skill |
| `allowed-tools` | - | Skill 可使用的工具白名单（空格分隔） |
| `license` | - | 许可证 |
| `compatibility` | - | 环境要求 |
| `metadata` | - | 扩展字段（Makaron 用 `metadata.makaron`） |

#### Makaron 扩展字段（`metadata.makaron`）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `icon` | 首字母 | Tips Bar 分类 icon（emoji 或 image URL） |
| `color` | fuchsia | 主题色，用于 Tips Bar tab 高亮 |
| `tipsCount` | 2 | 每次生成几个 tips |
| `tipsEnabled` | true | 是否在 Tips Bar 显示为独立分类 |
| `modelPreference` | [] | 优先模型链，覆盖 model-router 默认路由 |
| `referenceImages` | [] | 参考图路径（相对于 SKILL.md） |
| `faceProtection` | default | 人脸保护级别：`strict`（enhance 级）/ `default` / `none` |
| `defaultAspectRatio` | null | 默认输出比例 |
| `builtIn` | false | 预置 skill 标记 |
| `tags` | [] | 分类标签 |

---

## 3. 预置 Skills（v1）

### 3.1 迁移现有分类

现有 4 个硬编码分类迁移为标准 Skill：

| 现有 | 迁移为 | 变化 |
|------|--------|------|
| `src/lib/prompts/enhance.md` | `src/skills/enhance/SKILL.md` | 加 frontmatter，内容不变 |
| `src/lib/prompts/creative.md` | `src/skills/creative/SKILL.md` | 同上 |
| `src/lib/prompts/wild.md` | `src/skills/wild/SKILL.md` | 同上 |
| `src/lib/prompts/captions.md` | `src/skills/captions/SKILL.md` | 同上 |

迁移后的 enhance 示例：

```yaml
---
name: enhance
description: >
  Professional photo enhancement — cinematic lighting, color grading,
  depth separation, weather transformation, scene cleanup.
  Use for retouching and visual quality improvement.
allowed-tools: generate_image
metadata:
  makaron:
    icon: "✨"
    color: "#f0abfc"
    tipsCount: 2
    modelPreference: [qwen, gemini]
    faceProtection: strict
    builtIn: true
---
# (现有 enhance.md 全部内容)
```

### 3.2 新增预置 Skills

#### Makaron Mascot

品牌 IP 角色生成，展示 Skill 系统能力。

```
src/skills/makaron-mascot/
  SKILL.md
  assets/
    mascot-front.jpg
    mascot-side.jpg
    mascot-expressions.jpg
```

#### Versa Company Preset

Versa 公司品牌素材生成（具体内容待补充：品牌色、logo、设计规范等）。

```
src/skills/versa-brand/
  SKILL.md
  assets/
    logo.png
    brand-guide.jpg
```

---

## 4. Tips Bar 集成

### 4.1 动态分类

当前 Tips Bar 硬编码 4 个 tab（enhance / creative / wild / caption）。改为动态：

```
激活的 Skills → 每个 tipsEnabled=true 的 Skill → Tips Bar 中一个 tab
```

显示顺序：
1. 预置 skill（builtIn=true）按固定顺序
2. 用户 skill 按激活顺序

示例（用户激活了 mascot skill）：

```
[ Enhance | Creative | Wild | Caption | 🔥 XiaoHuo ]
```

### 4.2 Tips 生成流程变化

现有流程：
```
上传图片 → 并发跑 3 个分类 × 2 tips = 6 tips
```

新流程：
```
上传图片 → 并发跑 N 个激活 Skill × tipsCount tips
```

每个 Skill 的 tips 生成独立：
1. 加载 SKILL.md body 作为 system prompt
2. 注入 Skill 的参考图（如果有）
3. 生成 tipsCount 个 Tip 对象
4. Tip 的 `category` = Skill 的 `name`

### 4.3 Tip 类型变化

```typescript
// 现有
category: 'enhance' | 'creative' | 'wild' | 'captions';

// 改为
category: string;  // = skill.name（动态）
```

### 4.4 预览和 Commit 流程

不变。点击 tip → preview（调 generate_image）→ 点击 commit → 新 snapshot。Skill 的 `modelPreference` 和 `referenceImages` 自动注入生图请求。

---

## 5. Agent 集成

### 5.1 Skill 路由

Agent 当前在 `agent.md` 里有硬编码的路由表。改为动态：

```
用户消息 → Agent 读取所有激活 Skill 的 name + description
         → 根据 description 判断用哪个 Skill
         → 调 generate_image(skill='{name}', editPrompt=...)
```

Agent system prompt 动态注入可用 Skills 列表：

```markdown
## Available Skills
{{#each activeSkills}}
- **{{name}}**: {{description}}
{{/each}}

When generating images, set `skill` parameter to the most relevant skill name.
```

### 5.2 generate_image 工具改造

```typescript
// 现有
skill: z.enum(['enhance','creative','wild','captions']).optional()

// 改为
skill: z.string().optional()  // 任意已注册的 skill name
```

### 5.3 editImage() 改造

```typescript
// 现有：硬编码 4 个模板
const prompts = skillPrompts ?? loadSkillPromptsFromDisk();
const skillTemplate = skill ? prompts[skill] : null;

// 改为：从 SkillRegistry 加载
const skillDef = await skillRegistry.get(skill);
const skillTemplate = skillDef?.template ?? null;
const modelPref = skillDef?.metadata.makaron.modelPreference;
const refImages = skillDef?.referenceImages;  // 已解析为 URL
```

---

## 6. 用户自建 Skill（CUI 对话式创建）

### 6.1 创建流程

```
用户: 我想创建一个 skill
Agent: 好的！告诉我几个关键信息：
  1. 这个 Skill 叫什么？做什么用？
  2. 有参考图吗？（角色设定、品牌素材、风格参考等）
  3. 生图时有什么特别要求？（风格、模型偏好、比例等）

用户: 叫"小火表情包"，二次元风格
      [上传 3 张参考图]
      主要做方图

Agent: 我来创建这个 Skill：

  📝 名称: xiaohuo-emoji
  📖 描述: 二次元风格小火角色表情包生成
  🎨 模型: Pony（二次元优化）
  📐 比例: 1:1
  🖼️ 参考图: 3 张已保存

  我还会根据你的参考图写一份角色描述，确保每次生图风格一致。
  [生成 SKILL.md 内容]

  ✅ Skill "小火表情包" 已创建！
  现在上传一张图片，我会用这个 Skill 给你出 tips。
```

### 6.2 Agent Tool：create_skill

```typescript
create_skill: tool({
  description: 'Create a new custom skill for the user',
  inputSchema: z.object({
    name: z.string(),           // skill ID (lowercase, hyphens)
    displayName: z.string(),    // 显示名称
    description: z.string(),    // 功能描述
    instructions: z.string(),   // SKILL.md body（markdown 指令）
    icon: z.string().optional(),
    color: z.string().optional(),
    modelPreference: z.array(z.string()).optional(),
    defaultAspectRatio: z.string().optional(),
    faceProtection: z.enum(['strict','default','none']).optional(),
    referenceImageIndices: z.array(z.number()).optional(), // 对话中上传的图片索引
  }),
  execute: async (input) => {
    // 1. 组装 SKILL.md 内容（frontmatter + body）
    // 2. 上传参考图到 Supabase Storage
    // 3. 保存 skill 记录到 user_skills 表
    // 4. 注册到当前 session 的 SkillRegistry
    // 5. 返回确认信息
  }
})
```

### 6.3 Skill 编辑和删除

在 CUI 里自然语言操作：

```
用户: 把小火 skill 的模型改成 gemini
Agent: ✅ 已更新 xiaohuo-emoji 的模型偏好为 gemini

用户: 删掉这个 skill
Agent: 确认删除 "小火表情包" skill？这不可恢复。
用户: 确认
Agent: ✅ 已删除
```

---

## 7. 数据模型

### 7.1 数据库：user_skills 表

```sql
CREATE TABLE user_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,                    -- skill ID (unique per user)
  display_name text NOT NULL,            -- 显示名称
  skill_md text NOT NULL,                -- 完整 SKILL.md 内容（frontmatter + body）
  reference_image_urls text[],           -- Supabase Storage URLs
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id, name)
);

ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own skills"
  ON user_skills FOR ALL
  USING (auth.uid() = user_id);
```

### 7.2 Storage 结构

```
images/
  {userId}/
    skills/
      {skillName}/
        ref-1.jpg
        ref-2.jpg
```

### 7.3 SkillRegistry（运行时）

```typescript
interface ParsedSkill {
  // AgentSkills 标准
  name: string;
  description: string;
  allowedTools?: string[];

  // Makaron 扩展
  makaron: {
    icon: string;
    color: string;
    tipsCount: number;
    tipsEnabled: boolean;
    modelPreference: ModelId[];
    referenceImageUrls: string[];
    faceProtection: 'strict' | 'default' | 'none';
    defaultAspectRatio?: string;
    builtIn: boolean;
    tags: string[];
  };

  // 解析后的内容
  template: string;          // SKILL.md body（markdown 指令部分）
}

class SkillRegistry {
  private builtIn: Map<string, ParsedSkill>;   // 预置 skill（从文件系统）
  private userSkills: Map<string, ParsedSkill>; // 用户 skill（从 DB）

  async loadBuiltIn(): Promise<void>;           // 启动时加载 src/skills/*/SKILL.md
  async loadUserSkills(userId: string): Promise<void>;  // 登录后加载
  get(name: string): ParsedSkill | undefined;
  getActive(): ParsedSkill[];                   // 所有激活的 skill
  getCategoryConfigs(): CategoryConfig[];       // 动态生成 Tips Bar 配置
}
```

---

## 8. 项目级 Skill 激活

每个项目可以选择激活哪些 Skill（而非账号级别全局生效）。

### 8.1 UI

项目编辑器内，Tips Bar 左侧或长按分类名弹出 Skill 管理面板：

```
┌─────────────────────────────┐
│ Active Skills               │
│ ✅ Enhance (built-in)       │
│ ✅ Creative (built-in)      │
│ ✅ Wild (built-in)          │
│ ☐  Caption (built-in)      │
│ ✅ 🔥 小火表情包             │
│                             │
│ [+ Create New Skill]        │
└─────────────────────────────┘
```

### 8.2 数据模型

```sql
-- projects 表新增字段
ALTER TABLE projects
  ADD COLUMN active_skills text[] DEFAULT '{enhance,creative,wild}';
```

默认激活 enhance + creative + wild（与当前行为一致）。

---

## 9. 代码改造清单

### Phase 1：格式迁移（不改功能）

| 改动 | 说明 |
|------|------|
| 创建 `src/skills/` 目录 | 预置 skill 的家 |
| 迁移 4 个 `.md` → `SKILL.md` | 加 frontmatter，内容不变 |
| 新建 `src/lib/skill-registry.ts` | 解析 SKILL.md，管理 skill 生命周期 |
| 改造 `src/lib/categories.ts` | 从硬编码改为 SkillRegistry 驱动 |
| 改造 `src/types/index.ts` | `Tip.category` 从 enum 改为 string |

### Phase 2：动态 Skill 支持

| 改动 | 说明 |
|------|------|
| 改造 `edit-image.ts` | 从 SkillRegistry 加载模板，注入参考图 |
| 改造 `agent.ts` | `skill` 参数改 string，动态注入可用 skill 列表 |
| 改造 `TipsBar.tsx` | 动态渲染分类 tab |
| 改造 tips 生成 | 每个 Skill 独立生成 tips |
| 改造 `model-router.ts` | 接受 `modelPreference` 覆盖 |

### Phase 3：用户自建

| 改动 | 说明 |
|------|------|
| DB migration | `user_skills` 表 |
| `create_skill` Agent tool | CUI 创建 skill |
| Skill 管理 UI | 激活/停用/删除 |
| `projects.active_skills` | 项目级 skill 选择 |

### Phase 4：生态输出（未来）

| 改动 | 说明 |
|------|------|
| MCP skill 接口 | 外部可查询/使用 Makaron skill |
| ClawHub 发布 | 标准格式直接上传 |
| Skill 导入 | 从 URL 或 ClawHub 导入 |

---

## 10. MCP 关系

### v1：Skill 不含 MCP

Skill = SKILL.md + assets。使用平台已有工具（`generate_image` 等）。

### v2：Skill 声明工具依赖

`allowed-tools` 限定 Skill 可调用的工具范围，但工具本身由平台提供。

### v3：Skill 自带 MCP Server（= Plugin）

参考 Claude Code Plugin 格式，Skill 可捆绑自己的 MCP Server：

```
advanced-retouching/
  SKILL.md
  .mcp.json              ← 自带工具端点
  assets/
```

此时 Skill 升级为 Plugin。Makaron 作为宿主加载 MCP Server，Skill 指令引用自带工具。

---

## 11. 外部兼容性

### Makaron Skill → 外部使用

Makaron Skill 遵循 AgentSkills 标准，可直接在以下环境使用：

```
Claude Code / OpenClaw / Cursor / Gemini CLI
  └── 安装 Makaron MCP Server（已有 makaron.app/api/mcp）
  └── 安装 Makaron Skill（标准 SKILL.md 格式）
  └── /mascot-xiaohuo "画个小火在咖啡店" → 通过 MCP 调 Makaron 生图
```

### 外部 Skill → Makaron 使用

**格式兼容**（SKILL.md 可解析），**运行时受限**（外部 Skill 引用的工具必须 Makaron 平台有）。

实际有用的场景：如果某个 ClawHub 上的 Skill 只用 `generate_image` 工具 + prompt 指令，Makaron 可以直接跑。

---

## 12. 预置 Skill 详细设计

### 12.1 Makaron Mascot

**目标**：展示 Skill 系统能力的标杆 Skill。

```yaml
name: makaron-mascot
description: >
  Generate images featuring the Makaron mascot character.
  A playful macaroon-inspired character that can be placed in any photo scene.
metadata:
  makaron:
    icon: "🍪"
    color: "#FF69B4"
    tipsCount: 2
    modelPreference: [gemini]
    faceProtection: none
    builtIn: true
    tags: [mascot, character, brand]
```

需要准备：Makaron mascot 角色设定图 3-5 张（不同角度/表情）。

### 12.2 Versa Brand

**目标**：公司品牌素材生成。

```yaml
name: versa-brand
description: >
  Generate on-brand visuals for Versa company.
  Applies Versa brand guidelines including colors, typography style, and visual tone.
metadata:
  makaron:
    icon: "🏢"
    color: "#0066FF"
    tipsCount: 2
    modelPreference: [gemini]
    faceProtection: default
    builtIn: true
    tags: [brand, corporate]
```

需要准备：Versa 品牌规范（品牌色、logo、设计风格参考图）。

---

## 13. 开放问题

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | Skill 数量上限？ | Tips 并发生成数、UI tab 溢出 | 建议每项目最多 6 个激活 Skill（3 built-in + 3 custom） |
| 2 | 参考图数量上限？ | API token 消耗、请求体积 | 建议每 Skill 最多 5 张参考图 |
| 3 | 工作流 Skill（如电商视频）如何生成 tips？ | 可能不适合单图 tips 模式 | 可设 `tipsEnabled: false`，只在 CUI 里通过 Agent 使用 |
| 4 | Skill 版本管理？ | 用户更新 Skill 后旧项目的 tips 对不上 | v1 不做版本管理，tips 里存的是 editPrompt 快照 |
| 5 | Skill 模板质量？ | 用户写的指令可能很差 | Agent 创建时帮忙补充完善，提供模板框架 |
| 6 | 计费？ | 参考图消耗更多 token | v1 不单独计费，后续按 Skill 使用量计 |
