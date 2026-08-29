# Makaron 视频拉片 / 视频复刻 Agent Skill 探索

日期：2026-08-30

分支：`codex/video-replication-skill-exploration`

范围：独立 worktree 内的只读盘点、Skill 原型与零付费离线 spike；未合并、未推送、未部署，未触碰生产或 Vast。

## 结论

推荐产品形态是一个内置 `video-replication` Skill；本分支只实现了候选原型和
通用 discovery 边界，尚未完成真实 CUI 选路 E2E。目标是由现有 CUI Agent 通过
Skill manifest 的语义描述自动发现并读取；它复用
`reference-video-studio` 的 Studio Run recipe、FFmpeg/FFprobe、ASR、Workspace
Agent、Remotion、现有视频 provider 与 materialize/review，不新增页面、编辑器、
平行 Agent、业务 API 或 DB。

名字选择 `video-replication` 而不是 `shot-replication`：用户目标不只有镜头，
还包括字幕和音频结构；但描述把边界收窄到“可测量的 shot grammar 复刻”。现有
`reference-video-studio` 继续负责宽松灵感/remix，并增加一条负向边界，避免两个
Skill 竞争。本原型还修正了多行 description 在 manifest 中被截断的问题，并增加
“可测量 shot grammar = deterministic post-production”的 operation-level carve-out；
没有用户关键词表。单元测试证明 manifest 可见，尚未证明真实 CUI 一定选中。

最可行路线是 **A 优先、C 默认扩展、B 最后**：已有素材先确定性重剪；缺镜才逐镜
生成；整片的 timing、cut、transition、caption、beat 和最终音轨永远在 Remotion/
FFmpeg 锁定。逐镜生成不能承担 frame-accurate 剪辑时钟。

## 状态口径与当前盘点

- **observed**：本 worktree 的 current HEAD 中直接看见并检查过。
- **merged**：相关 commit 是 current HEAD 的 ancestor；不代表线上已部署。
- **worktree-only**：当前 working tree 的未提交改动。
- **branch-only**：只提交在本地探索/旧分支，未进 canonical HEAD。
- **proposed**：本文建议，尚未实现。
- **deployed**：只有本轮重新核验生产才会使用；本轮没有任何 deployed 结论。

| 能力 | 本轮状态 | 证据与边界 |
| --- | --- | --- |
| Skill 自动发现/读取 | observed + merged | `src/lib/skill-registry.ts` 扫描 `src/skills/*/SKILL.md`；`src/lib/workspace.ts` 生成语义 manifest；`src/lib/agent.ts` 注入 manifest；`list_files/read_file` 读取。无需关键词 router 或 DB 注册。 |
| `reference-video-studio` | observed + merged (`529a89ee`) | 已有五维分析、keep/change、sample-first、editable Remotion、最终 MP4 review；它面向原创灵感，不是逐镜结构复刻。 |
| Agent FFmpeg Video Lab | observed + merged (`9a604eb0`) | 已有 probe、精确 trim/split、转码、抽帧、音频、concat、最终 MP4 文件门禁。 |
| Workspace Agent / editable Remotion | observed + merged | `write_code_file` + `run_code(runtime=composition)`、preview、patch、materialize 已存在；generic source range 的 `7b06bf1e`/`b28599b4`/`ad5c9f44` 已合入。 |
| ASR timing | observed + merged | `transcribe_audio` 可提供 utterance/word timing；本次离线环境没有 Whisper，因此 spike 没有声称完成 ASR。 |
| Kling Motion Control / reference video | observed + merged (`004d658e`) | 可做单人连续镜动作迁移；不能负责整片镜头切分、字幕、节拍或多镜剪辑。 |
| Seedance 2.5 routes | observed + merged | 当前 EvoLink adapter 已有生成、reference、edit、extend 等入口；本地能力/价格表与 2026-08 官方页面已有漂移，提交前必须 contract probe。 |
| `video-reverse.md` / `video-to-template.ts` | observed + merged (`d29b510f`)，但 dormant | 整片 Gemini 分析后产出单个 Kling prompt；未被当前路由引用，也没有 Blueprint、边界验证或相似度 QA，不能当成现成产品。 |
| native local-video adapter | branch-only (`codex/makaron-native-agent-local-video@3a87ccbb`，15 unique；另有 `codex/makaron-local-video@a0555b0c`，3 unique) | 旧分支有 no-full-upload/contact sheet/local ASR 合同；当前 CUI 仍是上传路径。P0 不迁入其大范围改动。 |
| shot/beat/camera/OCR 结构分析与自动 similarity QA | absent | 定点搜索没有发现稳定的 shot detector、beat detector、global motion/camera estimator、OCR layout extractor、typed Video DNA 或多维视频相似度门禁。 |
| 本探索的 `video-replication` 原型 | worktree-only at evidence capture；最终若本地提交则为 branch-only | `builtIn: true`/`supportLevel: experimental` 只是候选注册类型。只有 Skill、references/schema、离线 extractor、测试和本文；不是可用产品，更不是 deployed。 |
| discovery/MIME 补口 | worktree-only at evidence capture | 折叠完整 description、增加 operation carve-out、补 `.mjs/.cjs -> text/javascript`，使 Agent 能发现并读取；仍不能直接把 built-in path 当 `run_code.code_path`，也未做 CUI E2E。 |

公开 `packages/makaron-cli/skills/makaron` 与 `public/.well-known/agent-skills`
是 umbrella discovery；若验证后合入，候选 canonical 路径是
`src/skills/video-replication/SKILL.md`，由运行时动态 manifest 发现。P0 不改
marketplace、不改公开 umbrella alias。`animate.md` 仍负责能在单次模型时长内完成的
直接新生成视频；可测量逐镜结构匹配被定义成确定性后期，并先读取本 Skill。TikTok
Skill 只增加平台包装/安全区，不拥有复刻流程；这条边界目前只有代码/manifest 测试，
仍需真实 CUI 正负例。

## Skill 原型合同

### 目录

```text
src/skills/video-replication/
├── SKILL.md
├── references/
│   ├── shot-blueprint.md
│   ├── shot-blueprint.schema.json
│   └── similarity-qa.md
└── scripts/
    └── extract-shot-blueprint.mjs
```

`SKILL.md` 只保留会改变 Agent 决策的知识：何时进入复刻、rights/scope gate、
Blueprint 锁定、A/B/C 选择、工具顺序、sample/cost/retry gate、停止与恢复规则。
详细字段和指标放 references；确定性抽取放 script，而不是堆进 prompt。

### 触发描述

> Orchestrate supervised recreation of a supplied reference video's shot
> grammar with replacement subjects or assets: shot count, order, timing,
> framing, camera motion, transitions, captions, and audio-beat structure. Use
> for measurable shot-by-shot matching; use reference-video-studio for loose
> inspiration and source-video-studio when the original footage itself is the
> edit.

这段描述与宽松“做一个类似的”以及“编辑这条原片”互斥。原型已证明完整描述进入
semantic manifest，不需要关键词表；是否在真实 CUI 对正负请求稳定选中仍待 E2E。

### 输入 / 输出

输入：

- 一条明确的 reference video（多条时先选定 authority）及使用权限；
- replacement subject/assets 与明确的 preserve/change（主体、素材、品牌、文案、音乐）；
- 目标比例、时长、分辨率、FPS、语言、字幕、音频、可编辑性和优先验收维度；
- 对第三方视觉分析、ASR、生成分别授权；不同意时只运行本地 FFmpeg/FFprobe；
- B/C 才需要 provider 预算、retry cap 与可接受 latency。

输出：

- 现有 `${projectId}/studio-runs/${studioRunId}/run.json` 与八阶段 artifacts，作为唯一
  durable state；不创建第二套状态机；
- `${projectId}/studio-runs/${studioRunId}/analysis/shot-blueprint.json`：P0 schema
  skeleton 的 reference、boundaries、shots、global Video DNA、preserve/replace；
- shot asset map 或逐镜生成产物；
- 单一、可 patch 的 Remotion composition；
- Composition artifact 中的 pre-materialization QA/代表帧证据，以及现有异步
  materialization 产出的 MP4。最终 encoded-MP4 结构 QA 在 durable worker 接入前必须
  标为 unverified，不能由 Skill 自称自动通过。

不默认计算或暴露内容 SHA；恢复使用文件名、大小、时长、分辨率、流信息等低成本
fingerprint，除非用户明确要求 hash。

### 可中断 / 恢复

不新增阶段，映射到既有八阶段：Brief 存 rights/scope/reference metadata 与 Blueprint
路径；Proposal 存 A/B/C、provider contract、预算与阈值；Storyboard 存确认后的镜头；
Assets 存 asset map/task IDs；Composition 存 design path 与导出前 QA。恢复时读取
`run.json` 和这些 artifacts，沿既有 approval/invalidation 继续。task reconcile 规则是：
pending/running 才 poll；success 下载；terminal failed 先记录失败原因与计费状态，再
决定是否创建新 attempt。参考、route 或 FPS 变化时，用 Studio Run 的 invalidation，
不能另维护 `next_action` 真相源。

### 真实 CUI 请求示例

> 把 `<<<media_1>>>` 逐镜复刻成 Makaron 产品片。我拥有参考片使用权。保留镜头数量、
> 顺序、时长曲线、构图、运镜、转场、字幕布局和 beat 命中点；人物、品牌、文案、
> 音乐全部换成我上传的 `<<<media_2>>>`–`<<<media_6>>>` 与“Makaron，让一个人也像
> 一间工作室”。输出跟参考一样 9:16、15 秒、30fps、可编辑 Remotion + MP4。允许把
> 抽帧和音频交给第三方分析/ASR，但本轮付费生成预算为 0；低置信边界先停在 Blueprint
> 让我确认。

## 执行流水线与工具边界

```text
reference ingest
  → deterministic probe / candidate extraction
  → multimodal labels + ASR + beat/motion/text/style evidence
  → reviewed Shot Blueprint / Video DNA
  → route A/B/C + cost gate
  → asset mapping or per-shot generation
  → editable Remotion composition
  → preview + available structural QA
  → smallest-layer repair loop
  → existing asynchronous materialize/export
  → proposed durable post-export decode/similarity gate
```

| 决策/事实 | 确定性 tool/script | 模型判断 |
| --- | --- | --- |
| 文件/stream/duration/FPS/decode | FFprobe/FFmpeg | 不得覆盖；最终 export decode 尚需 worker gate |
| shot boundary 候选 | scene score、black/fade、帧差；P1 加专用 detector | 对低置信候选看前后帧，确认语义边界和 transition 类型 |
| ASR | `transcribe_audio` word/utterance times | speaker/语义段落，不能编造时间码 |
| beat/onset | proposed 通用 onset/tempo extractor | 音乐弧线、情绪与哪个 beat 应被保留 |
| composition/text | proposed object/face/OCR boxes；抽帧 | shot size、视觉层级、文本角色、可替换项 |
| camera/motion | proposed global homography/optical flow | pan/tilt/dolly/handheld 等导演语义与重要程度 |
| style/color | palette/histogram/contrast 数值 | lighting/texture/genre 语义和合法可迁移范围 |
| route/model | provider capability/price tool 给事实 | Skill 按 A→C→B、风险/成本选择；不让 provider 自行决定 |
| exact cut/caption/beat/final audio | Remotion/FFmpeg | 只评审，不交给生成模型承诺 |

当前 `analyze_video` 是第三方自由文本多模态分析，不是 typed detector；
`transcribe_audio` 也是第三方服务。内置 Skill script 目前可被 `read_file` 读取，却
不能作为 workspace path 直接交给 `run_code`；CLI prototype 还依赖 argv、本地 path
和系统 ffprobe，不能假装已经走通真实 CUI runtime。可靠产品化需要下面的最小通用
工具补口，而不是让 Agent 复制一大段源码或继续膨胀提示词。

## A / B / C 路线比较

| 路线 | 能力上限 | 成本 / 延迟 | 稳定性 | 版权/安全 | 最小 P0 |
| --- | --- | --- | --- | --- | --- |
| A 原素材/用户素材结构复刻与重剪 | shot count/order/timing、crop、speed、cut、transition、caption、beat 可接近 frame-exact；不能创造缺失视角/动作 | 最低；本地分析与 render，秒到分钟 | 最高，可回放、可 patch | 可选择完全本地；若调用 `analyze_video`/ASR 仍会第三方处理，需单独授权；始终需素材/音乐许可 | 1 条 reference + 用户替换素材，锁 Blueprint 后用 Remotion 复刻 3–6 镜 |
| B 逐镜生成式复刻 | 可换主体、场景和动作；within-shot camera/action 受模型随机性限制，跨镜一致性最难 | 最高；逐镜排队，分钟到小时且按秒计费 | 最低；成功状态不代表结构命中 | 真人/品牌/版权内容上传风险最高；必须 rights gate | 只生成一个 4–5s 代表镜，低分即停止，不跑全片 |
| C 混合 | A 保证结构和已有素材，B 只补缺镜；通常达到最佳性价比 | 中等；成本与缺镜数成正比 | 中高；最终时间线确定，生成镜仍可能漂 | 只上传必要片段，降低暴露面 | 先完成 A 的完整 rough cut，再替换一个确实缺失的镜头 |

路线 A 的上限由素材覆盖率决定；B 的上限由 provider 对 camera/action/identity 的
可重复服从率决定；C 是推荐的真实产品默认，但 P0 验证应先做纯 A，避免把 detector
和生成模型两种误差混在一起。

## Provider 能力（2026-08-30 第一方资料核验）

| Provider/能力 | 能做什么 | 不能承诺 / 本地状态 | Skill 用法 |
| --- | --- | --- | --- |
| Seedance 2.5 / EvoLink | ByteDance 模型官方支持 framing、cinematic language、camera perspective、motion、pacing 参考；4–30s，最多 30 图/10 视频/10 音频、50 refs，并有 edit/extend。[ByteDance 发布说明](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)、[模型页](https://seed.bytedance.com/en/seedance2_5) | ByteDance 承认复杂运动物理和多主体稳定性不足；audio ref 不等于 sample-accurate beat。EvoLink 是访问/代理层，不是模型厂商，其 route/价格/计费失败合同需独立核验。[EvoLink About](https://evolink.ai/about)、[API/价格](https://evolink.ai/seedance-2-5)。本地 adapter 存在不代表生产/live contract 已验。direct BytePlus 的真人输入还受 approved material ID 政策限制。[BytePlus API](https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced) | B/C 的缺镜、替换主体或参考运镜默认候选；先 4–5s、480p 代表镜 |
| Kling Motion Control | 官方按 2.6/3.0 与 orientation 区分合同；核心是单角色动作/表情迁移。[官方指南](https://kling.ai/quickstart/motion-control-user-guide) | `3–30s`、连续镜与 camera movement 约束不能跨版本/模式套用；例如 2.6 match-image orientation 可允许 camera movement。3.0 时长和当前 adapter 合同需 probe；始终不承担整片多镜剪辑 | 只给一个单角色动作镜；按实际 version/orientation 预检，拒绝把多镜 reference 当 motion-control task |
| Kling 3.0 Omni | 视频 reference、首尾帧、多图/元素、多镜 storyboard，输出可到 15s。[Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide) | 带视频输入时不支持生成新 native audio；本地 adapter 未暴露明确 first/last role 与 structured multi-shot | P1 对照；P0 仅 ≤10s feature reference，音频后期合成 |
| Gemini Omni 1.1 Flash | source-video edit、首尾帧、短视频 reference、timestamp prompt；3–10s。[官方文档](https://ai.google.dev/gemini-api/docs/omni) | 不接受 audio reference，忽略 reference video 音轨；最多 3 个 ≤3s 短视频且不能跨视频 reasoning。本地仍写 `gemini-omni-flash-preview`，官方已 GA `gemini-omni-1.1-flash` 且 preview 于 2026-09-30 关闭，属于明确迁移项，不只是探测。[Changelog](https://ai.google.dev/gemini-api/docs/changelog)、[Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) | P1 短片 edit 对照；先迁 model contract，不做 P0 默认 |
| Google Veo 3.1 Preview | 首尾帧、最多 3 张 reference images、4/6/8s、always-on native audio。[官方文档](https://ai.google.dev/gemini-api/docs/veo) | reference images、extension、1080p/4K 必须 8s；extension 输入是 Veo 自生成视频，不是任意 reference；没有 shot-grammar 视频输入或动作迁移。仓库未接 | 不作为复刻 provider |
| Runway Dev | 自有 Act-Two 最长 30s performance capture；Aleph 编辑 2–30s；2026-08-26 又新增第三方 WAN 3.0（最长 30s、图/视频/音频参考、首尾帧）。[Act-Two](https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two)、[API changelog](https://docs.dev.runwayml.com/api-details/api_changelog/) | 仓库未接；这是 Runway 渠道盘点，不代表 Makaron 能调用，也不能用 WAN 资料证明 Runway 自有模型。[价格](https://docs.dev.runwayml.com/guides/pricing/) | P1 benchmark，只有同一测试集显著胜出才接 |

音频节奏必须逐 route 看：Seedance 2.5 可吃 audio refs；Kling Omni 带视频输入时不能
生成新 native audio；Gemini Omni 不吃 audio ref 且忽略 reference video 音轨；Veo
是 always-on native audio，不是 audio reference。没有一个能保证任意参考片的
sample-accurate beat replication；音乐节拍、SFX 命中点、字幕和最终 mix 必须由
确定性时间线复刻。

## 成本与停止门禁

1. 未确认 reference、真人肖像、品牌与音乐权限，或未分别授权第三方 analysis/ASR/
   generation：只做本地 FFmpeg/FFprobe，不上传。
2. 只有格式、时长、分辨率、可达性等确定性 metadata 缺陷可以转码/切段后再试；
   rights、moderation、真人政策或 unsupported modality 必须停止。不得为了“修 URL”
   擅自公开托管私人素材，同一无效输入不重复提交。
3. 提交前按实际 route、resolution、输入/输出计费时长给出估价；价格或合同不明即停。
4. 对 Seedance 2.5 480p P0，拟议只做一个 4–5s 代表镜、上限 `$1/镜、$5/轮`；
   “一轮”包含本次 Blueprint 下全部首次任务、一次允许的定向修正和 add-ons。它不是
   provider 通用价格；EvoLink video-reference 按
   `max(总输入视频时长, 输出时长) + 输出时长` 计费，必须以提交时 quote 为准。
5. 每镜最多一次初试和一次带明确 QA delta 的修正；第三次需用户再次批准。
6. 代表镜不过阈值，停止 full batch。`completed` 但不相似是语义失败，不能 blind retry。
7. Blueprint/route/asset map 未变且已有 task ID 时先 reconcile：pending/running 才 poll；
   success 下载；terminal failure 记录失败/计费后再决定是否新建 attempt。
8. Skill 当前只可阻断 materialize 前的结构 QA；最终 MP4 decode/多维 QA 必须由拟议的
   durable post-export gate 执行。在它接入前，现有 worker 可完成 Delivery，但复刻
   similarity 状态必须标为 `unverified`，不能声称机器验收 complete。

## 可机器验收的指标

下面是验收设计，不是当前 Skill 已实现的自动 scorer。离线 prototype 只覆盖 probe、
provisional boundaries、schema 校验和内部连续性 validator；其余需 P0-T/P1 工具化。

| 维度 | 算法 | P0 目标 |
| --- | --- | --- |
| shot count/order | 对边界做单调匹配，比较数量与序列 | A 必须 exact；B/C 逐镜报告缺失/多余，不平均掉 |
| 边界误差 | `abs(output_t[i] - ref_t[i])` 的 median/P95 | A median ≤2 frames、P95 ≤5 frames |
| 镜头时长曲线 | matched-shot duration MAPE 与相关系数 | A MAPE ≤5%；B/C 分开报告生成片内动作误差 |
| 构图 | 主体 bbox center/scale、saliency/horizon 的归一化偏差 | center ≤画面对角线 5%，scale error ≤10%（允许主体替换后） |
| 相机运动 | global homography/optical-flow 的方向、幅度、速度曲线 | 可测时方向一致，归一化曲线 correlation ≥0.8 |
| cut/transition | class confusion + transition duration error | hard cut/fade 类别一致，时长 ≤3 frames |
| 字幕 timing/layout | cue start/end、box IoU、baseline/size、safe area | timing ≤2 frames，layout IoU ≥0.85；替换文案不比较字面 |
| beat alignment | edit/SFX event 到最近 onset/beat 的距离 | median ≤50ms、P95 ≤100ms |
| 颜色/风格 | palette CIEDE2000、luma/contrast/histogram，必要时 embedding | 输出原始向量；阈值按项目标定，不用单一审美分 |
| 最终 MP4 | FFprobe + 全片 decode null sink | 可解码；duration ≤1 output frame；音轨存在性符合合同 |

不可能保证“完美复刻”的维度：随机生成像素、精确 camera trajectory、演员表演、
遮挡几何、复杂物理、唇形、sample-accurate 生成音乐，以及从成片反推出真实镜头/
器材/作者意图。构图/运动指标也会受主体替换影响；版权、肖像、商标和音乐许可不是
相似度分数，必须独立 gate。

## P0 / P1 / P2

### P0-S：Skill-only supervised feasibility

- 新增 `video-replication/SKILL.md`、Blueprint schema/reference、QA reference；
- 用户显式激活 Skill，或明确要求 Remotion/可编辑/确定性后期时，可复用现有
  `reference-video-studio` recipe、FFmpeg lab、Workspace/Remotion、preview/materialize；
- 人工确认 Blueprint 后只走 route A，或在独立批准下做一个代表镜；
- 不做 marketplace/UI/API/DB；不承诺自动选路、自动 resume、最终 MP4 similarity QA。

### P0-D：CUI 自动发现的最小公共补口（本分支原型，仍待 E2E）

- manifest 折叠完整 YAML description，使新旧 Skill 的互斥边界实际可见；
- `agent.md` / manifest / `animate.md` 增加 operation-level carve-out：可测量 reference
  shot grammar 属于 deterministic post-production；不使用关键词 router；
- `.mjs/.cjs` workspace MIME 映射让 Agent 可读 Skill script；
- 已有单元测试验证 manifest 和路由合同字符串；必须再跑真实 CUI 正例/负例，才能说
  “Agent 自动发现”成立。

### P0-T：必须补的最小通用工具/脚本（proposed）

- 将本地 extractor 算法产品化成通用 `analyze_video_structure`：返回 typed probe、
  boundary candidates、contact sheet、audio envelope/onsets 与置信度，直接使用
  `inputFiles`/`probeVideo`/runtime FFmpeg，而非 argv、系统 ffprobe；
- 或先让 built-in Skill scripts 可作为 `run_code` 的只读 `code_path` 执行，避免 Agent
  复制源码；
- 增加 `compare_video_structure`：对两份 Blueprint/最终 MP4 输出上述多维 delta；
- 把 post-export decode/structure verifier 接入 durable materialization worker，在 Review/
  Delivery 完成前写机器 QA，不能由 Agent 在 queue 成功后回头 review；
- 将 P0 schema skeleton 升级为 typed composition/camera/text/audio/style/route/QA schema，
  并验证 shot order、连续覆盖、duration、boundary 与 curve 的跨字段约束；
- provider tool 补统一 capability contract + 当前 quote，不把价格/limits 写死在 Skill；
- 预计改动只在 `src/lib/agent-tools.ts`、新建通用 media analysis 模块及测试，不需要
  产品 API/DB/UI。

### P1

- 专用 cut/dissolve detector、beat/onset、OCR/layout、global camera motion/object tracks；
- Kling first/last roles 与 multi-shot contract、Google Omni 模型名 contract probe；
- A/C 的自动 asset matching、逐镜 representative benchmark、可恢复 task polling；
- 用自有 ground-truth EDL 测试集标定不同视频类型阈值。

### P2

- learned Video DNA embedding 与跨类型 calibration；
- provider A/B harness、跨镜 identity/continuity scorer；
- 根据 QA delta 自动选择 deterministic patch / re-map / single-shot regenerate；
- 只有被真实 CUI 成功率证明后才考虑 marketplace 展示，仍不建设独立编辑器。

明确不建设：新的复刻页面、另一套 NLE/timeline、平行 Agent、复刻专用项目表/任务表、
独立上传链路、独立 render/export、旧 local-video worktree 的整体迁移。

### 预计文件与关键测试

| 层 | 文件 | 状态 |
| --- | --- | --- |
| Skill | `src/skills/video-replication/{SKILL.md,references/*,scripts/*}` | 本地 experimental prototype |
| Discovery boundary | `src/lib/workspace.ts`、`src/lib/prompts/agent.md`、`src/lib/prompts/animate.md` | 本地最小 carve-out；待真实 CUI 正负例 |
| Deterministic tool | `src/lib/video-structure-analysis.ts`、`src/lib/agent-tools.ts` | proposed；接 `inputFiles/probeVideo/ffmpegPath` |
| Durable QA | materialization worker 与 Studio Run review/delivery glue | proposed；post-export decode/metrics 进 complete gate |
| Provider contracts | 现有 `video-model-capabilities.ts`、Kling/Google adapters | proposed 小步迁移；不新增业务 API |
| Tests | `videoReplicationSkill.test.ts` | 本地：manifest/route/readability、仓库样片、快切回归 |
| Future tests | `videoStructureAnalysis.test.ts`、CUI route eval、Studio resume/invalidation、materialization QA gate | proposed；必须含 hard cut/dissolve/no-black、0.3–1.2s 快切、rotation/SAR/VFR、schema 负例与最终 decode |

## 离线 spike 证据

样例使用仓库自带、无私人内容的
`makaron-intro/renders/makaron-intro_2026-05-07_02-05-55.mp4`；未下载、上传或
付费生成。

- FFprobe：H.264、1080×1920、30fps、15.000s、无音轨；
- `video-understand` 固定 scene threshold 0.3 没有检出边界并退化成等间隔 20 帧；
- 新的离线 prototype 同时读取全帧 scene score 与 black/fade evidence；
- 输出 3 个 provisional shot ranges：`0–5.017`、`5.017–10.517`、
  `10.517–15.000`；
- 1.133s 的单一弱 scene score 被保留为 `unresolved_boundary_candidate`，没有悄悄
  变成第 4 镜；所有 shot semantic 字段仍为 `null` 且 `needs_model_review=true`；
- 修复了早期 1.5s 链式聚类会吞快切的问题；另一个 2.4s、每 0.4s 换色的合成 fixture
  保留了 0.8/1.2/1.6s 三个相邻 cut candidates，而不是合成一个。该 fixture 也漏掉
  两个低色差 cut，说明 FFmpeg scene score 仍只应是候选生成器；
- extractor 在写文件前验证 shot/boundary 数量、顺序、连续覆盖、duration curve 与结尾；
- 产物：`docs/spikes/makaron-intro-shot-blueprint.json`。

这证明离线 CLI prototype 可以生成 schema-valid、可审计的 Blueprint 骨架，也同时证明 scene score/
blackdetect 不是语义 ground truth：暗场可能是假阳性，smooth motion graphics 会让固定
阈值漏检。它没有走 `run_code(inputFiles/probeVideo)`、真实 CUI、Remotion、resume、
自动 QA 或 materialization；Spike 不是产品完成。

## 最大未知数与下一步最小实验

最大未知数不是“模型能否看懂视频”，而是两件可测问题：

1. 不同内容类型下，boundary/camera/beat/text extractor 的 precision/recall 能否稳定到
   足以无人值守锁 Blueprint；
2. 同一 Blueprint 下，Seedance 2.5 等 provider 对 within-shot camera/action/identity
   的可重复服从率，是否值得逐镜重试成本。

下一步先不调用付费生成：制作/选择一条 **自有 10–15s、4–6 镜、带 ground-truth
EDL 和 beat/caption 标注** 的参考片，提供同数量替换素材，走完整 route A：

1. extractor → 人工一次性确认 Blueprint；
2. Agent 生成 editable Remotion composition；
3. 导出并跑 boundary/order/duration/caption/beat/decode 指标；
4. 记录一次中断后从现有 Studio Run `run.json`/artifacts resume，验证没有第二套状态；
5. 只有 A 达门禁后，才对一个 4–5s 缺镜做一次 Seedance 2.5 480p 与一次 Kling
   feature 对照，设明确总预算且不自动重抽。

这个实验能先隔离 Skill 编排与确定性工具的缺口，再评估生成 provider；失败时知道该
修 detector、composition 还是生成模型，而不是把所有问题归为“看起来不像”。
