# Makaron MCP Server

Makaron 的 AI 图片编辑能力通过 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 对外暴露，任何支持 MCP 的 agent 或项目都可以接入。

## 可用 Tools

### `makaron_edit_image`

AI 图片编辑/生成。支持 4 种 skill 模板。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | ✅ | 输入图片：本地文件路径（stdio 模式）、URL、或 base64 data URL |
| `editPrompt` | string | ✅ | 英文编辑指令 |
| `skill` | string | | `enhance` / `creative` / `wild` / `captions` |
| `originalImage` | string | | 原图（人脸修复参考） |
| `referenceImages` | string[] | | 参考图数组（最多 3 张） |
| `useOriginalAsReference` | boolean | | 是否用原图做参考 |
| `aspectRatio` | string | | 目标比例，如 `"4:5"` |

**Skill 说明：**
- `enhance` — 专业增强（电影感光影、色彩分级、景深）
- `creative` — 添加与场景有因果关系的趣味元素
- `wild` — 夸张变形画面中已有的物品
- `captions` — 添加写实风格的文字叠加

### `makaron_rotate_camera`

3D 视角旋转，用 AI 生成不同角度的照片。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | ✅ | 输入图片：本地文件路径、URL、或 base64 data URL |
| `azimuth` | number | ✅ | 水平旋转 0-360°（0=正面, 90=右侧, 180=背面, 270=左侧） |
| `elevation` | number | ✅ | 俯仰角 -30~60°（0=平视, 60=俯视） |
| `distance` | number | ✅ | 距离 0.6~1.4（0.6=特写, 1.0=中景, 1.4=远景） |

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
  new StreamableHTTPClientTransport(new URL('https://www.makaron.app/api/mcp'))
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
```

**curl 测试：**

```bash
# Initialize
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# List tools
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call tool
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
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

- `edit_image` 耗时 ~15-25 秒（Gemini 生图）
- `rotate_camera` 耗时 ~20-30 秒（HuggingFace/fal.ai）
- HTTP 模式 maxDuration = 120 秒
- 图片建议 < 2MB，过大会影响速度
