# Makaron MCP Server

Makaron 的 AI 图片编辑和视频生成能力通过 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 对外暴露，任何支持 MCP 的 agent 或项目都可以接入。

## 可用 Tools

**图片编辑（2 个）：**
- `makaron_edit_image` — AI 图片编辑/生成
- `makaron_rotate_camera` — 3D 视角旋转

**视频生成（3 个）：**
- `makaron_write_video_script` — 根据图片生成视频脚本
- `makaron_create_video` — 提交视频渲染任务
- `makaron_get_video_status` — 查询视频任务状态

### `makaron_edit_image`

AI 图片编辑/生成。支持 4 种 skill 模板。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | | 输入图片：本地文件路径（stdio 模式）、URL、或 base64 data URL。省略则为文生图模式 |
| `editPrompt` | string | ✅ | 英文编辑指令 |
| `skill` | string | | `enhance` / `creative` / `wild` / `captions` |
| `model` | string | | 指定生图模型：`gemini`（默认）/ `qwen` / `pony` / `wai`，见下方说明 |
| `originalImage` | string | | 原图（人脸修复参考） |
| `referenceImages` | string[] | | 参考图数组（最多 3 张） |
| `useOriginalAsReference` | boolean | | 是否用原图做参考 |
| `aspectRatio` | string | | 目标比例，如 `"4:5"` |

**Skill 说明：**
- `enhance` — 专业增强（电影感光影、色彩分级、景深）
- `creative` — 添加与场景有因果关系的趣味元素
- `wild` — 夸张变形画面中已有的物品
- `captions` — 添加写实风格的文字叠加

**Model 说明：**
- `gemini`（默认）— Gemini Flash，img2img + txt2img + 多参考图，质量最稳定
- `qwen` — Qwen Edit via ComfyUI，img2img + txt2img，enhance 类推荐，Gemini 内容审核拒绝时可用 qwen 重试
- `pony` — Pony SDXL via ComfyUI，**仅 txt2img**（无输入图片的纯文生图，anime 风格）
- `wai` — WAI-Illustrious SDXL via ComfyUI，**仅 txt2img**（illustrious 风格）

**Skill → Model 路由（MCP 层自动处理）：**

| 场景 | skill | model | MCP 内部行为 |
|------|-------|-------|-------------|
| 美化/增强/调色/通透感 | `enhance` | 自动 | model-router 已 enhance 优先 qwen |
| 加创意元素（趣味物件） | `creative` | 自动 | 强制 gemini + skill；失败→qwen 无 skill 重试 |
| 夸张变形/脑洞大开 | `wild` | 自动 | 强制 gemini + skill；失败→qwen 无 skill 重试 |
| 加文字/字幕/标题 | `captions` | 自动 | 强制 gemini + skill；失败→qwen 无 skill 重试 |
| 文生图（所有风格含二次元） | 省略 | 省略 | gemini→qwen 自动 fallback，默认即可 |
| 用户指定 pony/wai | 省略 | `pony`/`wai` | 仅用户主动说"用pony"时才传，仅 txt2img |
| NSFW/敏感内容编辑 | 省略 | `qwen` | Gemini 会拒绝，直接指定 qwen |
| 不确定 | 省略 | 省略 | 自动路由 + fallback |

**为什么 creative/wild/captions 强制走 gemini？** 这些 skill 会注入结构化 `.md` 模板指导 AI 生图。Qwen 无法消化中文 `.md` 模板（除 enhance 外效果极差），所以 MCP 层强制先走 gemini。如果 gemini 失败（如内容审核拒绝），则去掉 skill 用 qwen 的干净 editPrompt 重试。

显式指定 `model` 参数时，MCP 不做强制路由，直接用指定模型。

### `makaron_rotate_camera`

3D 视角旋转，用 AI 生成不同角度的照片。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | ✅ | 输入图片：本地文件路径、URL、或 base64 data URL |
| `azimuth` | number | ✅ | 水平旋转 0-360°（0=正面, 90=右侧, 180=背面, 270=左侧） |
| `elevation` | number | ✅ | 俯仰角 -30~60°（0=平视, 60=俯视） |
| `distance` | number | ✅ | 距离 0.6~1.4（0.6=特写, 1.0=中景, 1.4=远景） |

### `makaron_write_video_script`

根据 1-7 张图片生成视频脚本。调用 Claude Sonnet 分析图片并写出 Shot-by-shot 格式的视频脚本，可直接用于 `makaron_create_video`。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `images` | string[] | ✅ | 1-7 张图片（URL 或 base64 data URL） |
| `userRequest` | string | | 可选的风格/主题/故事方向（如 "cinematic urban transformation story"） |
| `language` | string | | 脚本语言：`'en'` 或 `'zh'`（默认 `'en'`） |

**返回：**
- 标题（第一行，2-5 词）
- Shot-by-shot 脚本（含 `<<<image_N>>>` 引用）
- 预估时长

**示例：**
```ts
const result = await client.callTool({
  name: 'makaron_write_video_script',
  arguments: {
    images: [
      'https://example.com/photo1.jpg',
      'https://example.com/photo2.jpg',
      'https://example.com/photo3.jpg',
    ],
    userRequest: 'Create a cinematic transformation story',
    language: 'en',
  },
});
```

### `makaron_create_video`

提交视频渲染任务。**重要：images 必须是公开可访问的 URL**（不支持 base64）。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `script` | string | ✅ | 视频脚本（Kling 格式，含 `<<<image_N>>>` 引用） |
| `images` | string[] | ✅ | 1-7 张图片的公开 URL（必须 https://） |
| `duration` | number | | 时长：3/5/7/10/15 秒。省略=智能模式（API 自动决定） |
| `aspectRatio` | string | | 宽高比：`"9:16"` / `"16:9"` / `"1:1"` |

**返回：**
- 文本包含 Task ID，用于后续轮询状态

**示例：**
```ts
const result = await client.callTool({
  name: 'makaron_create_video',
  arguments: {
    script: scriptFromPreviousStep,
    images: [
      'https://storage.example.com/img1.jpg',
      'https://storage.example.com/img2.jpg',
    ],
    duration: 10,
    aspectRatio: '16:9',
  },
});
// 提取 Task ID: result.content[0].text 包含 "Task ID: abc123xyz"
```

### `makaron_get_video_status`

查询视频任务状态。**建议每 10-15 秒轮询一次，不要紧密循环**。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | string | ✅ | 来自 `makaron_create_video` 的 Task ID |

**返回状态：**
- `pending` — 排队中
- `processing` — 渲染中（通常 3-5 分钟）
- `completed` — 完成（包含 videoUrl）
- `failed` — 失败（包含错误信息）

**示例：**
```ts
// 轮询直到完成
while (true) {
  const result = await client.callTool({
    name: 'makaron_get_video_status',
    arguments: { taskId: 'abc123xyz' },
  });

  const text = result.content[0].text;
  if (text.includes('completed')) {
    // 提取 videoUrl: "Video URL: https://..."
    break;
  } else if (text.includes('failed')) {
    throw new Error('Video rendering failed');
  }

  await new Promise(r => setTimeout(r, 15000)); // 15 秒间隔
}
```

---

## 鉴权

线上 HTTP endpoint 需要 Bearer token 鉴权。所有请求必须带 `Authorization` header：

```
Authorization: Bearer <MCP_API_KEY>
```

未携带或 token 不匹配会返回 `401 Unauthorized`。本地 stdio 模式无需鉴权。

---

## 接入方式

### 方式 1：远程 HTTP（推荐）

连接 Makaron 的线上 MCP endpoint，无需本地环境。

**Endpoint:** `https://www.makaron.app/api/mcp`

**Node.js / TypeScript：**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(
    new URL('https://www.makaron.app/api/mcp'),
    { requestInit: { headers: { Authorization: 'Bearer <MCP_API_KEY>' } } }
  )
);

// 编辑图片
const result = await client.callTool({
  name: 'makaron_edit_image',
  arguments: {
    image: 'https://example.com/photo.jpg',
    editPrompt: 'Add cinematic warm lighting with depth of field',
    skill: 'enhance',
  },
});

// result.content = [
//   { type: 'text', text: 'Image generated successfully.' },
//   { type: 'image', data: '<base64>', mimeType: 'image/jpeg' },
// ]

// 旋转视角
const rotated = await client.callTool({
  name: 'makaron_rotate_camera',
  arguments: {
    image: 'https://example.com/photo.jpg',
    azimuth: 180,    // 从背后看
    elevation: 0,
    distance: 1.0,
  },
});

// 视频生成完整流程
// 1. 写脚本
const script = await client.callTool({
  name: 'makaron_write_video_script',
  arguments: {
    images: [
      'https://example.com/photo1.jpg',
      'https://example.com/photo2.jpg',
    ],
    userRequest: 'Create a cinematic story',
  },
});

// 2. 提交渲染任务
const createResult = await client.callTool({
  name: 'makaron_create_video',
  arguments: {
    script: script.content[0].text,
    images: [
      'https://example.com/photo1.jpg',
      'https://example.com/photo2.jpg',
    ],
    duration: 10,
  },
});

// 提取 Task ID
const taskId = createResult.content[0].text.match(/Task ID: (\S+)/)[1];

// 3. 轮询状态
while (true) {
  const status = await client.callTool({
    name: 'makaron_get_video_status',
    arguments: { taskId },
  });

  const text = status.content[0].text;
  if (text.includes('completed')) {
    const videoUrl = text.match(/Video URL: (\S+)/)[1];
    console.log('Video ready:', videoUrl);
    break;
  }

  await new Promise(r => setTimeout(r, 15000)); // 15s 间隔
}
```

**curl 测试：**

```bash
# Initialize
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <MCP_API_KEY>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# List tools
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <MCP_API_KEY>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call tool
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <MCP_API_KEY>' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"makaron_edit_image","arguments":{"image":"https://example.com/photo.jpg","editPrompt":"Add sunglasses"}}}'
```

### 方式 2：本地 stdio（开发/Claude Code）

在本地运行 MCP server，适合 Claude Code 或本地 agent 开发。

**前置条件：**
- 克隆 `ai-image-editor` 仓库
- `.env.local` 中配置 `OPENROUTER_API_KEY`（必须）和 `HF_TOKEN`（rotate 用）

**启动：**

```bash
cd ai-image-editor
npm install
npm run mcp    # stdio 模式
```

**Claude Code 配置（`~/.claude.json`）：**

```json
{
  "mcpServers": {
    "makaron": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "--require", "./md-loader.cjs", "mcp-server.ts", "--stdio"],
      "cwd": "/path/to/ai-image-editor"
    }
  }
}
```

stdio 模式额外支持本地文件路径作为 image 输入，结果保存到 `mcp-output/` 目录。

### 方式 3：项目级 MCP 配置（`.mcp.json`）

在项目根目录添加 `.mcp.json`：

```json
{
  "mcpServers": {
    "makaron": {
      "command": "npx",
      "args": ["tsx", "--require", "./md-loader.cjs", "mcp-server.ts", "--stdio"],
      "cwd": "/path/to/ai-image-editor"
    }
  }
}
```

---

## 图片传输

| 场景 | 输入 | 输出 |
|---|---|---|
| HTTP 远程 | URL 或 base64 data URL | base64 在 MCP `image` content block |
| stdio 本地 | 文件路径、URL、或 base64 | 保存到 `mcp-output/` 目录 |

**建议：** 优先用 URL（小 payload），base64 适合无公开 URL 的场景。

---

## 限制

**图片编辑：**
- `edit_image` 耗时 ~15-25 秒（Gemini 生图）
- `rotate_camera` 耗时 ~20-30 秒（HuggingFace/fal.ai）
- HTTP 模式 maxDuration = 180 秒（脚本生成可能需要 30-60s）
- 图片建议 < 2MB，过大会影响速度

**视频生成：**
- `write_video_script` 耗时 ~1-2 分钟（Claude Sonnet 多图分析）
- `create_video` 提交任务 ~1-2 秒（返回 Task ID）
- `get_video_status` 查询状态 ~1 秒
- **视频渲染耗时 3-5 分钟**（Kling/Foldin 后台处理）
- 图片必须是公开 URL（不支持 base64）
- 建议轮询间隔：10-15 秒
