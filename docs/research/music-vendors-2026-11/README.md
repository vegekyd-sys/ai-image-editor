# 音乐供应商调研（2026-11-06）

目标：给 Makaron 找一个专门出 BGM 的供应商，把纯音乐从 Seed Audio 里拆出来。Seed Audio 继续负责「人声 + 音乐 + 音效」的混合音轨。

## 一、现有代码现状

- `src/lib/sunoapi.ts`：sunoapi.org 的客户端还在，默认 `V4_5`。
  - 接入 `/api/music`、`/api/music/[taskId]`、`/api/music/select`、`/api/music/import`，以及 `project_music` 表。
  - 带 stream 和 final 两个 URL，有 MusicCard 轮询。
- 2026-07-23 的 `a2cff599 feat: unify Seed Audio voiceover soundtracks` 把 Agent 侧改成只剩 `generate_audio`（Seed Audio）。
  - `src/lib/skills/create-music.ts` 现在内部调用 `createAudio`。
  - `audio-model-capabilities.ts` 里 `suno` 只是别名，指向 `evolink-seed-audio`。
  - 结论：**Suno 这套代码在，但已经不在 Agent 主路径上。**
- 账号状态：
  - `SUNOAPI_KEY` 可用，余额 830 credits（每次 V6 调用扣 12 credits，出 2 首，约 $0.06）。
  - `FAL_KEY`、`GOOGLE_API_KEY`、`EVOLINK_API_KEY`、`OPENROUTER_API_KEY` 都能直接调音乐模型。

## 二、我们已有的渠道上能用的音乐模型（实测，接口已查过）

| 模型 | 渠道（model id） | 时长控制 | 价格 |
|---|---|---|---|
| **Suno V6 / V6_WILD / V6_MINI** | sunoapi.org `model: "V6"`（V5_5 已被标为弃用）；EvoLink `suno-v6(-beta)` | sunoapi `duration` 10–360s，实测 30s 有效；EvoLink 文档写低于 60s 仍出约 60s | sunoapi 约 $0.06/次（2 首）；EvoLink 约 $0.118/次（未核实） |
| **Google Lyria 3.5** | Gemini API `models/lyria-3.5`（我们的 key 就能用）；fal `google/lyria-3.5` | **没有时长参数**，实测出 64–67s | fal $0.10/首；官方 $0.08 |
| Lyria 3 Pro / 3 Clip | fal `fal-ai/lyria3/pro`；OpenRouter `google/lyria-3-pro-preview` / `-clip-preview` | Clip 固定 30s | $0.08 / $0.04 |
| **ElevenLabs Music v2.5** | fal `elevenlabs/music/v2.5` | `music_length_ms` 精确控制，另有 composition_plan 分段 | fal $0.6/分钟（官方 $0.15/分钟，fal 贵 4 倍） |
| **Mureka 9.5** | fal `mureka/v9.5/generate/instrumental` 和 `/song` | 没有时长参数，实测约 3 分钟 | fal 按 unit 计费，单价未核实 |
| **MiniMax Music 3** | fal `minimax/music-3`（必须传 lyrics，纯音乐用 `[instrumental]` 标签） | `duration` 是上限 | $0.002/秒 |
| **Stable Audio 3 Medium** | fal `fal-ai/stable-audio-3/medium/text-to-audio` | `duration` 精确控制，最长 380s | $0.04/首 |
| 其他 | fal：ACE-Step、Sonilo、CassetteAI；Lyria RealTime（流式） | — | — |

## 三、同一 prompt 实测（2 个 prompt × 7 个模型）

- P1：Lo-fi house 旅行 vlog，110 BPM，15s 处 drop。
- P2：国风史诗预告，古筝、二胡、太鼓，20s 处高潮。
- 两个 prompt 都要求 30s、纯音乐。
- 打分方式：Gemini 3.1 Pro 盲评，3 轮，每轮打乱顺序，取四项均值（满分 10）。**AI 评分噪声大，仅供参考，以人耳试听为准：打开 `listen.html`。**

| 模型 | P1 分 | P2 分 | 实际时长 | 耗时 | 一句话 |
|---|---|---|---|---|---|
| **Suno V6** | 5.42 / 5.42 | **6.41** / 5.92 | 30s ✔ | 30–60s | 两个 prompt 都在前列，最稳；P1 偏 pop，结尾偶尔偏急 |
| Mureka 9.5 | **5.84** | 4.50 | 189–196s ✘ | 60s | 音乐性好，但完全不控时长 |
| Lyria 3.5 | 5.25 | 4.58 | 64–67s ✘ | 36–42s | 音质好；不控时长，会被扣分。实际用时可以在 Remotion 里裁剪加淡出 |
| Stable Audio 3 | 5.00 | 5.08 | 30s ✔ | 10s | 最快最便宜，风格偏泛 |
| Seed Audio（现用） | 4.42 | 5.92 | 30s ✔ | 30s | 管弦氛围类不错；**有鼓点律动的流派（house）明显弱** |
| ElevenLabs v2.5 | 4.17 | 5.50 | 30s ✔ | 11–13s | 很快、时长精确；P1 没出鼓点 |
| MiniMax Music 3 | 3.92 | 3.92 | 30s ✔ | 58–126s | 两轮都垫底，听感偏 MIDI |

外部参考是 Artificial Analysis Music Arena（2026-11，子 agent 抓取，未逐条核对）。纯音乐榜排名：

1. Suno v6（1148）
2. v6-mini（1114）
3. Mureka V9.5 ≈ Lyria 3 Pro ≈ Lyria 3.5（约 1080）
4. Eleven Music ≈ Stable Audio 3 Large（约 1015）
5. MiniMax 3.0（1000，作为锚点）

和我们的实测方向一致。

## 四、外部厂商的关键事实（网络调研，部分未验证）

- **Suno**：仍然**没有官方公开 API**，只有合作伙伴申请。sunoapi.org 和 EvoLink 都是第三方代理。商用授权最不确定，UMG/Sony 诉讼仍在进行。
- **Lyria**：Google 官方 API（Gemini API 和 Vertex），输出带 SynthID 水印；不支持参考音频，不支持多轮编辑。
- **ElevenLabs**：有官方 API，条款透明；但影视、游戏用途需要 Enterprise。
- **Stable Audio 3**：训练数据全部有授权，输出归用户，企业版有赔偿条款，是授权上最稳的一家。
- **MiniMax 官方音乐 API**：2026-08-20 起不再接受新用户，只能走 fal。
- **Udio / OpenAI**：没有可用的 API。

## 五、建议

1. **主力用 Suno V6，走 sunoapi.org。** 理由：
   - 实测和外部榜单都是第一。
   - 时长可控。
   - 最便宜（$0.03/首）。
   - 有 stream URL，可以先播放。
   - 已有 key 和整套代码，`sunoapi.ts` 只需要把模型从 `V4_5` 改成 `V6`，并加上 `duration`。
   - 风险：第三方代理，有授权和可用性风险。
2. **合规备用选 Lyria 3.5，走 Gemini API 直连**（已有 `GOOGLE_API_KEY`）。
   - 官方 API，音质好。
   - 不能控时长，需要在剪辑层裁剪和淡出。
   - 在 Suno 失败、或需要合规可追溯的场景下用它。
3. **Seed Audio 保留**：
   - 继续负责人声 + 音乐 + 音效的一体化混合音轨。
   - 对管弦、氛围类的纯 BGM 也还可以。
4. **不推荐作为主力**：
   - MiniMax Music 3：质量垫底。
   - Mureka：不控时长，fal 价格不清楚。
   - ElevenLabs via fal：比官方贵 4 倍。
   - Stable Audio 3 可以作为「秒出、便宜」的快速档候选。

接入时的设计点：

- Agent 侧需要恢复一个独立的 music 意图。可以在 `generate_audio kind="music"` 时改路由到 music provider，也可以单独开一个工具。
- 要保证混合音轨仍然走 Seed Audio 的一次生成，不能被拆开。

## 六、Suno V6：EvoLink 和 sunoapi.org 对比（2026-11-06 补测）

两个渠道都用 P1、P2 各跑一次，参数相同：`custom_mode`、`instrumental`、`duration=30`。sunoapi.org 另外补跑了一轮，用来测延迟。

| | sunoapi.org（`model: "V6"`） | EvoLink（`model: "suno-v6"`） |
|---|---|---|
| 单价 | **12 credits，约 $0.06/次**（出 2 首）。实测两次调用余额 830→806；官网标 $5 = 1000 credits | **$0.118/次**（出 2 首），由返回的 `usage.cost` 给出 |
| 端到端耗时 | 24–59s，共 4 次，近两次 24–26s | 27s（v6，两次）；38s（v6-mini） |
| 时长控制 | 30s 请求，实际 28.7–31.2s | 30s 请求，实际 28.8–30.0s。文档说低于 60s 会给到约 60s，但实测没有出现 |
| 流式地址 | `streamAudioUrl`，指向 `audiostream.api.box` | `stream_audio_url`，指向 `audiostream.kie.ai`，经 media.evolink.ai 包装 |
| 文件保留 | 文档写 14 天 | 文档写 72 小时 |
| 结果字段 | `data.response.sunoData[].audioUrl / streamAudioUrl / duration / tags` | `result_data[].audio_url / stream_audio_url / duration / tags / title / image_url` |
| 盲评（Gemini，同一组 Suno 样本） | P1 5.46，P2 5.87，平均 5.67 | P1 6.00，P2 5.54，平均 5.77。v6-mini 在 P1 得 5.96 |

**关键发现：两家用的是同一个上游。**

- EvoLink 返回的 `audio_url` 是 base64 包装的。解码后是 `https://tempfile.aiquickdraw.com/r/<id>.mp3`，和 sunoapi.org 返回的文件存储域名相同。流式地址解码后指向 `audiostream.kie.ai`。
- sunoapi.org 和 kie.ai 的服务条款写的是同一个丹佛地址，适用法律相同，静态资源也托管在同一个 `aiquickdraw.com` 上。
- 结论：EvoLink 的 Suno 就是转售同一个上游 kie.ai，不会换模型或重新编码。两边都是 48kHz、约 175–190kbps，盲评差异在噪声范围内。

**怎么选：用 sunoapi.org。** 理由如下：

- 输出完全一样，价格只有一半。
- 已有 key（余额 806 credits）和现成代码，文件保留 14 天，远长于 72 小时。

EvoLink 唯一的好处是账单和 Seed Audio 合在一起。它不能当容灾，因为上游是同一家，上游一挂两边一起挂。真正的容灾要选另一个模型，比如 Lyria 3.5。

## 七、接入要改的地方（方案：`generate_audio kind="music"` 走 Suno，混合音轨仍走 Seed）

不新增 Agent 工具。Agent 已经在用 `generate_audio(kind="music")`，在这一层改路由，提示词和工具面的改动最小。

1. **`src/lib/sunoapi.ts`**
   - 默认模型从 `V4_5` 改成 `V6`。
   - 新增参数：`duration`（10–360，仅 custom mode）、`negativeTags`、`styleWeight`、可选的 `model: V6 | V6_MINI | V6_WILD`。
   - 纯音乐用 `customMode:true + instrumental:true + style + title`，`prompt` 留空。
   - 新增一个 `waitForSunoTask()`：服务端轮询到 `SUCCESS`，大约 25–60s，和 Seed Audio 同步调用的体验一致。
2. **`src/lib/audio-model-capabilities.ts`**
   - 新增 `suno-v6` 能力项：provider 为 `sunoapi`，最长 360s，每次出 2 首，没有参考音频。
   - provider 类型从只有 `'evolink'` 扩展。
   - 删掉别名 `suno → evolink-seed-audio`，换成默认路由规则：`kind=music` 用 `suno-v6`，其余用 seed。
3. **`src/lib/skills/create-music.ts`**
   - 改成调用 Suno，2 首都持久化到 Supabase 和 `project_music`，写上 `stream_audio_url`，tags 写 `suno-v6`。
   - `create-audio.ts` 的 `persistAudioAsset` 目前只接受 `EvolinkSeedAudioResult`，要抽成通用版本，或者给 Suno 复制一个。
   - 失败时回退到 Seed Audio（现有路径）。后续可以把回退换成 Lyria 3.5。
4. **`src/lib/agent-tools.ts` 的 `generate_audio`（约 5340–5560 行）**
   - `kind === 'music'`，并且没有参考音频、参考图片时，走 `createMusic`。带参考或者是 mixed，仍走 Seed。
   - `model` 枚举加 `suno-v6`。
   - `duration_seconds` 的说明改成按 kind 区分上限：music 360，其余 120。
   - 2 首结果都登记进 Audio Index（`audio_N` 和 `audio_N+1`），提示 Agent 先用第一首，第二首备选。
5. **`src/lib/prompts/audio.md`**
   - 在「Music bed」一节加一段 Suno 写法：style 不超过 1000 字，写流派、乐器、BPM、能量曲线和结尾；不写艺人名；时长用参数传。
   - 写明纯 BGM 走 Suno，人声加音乐必须一次 mixed，仍用 Seed。
6. **计费**
   - 新增 `src/lib/billing/suno.ts`，或者合进 `media-pricing.ts`：按次计费，供应商成本 $0.06，按现有规则（1 credit = $0.01，2 倍加价）算是 12 Makaron credits/次。
   - `/api/music`、MCP 和 Agent 三处的 `quoteSeedAudio` / `deductSeedAudioCredits`，在走 Suno 时都换成 Suno 的报价。
   - admin 的 `MediaPricingPanel` 加一行。
7. **`src/app/api/music/route.ts` 和 MCP 的 `makaron_create_music`（`src/mcp/server.ts` 约 663 行）**
   - 参数加 `model` 和 `duration_seconds ≤ 360`。
   - Seed 专属的参数（pitch_rate、loudness_rate、sample_rate）只在 Seed 回退时生效。
   - **顺带修一个现存的不一致**：`makaron_get_music_status` / `getMusicStatus` 按 Suno taskId 查询，但现在 `createMusic` 返回的是 Seed 的 taskId。切到 Suno 后两边会重新一致。
8. **前端**：第一期不用改。工具是同步返回成品的，现有 Audio Index、`project_music`、MusicCard 都能直接显示。
   - 如果要「生成到一半先播」（约 20s 就出流式地址），第二期再走异步，复用 `music_task` 事件和 `/api/music/[taskId]` 的轮询（这条链路还在）。
9. **环境变量**：本地已有 `SUNOAPI_KEY`。上线前要确认 Vercel Preview 和 Production 也配了；回调地址仍用 `https://makaron.app/api/noop`。
10. **测试**
    - 更新 `__tests__/audioModelCapabilities.test.ts`。
    - 新增单测，覆盖 sunoapi 的 V6 请求体、状态映射、create-music 的路由和回退。
    - 按音频功能的验收口径：在真实 Makaron 项目里让 Agent 生成 BGM，放进 Remotion，导出的 MP4 里要有音乐。

预计改动量：核心逻辑约 300–400 行，加测试。最后只到 Preview，等你验收后再上生产。

## 文件

- `listen.html`：盲听页。默认隐藏供应商名，可以打分。**必须通过 HTTP 打开**（`python3 -m http.server 4410 --directory docs/research/music-vendors-2026-11`，然后访问 http://localhost:4410/listen.html）；直接双击用 file:// 打开，或在 app 文件面板里打开，脚本都不会运行。
- `audio/`：22 条样本（含 EvoLink Suno），已被 gitignore，不入库。
- `tracks.json`：样本元数据和 Gemini 分数。
