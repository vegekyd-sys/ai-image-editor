# Handoff: Remotion 视频配乐

## 目标

给 Remotion design 视频加背景音乐。两个使用场景：
1. **Remotion video 配乐**：Agent 在 design code 里加 `<Audio>` 组件
2. **Kling 生成视频配乐**：生成音乐后作为 Kling 视频的音轨

## 已有能力（零依赖安装）

- `<Audio>` 组件在 `@remotion/media@4.0.446`（已安装）
- Player 播放时有声音
- `renderMediaOnWeb` 导出 MP4 自动包含音轨（AAC 编码）
- `@fal-ai/client` 已安装（camera rotate 用的）

## 实现步骤

### Step 1: 加 Audio 到 Remotion scope

**文件**: `src/lib/evalRemotionJSX.ts`

```ts
import { Audio } from '@remotion/media';

const REMOTION_SCOPE = {
  // ...existing
  Audio,  // ← 加这个
};
```

### Step 2: 创建 /api/music route

**新文件**: `src/app/api/music/route.ts`

服务端调 fal.ai MusicGen（保密 FAL_KEY），返回音频 URL。

```ts
import { fal } from "@fal-ai/client";

// POST /api/music
// body: { prompt: string, duration?: number }
// response: { url: string }
const result = await fal.subscribe("fal-ai/musicgen", {
  input: {
    prompt,
    model: "facebook/musicgen-stereo-medium",
    duration: duration || 15
  }
});
return Response.json({ url: result.data.audio_url.url });
```

**环境变量**: `FAL_KEY`（已有，camera rotate 用的）

### Step 3: Agent 在 design code 里用 Audio

Agent 的 `run_code` 代码：

```jsx
function Design() {
  return (
    <AbsoluteFill>
      {/* visual layers */}
      <Audio src="${musicUrl}" volume={0.3} loop />
    </AbsoluteFill>
  );
}
```

`musicUrl` 从 fal.ai 获取后通过 template literal 插值。

### Step 4: Agent tool 或 workflow

两个方案选一个：

**A. 新增 `generate_music` tool**（推荐）
- Agent 调 `generate_music({ prompt: "gentle piano, cinematic" })` → 拿到 URL
- 然后在 `run_code` design 里用这个 URL

**B. run_code 里直接调 /api/music**
- Agent 在 `run_code` 代码里 `fetch('/api/music', { body: { prompt } })`
- 但 run_code 在 Vercel serverless 里执行，fetch 本地 API 可能有问题

## 音乐来源

### 推荐：fal.ai MusicGen（免费）
- **文档**: https://fal.ai/models/fal-ai/musicgen
- **价格**: 免费（$0/compute-sec）
- **时长**: 4-40 秒
- **SDK**: `@fal-ai/client`（已安装）
- **Prompt 示例**:
  - `"Lo-fi, chill, piano, ambient, soft drums"` — 日常 vlog
  - `"Cinematic orchestral, dramatic, strings, brass, epic"` — 旅行大片
  - `"Acoustic guitar, warm, gentle, folk"` — 温馨家庭

### 备选：fal.ai Stable Audio（免费）
- **文档**: https://fal.ai/models/fal-ai/stable-audio
- **更适合循环/环境音，最长 47 秒**

### 高质量：SunoAPI.org
- **文档**: https://docs.sunoapi.org/
- **价格**: $0.005/credit
- **模型**: V4-V5.5，最长 8 分钟
- **纯器乐**: `instrumental: true`
- **没有直接 duration 参数**——用短歌词暗示或生成后裁剪
- **Prompt 公式**: 流派 + 情绪 + 1-2 乐器
- **注意**: PiAPI 的 Suno wrapper 已停服，用 SunoAPI.org

## 关键文件

| 文件 | 状态 | 作用 |
|------|------|------|
| `src/lib/evalRemotionJSX.ts` | 需改 | 加 `Audio` 到 scope |
| `src/app/api/music/route.ts` | 新建 | fal.ai 代理 |
| `src/lib/agent.ts` | 可选 | 新增 `generate_music` tool |
| `src/components/RemotionRenderer.tsx` | 可选 | `resolvePropsUrls` 处理音频 URL |

## 注意事项

- `<Audio>` 用 `@remotion/media` 的，**不是** `remotion` 的 `<Html5Audio>`
- Safari 自动播放限制——Player 需要用户交互才能播放声音
- `renderMediaOnWeb` 默认包含音频，不需要额外配置
- 音频 URL 也需要 CORS 处理（`resolvePropsUrls` 可能需要扩展支持音频格式）
