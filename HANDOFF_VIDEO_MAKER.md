# Makaron MCP 接入指南 — Video Maker

## 快速接入

Makaron 通过 MCP (Model Context Protocol) 暴露 AI 图片编辑能力。Video Maker 可以远程调用。

### Endpoint

```
https://www.makaron.app/api/mcp
```

### 鉴权

所有请求必须带 Bearer token：

```
Authorization: Bearer 3a8992a090c17a58744edc2cce6ca1e39504686a0ddc2d3e7009530f3e8722f2
```

无 token 或 token 不对 → 401。

---

## MCP Client 配置

### 如果你用 `@modelcontextprotocol/sdk`

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('https://www.makaron.app/api/mcp'),
  {
    requestInit: {
      headers: {
        'Authorization': 'Bearer 3a8992a090c17a58744edc2cce6ca1e39504686a0ddc2d3e7009530f3e8722f2',
      },
    },
  },
);

const client = new Client({ name: 'video-maker', version: '1.0.0' });
await client.connect(transport);
```

### 如果你用 JSON config（Claude Code / OpenClaw 等）

```json
{
  "mcpServers": {
    "makaron": {
      "url": "https://www.makaron.app/api/mcp",
      "headers": {
        "Authorization": "Bearer 3a8992a090c17a58744edc2cce6ca1e39504686a0ddc2d3e7009530f3e8722f2"
      }
    }
  }
}
```

---

## 可用 Tools

### 1. `makaron_edit_image`

AI 图片编辑。传入一张图 + 编辑指令，返回编辑后的图。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | ✅ | 图片 URL 或 base64 data URL |
| `editPrompt` | string | ✅ | **英文**编辑指令 |
| `skill` | string | | `enhance` / `creative` / `wild` / `captions`（见下方说明） |
| `originalImage` | string | | 原图 URL（人脸修复参考用） |
| `referenceImages` | string[] | | 额外参考图（最多 3 张） |
| `useOriginalAsReference` | boolean | | 是否用 originalImage 做参考 |
| `aspectRatio` | string | | 输出比例，如 `"16:9"`, `"1:1"`, `"4:5"` |

**Skill 说明：**

| Skill | 用途 | 示例 editPrompt |
|---|---|---|
| `enhance` | 专业增强（光影、色彩、景深） | `"Cinematic warm lighting with shallow depth of field"` |
| `creative` | 往画面加趣味元素（与内容相关） | `"A small chameleon perched on the person's shoulder"` |
| `wild` | 夸张变形画面中已有物品 | `"The coffee cup is now enormous, towering over the table"` |
| `captions` | 写实文字叠加 | `"Add text 'Hello World' in neon style at the top"` |
| _(不传)_ | 自由编辑，按 editPrompt 执行 | `"Remove the background and replace with a beach sunset"` |

**调用示例：**

```ts
const result = await client.callTool({
  name: 'makaron_edit_image',
  arguments: {
    image: 'https://example.com/photo.jpg',
    editPrompt: 'Add cinematic warm golden hour lighting with depth of field blur on background',
    skill: 'enhance',
  },
});
```

**返回格式：**

```ts
result.content = [
  { type: 'text', text: 'Image generated successfully.' },
  { type: 'image', data: '<base64 JPEG>', mimeType: 'image/jpeg' },
]
```

### 2. `makaron_rotate_camera`

3D 虚拟相机旋转，生成不同视角的图片。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image` | string | ✅ | 图片 URL 或 base64 data URL |
| `azimuth` | number | ✅ | 水平旋转 0-360°（0=正面, 90=右侧, 180=背面, 270=左侧） |
| `elevation` | number | ✅ | 俯仰角 -30~60°（0=平视, 30=俯视, -30=仰视） |
| `distance` | number | ✅ | 距离 0.6~1.4（0.6=特写, 1.0=中景, 1.4=远景） |

**调用示例：**

```ts
const result = await client.callTool({
  name: 'makaron_rotate_camera',
  arguments: {
    image: 'https://example.com/photo.jpg',
    azimuth: 45,
    elevation: 15,
    distance: 1.0,
  },
});
```

---

## 连续编辑（链式调用）

上一步的输出 base64 可以直接作为下一步的 image 输入：

```ts
// 第一步：enhance
const step1 = await client.callTool({
  name: 'makaron_edit_image',
  arguments: {
    image: 'https://example.com/original.jpg',
    editPrompt: 'Cinematic lighting with warm tones',
    skill: 'enhance',
  },
});

// 从返回中提取 base64
const imageContent = step1.content.find(c => c.type === 'image');
const base64Image = `data:image/jpeg;base64,${imageContent.data}`;

// 第二步：用 enhance 结果继续 creative 编辑
const step2 = await client.callTool({
  name: 'makaron_edit_image',
  arguments: {
    image: base64Image,
    editPrompt: 'A tiny golden bird perched on the edge of the cup',
    skill: 'creative',
    originalImage: 'https://example.com/original.jpg', // 原图做人脸参考
    useOriginalAsReference: true,
  },
});
```

> **Tip**: 链式调用时传 `originalImage`（最初的原图）+ `useOriginalAsReference: true`，可以防止多轮编辑后人脸变形。

---

## 创意使用建议

基于 Makaron 大量 A/B 测试得出的经验：

1. **enhance 最稳定**（均分 7-8）：通透感 + 景深 + 自然色调 = 高分公式
2. **creative 要"加法"**：往画面加小元素（变色龙趴肩膀、小鸟站杯边），不要替换大面积区域
3. **wild 是"变形"**：让画面中已有物品发生夸张变化，不是加新东西
4. **人脸是最大约束**：小脸（<10% 画面）场景避免面部微调，用身体语言替代
5. **editPrompt 要精简**：过长的 prompt 会稀释模型注意力，3-5 句最佳
6. **英文 prompt only**：editPrompt 必须用英文，中文会严重降低生图质量

---

## 性能与限制

| 项目 | 值 |
|---|---|
| `edit_image` 耗时 | ~15-25s |
| `rotate_camera` 耗时 | ~20-30s |
| 最大超时 | 120s |
| 图片建议大小 | < 2MB |
| 输出格式 | JPEG base64 |
| 并发 | 无硬限制，但 Vercel serverless 有并发上限 |

---

## curl 快速测试

```bash
# Initialize
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer 3a8992a090c17a58744edc2cce6ca1e39504686a0ddc2d3e7009530f3e8722f2' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# List tools
curl -X POST https://www.makaron.app/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer 3a8992a090c17a58744edc2cce6ca1e39504686a0ddc2d3e7009530f3e8722f2' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

---

## 有问题？

- MCP endpoint 返回 401 → 检查 Authorization header
- 返回 406 → 确保请求头有 `Accept: application/json, text/event-stream`
- 超时 → 图片太大或网络慢，缩小到 < 2MB 重试
- 人脸变形 → 传 `originalImage` + `useOriginalAsReference: true`
