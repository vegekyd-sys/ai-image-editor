# Makaron 视频时间线 V2：方案、设计与实现记录

> 状态：已上线生产（2026-11-06，dev @ 70209385）。M0–M4 已实现并验收，文档更新于 2026-11-06 03:25 CST。合并与上线见 §8。
> 分支：`claude/video-timeline-v2`（基于 `origin/dev` 0df70536）。
> 代码：`src/lib/timeline/`（协议、reducer、运行时、服务端、Agent 工具）、`src/components/timeline/`（Dock、画布层、编辑 hook、胶片抽帧）。第二轮 UI 原型路由已删除，以真实编辑器为准。

## 0. 产品决定（已确认）

| # | 决定 | 落到方案里 |
|---|---|---|
| 1 | “时间线 / 元素”合并 | 时间线上的每一个 clip **就是**一个元素。只有一个 Dock，没有模式切换；选中 clip = 选中画布元素 = 打开该元素的属性 |
| 2 | 老视频先不兼容，优雅展示 | 老 composition 保持现有播放和 editable 编辑不变；时间线区域以只读“整段”展示，不做迁移 |
| 3 | 在最新 dev 开分支 | `claude/video-timeline-v2` |
| 4 | 字幕、画中画必须支持；覆盖所有旧 editable 能编辑的东西 | 元素类型覆盖 文字 / 图片 / 视频（含裁剪）/ 位置 / 缩放，新增 字幕 / 画中画 / 音频 / 转场 / 自定义组件 |
| 5 | **Killer feature：Makaron Agent 操作时间线，并实时、动态地展示出来** | Agent 每次编辑都是一个事务，实时推送到前端，按“编排”逐步播放动画；CLI / 后台 Agent 改动同样实时出现在打开的页面里 |

---

## 1. Remotion 调研结论（简版）

- Remotion 最近的“时间线更新”是 **v4.0.536（2026-10-16）**：Studio 默认按轨道显示 `<Track>/<Series>/<TransitionSeries>`；核心包新增 `<Track>`（≥4.0.534，同轨 clip 重叠直接报错，不产生 DOM）。当前最新 4.0.541，Makaron 锁在 4.0.527。
- Remotion 没有可以嵌入终端用户产品的免费时间线 UI；付费 Timeline / Editor Starter 是“复制源码”模板。Editor Starter 公开的状态形状（`tracks[]` + `items: Record` + `assets: Record` + `fps / compositionWidth / compositionHeight`）作为我们的协议对齐参考。
- Studio 的“编辑写回源码”路线面向开发者，不适合我们。
- **结论**：渲染、播放、导出、时间语义（`<Track>`、`<Sequence>`、`TransitionSeries`、`@remotion/media-utils` 波形）直接用 Remotion；时间线 UI 自建，用 Makaron 设计语言。需要升级 Remotion 到 4.0.541。

---

## 2. 产品模型：元素就是 clip

老模型：Agent 写一整段 React，GUI 从里面“推断”出可编辑字段，时间藏在代码里。
新模型：**视频是一组放在轨道上的元素**。每个元素自带时间（从哪一帧出现、持续多久）、空间（位置/缩放/旋转/透明度/裁切）、内容（文字、素材）和样式（预设或 Agent 写的组件）。

```
画布上看到的一切  ==  时间线上的一个 clip  ==  属性面板里的一组字段  ==  Agent 能用 op 改的一个对象
```

于是“时间线 / 元素”天然合并：

- 点时间线上的 clip → 画布高亮该元素 → Dock 底部行变成该元素的编辑行。
- 点画布上的元素 → 时间线滚动到该 clip 并选中，播放头若不在 clip 范围内则跳到 clip 起点。
- 画布上拖动/缩放（现有 Moveable/DesignOverlay）→ 写回 clip 的 `transform`；时间线上拖动/裁剪 → 写回 clip 的时间。

### 旧 editable 能力 → 新元素的对应关系

| 旧 editable | 旧存储 | 新协议 |
|---|---|---|
| 文字内容（`type: 'text'`） | `design.props[propKey]` | `TextClip.text` / `CaptionClip.segments[].text` / `ComponentClip.props[key]` |
| 替换图片（`type: 'image'`） | `props[propKey]` = URL | `ImageClip.assetId` |
| 替换视频 + 裁剪（`type: 'video'`） | `props[propKey]` + `_trimBefore_* / _trimAfter_*` | `VideoClip.assetId + sourceIn + durationInFrames` |
| 位置 | `_pos_<id>` | `clip.transform.x / y` |
| 缩放 | `_scale_<id>` | `clip.transform.scale` |
| 只在某些帧可见（帧感知 pill） | 代码里的 `<Sequence>` | `clip.from + durationInFrames`（时间线上直接可见、可拖） |
| — | — | 新增：旋转、透明度、圆角/描边（画中画）、入场/出场动画、音量、速度、字幕、转场 |

---

## 3. 时间线协议：Makaron Timeline Protocol（MTP）v1

新视频从头使用新协议（不做旧数据迁移），所以协议按“元素优先”重新定义，不沿用 `codex/editable-timeline-project` 的 scene-first 结构；那个分支只复用经过验证的部分：Zod schema 生成 Agent JSON Schema、事务 reducer、revision 冲突、编译器与 Player 热更新边界。

### 3.1 文档

```ts
interface TimelineDoc {
  kind: 'makaron-timeline';
  version: 1;
  revision: number;                         // 每个事务 +1
  canvas: { width: number; height: number; fps: number; background?: string };
  durationInFrames: number | 'auto';        // auto = 主轨结束 / 所有轨最晚结束

  tracks: Track[];                          // 数组顺序 = 图层顺序，后面的在上层
  clips: Record<ClipId, Clip>;
  assets: Record<AssetId, Asset>;           // 媒体：url、poster、时长、尺寸、来源（上传/生成/素材库）、状态
  components: Record<ComponentId, ComponentDef>;  // Agent 写的 React 组件（标题样式、特效、片头……）
  transitions: Record<TransitionId, Transition>;
  captionStyles: Record<StyleId, CaptionStyle>;   // 字幕样式预设，可被 Agent 组件扩展
}

interface Track {
  id: TrackId;
  kind: 'main' | 'overlay' | 'text' | 'caption' | 'audio';
  name: string;
  magnetic: boolean;           // main 轨默认 true：clip 首尾相接，删除/变长自动让位
  muted?: boolean; hidden?: boolean; locked?: boolean;
  clipIds: ClipId[];           // 按时间排序
}
```

### 3.2 元素（clip）

```ts
interface ClipBase {
  id: ClipId; trackId: TrackId; name: string;
  from: number;                     // 项目帧；magnetic 轨由 reducer 计算后写回，渲染层只读
  durationInFrames: number;
  transform?: { x: number; y: number; scale: number; rotation: number; opacity: number;
                anchor?: 'center' | 'top-left'; crop?: Rect; radius?: number; border?: Border; shadow?: Shadow };
  enter?: Motion; exit?: Motion;    // 预设（fade/slide/pop/typewriter…）或 { componentId }
  keyframes?: Partial<Record<'x'|'y'|'scale'|'rotation'|'opacity'|'volume', Keyframe[]>>;  // P3
  createdBy?: 'user' | 'agent';     // 用于 UI 标记和回放
}

type Clip =
  | (ClipBase & { kind: 'video';   assetId: AssetId; sourceIn: number; playbackRate?: number; volume?: number;
                  fit?: 'cover' | 'contain' })                 // 主轨 = 正片；overlay 轨 = 画中画
  | (ClipBase & { kind: 'image';   assetId: AssetId; fit?: 'cover' | 'contain'; motion?: 'none' | 'ken-burns' })
  | (ClipBase & { kind: 'audio';   assetId: AssetId; sourceIn: number; volume?: number; fadeIn?: number; fadeOut?: number;
                  role?: 'music' | 'voiceover' | 'sfx' })
  | (ClipBase & { kind: 'text';    text: string; style: TextStyle; componentId?: ComponentId })
  | (ClipBase & { kind: 'caption'; segments: CaptionSegment[]; styleId: StyleId; source?: { assetId: AssetId; asr: 'volcengine' } })
  | (ClipBase & { kind: 'component'; componentId: ComponentId; props: JsonRecord })   // 逃生舱：任意 React
  | (ClipBase & { kind: 'pending'; job: { type: 'video' | 'image' | 'music' | 'voiceover'; jobId: string; progress?: number;
                  label: string; becomes: 'video' | 'image' | 'audio' } });       // 生成中的占位

interface CaptionSegment { id: string; from: number; to: number; text: string; words?: { text: string; from: number; to: number }[] }

interface ComponentDef {
  id: ComponentId; name: string;
  codePath: string; codeHash: string;      // 不可变，改代码 = 新 hash
  propsSchema: EditableProp[];             // 组件声明自己的可编辑 props（文字/图片/颜色/数字/开关）
  kind: 'element' | 'text-style' | 'caption-style' | 'motion' | 'transition';
}
```

要点：

- **字幕**是一个 clip 内含多个 segment（逐句/逐词时间）。时间线上整体是一条，展开后每句可单独拖动边界、改字；画布上整体拖位置。来源可以是 ASR（现有火山 ASR 工具）或 Agent 手写。样式预设 + `caption-style` 组件（卡拉 OK 高亮、逐词弹出……）。
- **画中画**不是特殊类型：`overlay` 轨上的 `video` / `image` clip + `transform`（位置、缩放、圆角、描边、阴影、裁切）。UI 上提供“画中画”快捷入口和角落吸附。
- **自定义组件**承接 Agent 的创造力：`run_code` 以后写的是 `ComponentDef`（一个标题动画、一个片头、一个转场），由时间线实例化。组件用 `propsSchema` 声明可编辑字段，所以 Agent 写的任何东西依然能在 Dock 编辑行里编辑（字段多时编辑行可横向滚动）——这就是“所有之前 editable 能编辑的东西”的延续。
- **pending clip**：视频/图片/音乐生成是异步的（分钟级）。Agent 先在时间线上放一个占位 clip（带进度），生成完成后原地变成真实素材。这同时解决“Agent 编排需要等生成”的问题。

### 3.3 事务与操作

```ts
interface TimelineTx {
  txId: string;
  baseRevision: number;
  origin: 'user' | 'agent' | 'system';
  label: string;                  // “加字幕”“把开场缩短到 2 秒”——进 undo 栈、Agent 卡片、回放
  ops: Op[];
}
```

操作：`add_track / update_track / remove_track`、`add_clip / update_clip / move_clip（时间与跨轨）/ trim_clip（左/右）/ split_clip / remove_clip`、`add_asset / update_asset`、`add_component`、`set_transition / remove_transition`、`caption.set_segments / caption.update_segment`、`resolve_pending`。

- 同一个 reducer 在**服务端和浏览器**都跑（纯函数，确定性），服务端结果为准。
- 校验三层：schema → 语义（引用存在、同轨不重叠、素材边界、转场两侧相邻）→ 可渲染（组件编译、素材可访问）。前两层阻断，第三层给 diagnostics。
- **并发：按元素变基，不按整份文档拒绝**。Agent 运行时用户可以继续编辑。每个 tx 记录它碰过的 clipId；如果从 `baseRevision` 到现在没有别的 tx 动过同一批 clip，直接变基应用；有交叉才返回 `conflict`，带上对方改了什么，让 Agent 重读后再改。用户的手动修改永远不会被 Agent 静默覆盖。
- **Undo/redo** 存反向 op。Agent 的一个 tx 在 undo 栈里就是一步（“撤销 Agent：加字幕”）。

### 3.4 渲染

```
TimelineDoc ─ compile() ─▶ RenderPlan（排程、z 序、资源表、组件引用）
  ├─ Player：<MakaronTimeline plan />，时间/属性改动只改 inputProps，不重编译组件、不重置播放
  ├─ 截帧 / poster：renderStillOnWeb（同一组件）
  ├─ 浏览器导出：renderMediaOnWeb
  └─ 服务端导出：Lambda 新 composition `makaron-timeline`（与旧 `dynamic-design` 并存）
```

- 每条轨编译为 `<Track name>`，clip 为 `<Sequence from durationInFrames premountFor>`；主轨上有转场时用 `TransitionSeries`。
- 组件按 `codeHash` 编译缓存；`pending` clip 渲染为带进度的占位画面（导出时阻止，提示“还有素材在生成”）。
- Web App 与版本化 Lambda runtime 成对发布、成对回滚。

### 3.5 存储

- 视频 snapshot 的 design JSON 新增 `timeline: TimelineDoc`（存在 `code/<snapId>.json`），组件源码存 `components/<id>.<hash>.tsx`。有 `timeline` 字段的走新渲染器，没有的走老路径。
- 事务落盘 + 追加写 `timeline-log/<snapId>.jsonl`（tx 流水，供回放和审计）。
- 无需数据库迁移；revision CAS 复用现有 design PUT 路由。

---

## 4. Killer feature：Agent 实时剪辑

### 4.1 用户看到什么（只在 GUI 里体现，CUI 保持原样）

不新增光标、卡片、胶囊等新控件。**CUI 不加任何特殊 UI**：Agent 照常对话，开始时一句“我直接在时间线上改”，结束时一句总结，运行中只有现有的状态行。实时效果全部体现在 GUI：

| 现有位置 | Agent 剪辑时显示什么 |
|---|---|
| GUI 底部 `AgentStatusBar` | 当前这一步：“加字幕：第 2 句”“生成画中画素材 · 预计 3 秒”；完成后“已完成 6 处修改” |
| 时间线 Dock | 新 clip 出现、主轨磁吸让位、裁剪收缩都用位置/宽度过渡；正在被改的 clip 外发光 + 呼吸点；生成中的素材是 pending clip（虚线 + 进度填充 + spinner），完成后原地换成胶片 |
| 画布选中框（`DesignOverlay` 同款） | 落在 Agent 正在改的元素上，标签写成“Agent · 字幕” |
| 播放器 | 播放头跳到正在改的位置（跟随）；完成后从头播放一遍 |
| 手机 CUI 的 PiP 小窗（现有） | 播放这条时间线视频，所以在聊天里也能看到改动；不加额外标签 |

**跟随**：Agent 运行时播放头和画布默认跟随。用户一旦点时间线、点画布或拖动，跟随暂停；`AgentStatusBar` 用现有通知形态显示“Agent 仍在剪辑 · 已暂停跟随”，右侧现有 **See** 按钮恢复跟随。

**撤销**：Agent 的每个 tx 是撤销栈里的一步，入口在 Dock 底部行的撤销按钮。

### 4.2 数据流

```
Agent（LLM）
  │ edit_timeline({ baseRevision, label, ops })
  ▼
服务端 timeline service ── reducer + 校验 + 变基 ──▶ 持久化 doc + 追加 tx 流水
  │                                                   │
  │ SSE 事件 timeline_tx { txId, label, ops, revision, clipIds, cursor }   │ Supabase Realtime 广播 `timeline:{snapshotId}`
  ▼                                                   ▼
发起这次对话的页面                             其他打开该项目的页面 / CLI、后台 Agent 运行时
  └──────────────┬──────────────────────────────────────┘
                 ▼
        前端 TimelineStore.apply(tx)（同一个 reducer，结果立即一致）
                 ▼
        Choreographer：把 tx 的 ops 排成动画序列（逐 op 过渡 → 高亮被改的 clip → 跟随定位）
```

- 状态立刻生效，**动画只是展示层**：如果新的 tx 来了而上一个还在播放，上一个快进到结束，不会造成状态和画面不一致。
- 编排规则：每个 op 120–250ms，单个 tx 动画总长不超过 1.5s；超过 20 个 op 的 tx（例如 40 句字幕）按组动画；用户开启“减少动态效果”时只保留高亮。
- 后台 Agent / CLI（`makaron chat`）没有页面 SSE，一样通过 Realtime 广播，所以“在终端里让 Agent 剪辑，浏览器里实时看到”自然成立。
- 断线重连：按 revision 拉取缺失的 tx 补齐，不重播动画，只高亮变化区域。

### 4.3 Agent 工具

| 工具 | 说明 |
|---|---|
| `get_timeline` | 精简视图：轨道、clip（秒 + 帧）、素材、组件 props、当前 revision、用户当前选中的 clip（作为上下文） |
| `edit_timeline({ baseRevision, label, ops })` | 唯一的时间线写入口，返回新 revision、diagnostics 或 conflict |
| `preview_timeline({ at: seconds[] })` | 同一渲染产物截帧 / 联系表，用于自检 |
| `create_component`（即 `run_code` 的组件模式） | 写一个 React 组件并声明 `propsSchema`，之后用 `add_clip` 实例化 |
| `transcribe_to_captions({ assetId \| clipId })` | 调现有 ASR，返回 segment，Agent 再决定样式写入 |
| 现有 `generate_video / image / music / voiceover` | 增加可选参数 `place: { trackId, from }`：先插 pending clip，完成后由系统 tx `resolve_pending` 替换 |

Prompt 层面只写意图和一条重要的节奏规则：**一个用户可感知的步骤一个 tx，并给出简短 label**（先排镜头 → 再加字幕 → 再配乐 → 最后片尾），这样实时展示才有节奏感；不要把所有操作塞进一个巨大的 tx。

---

## 5. UI 设计：嵌进现有 GUI / CUI，不另起界面

### 5.0 可运行原型（第二轮）

- 路由：`/timeline-v2-prototype`，仅开发环境（生产 `notFound()`）。代码在 `src/app/timeline-v2-prototype/`。
- 复用：Editor 外壳布局、`AgentStatusBar`、画布控件（播放键 / 时间徽标 / 历史点轨 / Save）、CUI 气泡和输入框、`mkr-liquid-*` 类、真实 `@remotion/player`。新增：`TimelineDock`、`useFilmstrip`（抽帧方式同 `VideoRetakeTimeline`）。
- 打开后自动演示一遍 Agent 剪辑；可选中、改字、裁剪、分割、删除、拖动/拉角缩放画中画、撤销；手机可左右滑动定位。

第二轮评审意见与改法：

| 意见 | 改法 |
|---|---|
| CUI 不需要特殊 UI | 删除对话里的“时间码 + 步骤”行和阶段卡，Agent 只正常说话 |
| 缩略图差 | 主轨和画中画显示**真实逐帧胶片**（按 `sourceIn` 取帧，裁剪后看到的就是保留的画面），不再拉伸单张 poster |
| 轨道小、难用 | 桌面主轨 54px、元素轨 28–30px；空轨自动隐藏；去掉轨道图标列；clip 圆角 10px；可横向滚动，⌘+滚轮或 −/+ 缩放；最小 64px/秒 |
| 手机窄 | 手机播放头**固定在中间**，左右滑动时间线定位（剪映习惯），固定 58px/秒，所以短片段也有足够宽度；底部内容槽为时间线视频加高到 192px |
| 编辑器弹出一般 | **取消浮层编辑器**。选中后 Dock 底部那一行原地变成编辑行：文字 / 字幕是输入框（字幕编辑播放头下的那一句），视频是“名称 · 时长 · 素材起点 + 分割 / 删除 / 完成”；裁剪直接拖 clip 两端；画中画在画布上拖动和拉角缩放；双击画布文字直接进入输入框 |

### 5.1 原则

1. **只替换一个组件**：时间线视频在 Editor 底部内容槽显示 `TimelineDock`，其余（画布、顶栏、历史点轨、AgentStatusBar、CUI 面板 / 全屏、手势）不动。
2. **CUI 不变**。
3. **一个 Dock 内闭环**：浏览、选择、编辑、撤销都在 Dock 里完成，不弹浮层；画面上的位置和大小在画布上直接操作。
4. 只用现有 token：fuchsia 选中 / 手柄、白色透明度阶梯、pill 渐变、liquid 图标按钮。

### 5.2 桌面（≥1024px）

```
┌──────────── GUI 列 ────────────────────┐┌── CUI 面板（原样）──┐
│ ← +                               Save ││ 用户气泡           │
│          Remotion Player               ││ Assistant 文本      │
│          ┌Agent · 画中画┐               ││ ● 状态行            │
│ (▶)         ● ● ▬ Video     0:03/0:07  ││                    │
├────────────────────────────────────────┤│                    │
│ ● 生成画中画素材 · 预计 3 秒  AgentStatusBar│                    │
│ 0   1s   2s  (0:03.0)  4s   5s   6s     ││                    │
│          [◌ 画中画 38% ▓▓░░░░]           ││                    │
│  [T 东京夜色    ]                         ││                    │
│ [夜色从海底开始][霓虹醒来   ][这座城不睡 ] ││                    │
│ [▮▮▮▮▮▮▮ 2.2s][▮▮▮▮▮▮ 2.6s][▮▮▮▮▮▮ 2.8s] ││ ← 真实逐帧胶片     │
│ [∿∿∿∿∿∿∿∿∿∿ night.mp3 ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿]  ││                    │
│ 0:03.0 / 0:07.6                (−)(+)(↶)││ [ 输入框 ]          │
└────────────────────────────────────────┘└────────────────────┘
选中文字后底部行 →  [ 东京夜色                    ] (🗑)(✓)
选中视频后底部行 →  机器人 2.6s · 素材从 0.5s 开始      (⫼)(🗑)(✓)
```

- 轨道从上到下：画中画 / 文字 / 字幕 / 主轨 / 音频，上方轨道在画面上层；空轨隐藏。
- 时间刻度 20px，播放头是白线 + 顶部白色时间胶囊。
- 选中：2px fuchsia 描边 + 两端 10px fuchsia 裁剪手柄（同 `DesignVideoTrimEditor`）。
- Dock 总高约 260px（1440×900 下画布仍有约 600px 高）。
- 时间线视频不再显示画布底部的 2px 进度条，由时间线播放头取代。

### 5.3 手机（<1024px）

```
┌──────────────────────────┐
│ ← +                 Save │
│        Player            │
│ (▶)   ● ● ▬ Video   0:04 │
├──────────────────────────┤
│ ● 已完成 6 处修改    聊天 │ ← AgentStatusBar 原样
│         │                │
│   [◌ 画中画 49% ]│        │
│ [T 东京夜色]     │        │
│ …开始][霓虹醒来 ]│[这座城… │
│ [▮▮▮▮▮][▮▮▮▮▮▮▮│▮▮][▮▮▮ │ ← 播放头固定居中，左右滑
│ ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿│∿∿∿∿∿∿∿ │
│ 0:04.2 / 0:07.6      (↶) │ ← 选中后变编辑行
└──────────────────────────┘
```

- 内容槽 192px（Tips / pills 仍是 120.5px）：元素轨 20–22px，主轨 44px，音频 12px，底部行 48px。
- 轻点 clip 选中；左右滑动始终是定位（未选中的 clip 不响应拖动，避免误移）；选中后才能拖手柄裁剪 / 拖动位置（14px 宽手柄）。
- 编辑行的输入框 16px 字号（避免 iOS 自动放大），键盘弹起时 Dock 随 visualViewport 上移（复用现有 `keyboardInset` 处理）。
- CUI 保持全屏、返回手势不变；横向滑动区避开左缘 36px。

### 5.4 老视频（不兼容，优雅展示）

- 不做任何改变：老的 composition 视频继续显示今天的 `DesignEditPanel` pills 和浮层编辑器，播放、编辑、导出零回归。
- 工具行文字后加一句弱提示“时间线编辑适用于新视频”（11px white/25）。不加迁移按钮。

### 5.5 交互清单

| 操作 | 桌面 | 手机 |
|---|---|---|
| 定位 | 点 / 拖时间线空白处 | 左右滑动 |
| 缩放时间线 | ⌘ + 滚轮、−/+ | 固定（P2 可加双指） |
| 选择 | 点 clip / 点画布元素（双向同步） | 轻点 |
| 改文字 / 字幕 | 选中后底部行输入；或双击画布文字 | 同左 |
| 裁剪 / 改时长 | 拖两端手柄（主轨磁吸） | 选中后拖手柄 |
| 移动 | 拖 clip（主轨按顺序磁吸） | 选中后拖 |
| 分割 | 底部行分割按钮（在播放头处） | 同左 |
| 位置 / 大小 | 画布上拖动、拉角缩放 | 同左 |
| 删除 / 撤销 | 底部行按钮；⌘Z | 底部行按钮 |
| 恢复跟随 Agent | AgentStatusBar 的 See | 同左 |

时间线获得焦点时吞掉键盘快捷键。**产品实现时四种语言（zh / zh-Hant / ja / en）同批补齐；原型中文文案只用于评审。**

---

## 6. 开发计划

估算按“1 人 + Agent 协作、全天投入”的工作日，合计约 **18 个工作日**。M1 与 M3 的纯 UI 部分可以并行（M3 先用原型的内存文档开发），其余按顺序。

| 里程碑 | 工期 | 主要工作 | 关键文件 | 验收证据 |
|---|---|---|---|---|
| **M0 技术验证** | 2 天 | Remotion 全家桶 4.0.527 → 4.0.541；`<Track>` + `TransitionSeries` + 画中画 + 字幕在 Player / 浏览器 MP4 / Lambda MP4 三处一致；在独立 Remotion site 验证（不占用共享 `git-dev` alias）；iPhone Safari 上 3 段视频胶片抽帧耗时与内存；SSE + Realtime 推一个 tx 到页面的最小链路 | `package.json`、`src/remotion/index.tsx`、`src/lib/remotion-lambda-renderer.ts` | 三份 MP4 抽帧对比；iPhone 录屏；终端发 tx 浏览器实时变化 |
| **M1 协议内核** | 3 天 | `src/lib/timeline/`：Zod schema（MTP v1）、reducer（insert / update / remove / split / move、主轨磁吸、反向 op）、元素级变基与冲突、`compileTimeline()` → Remotion 树、给 Agent 用的 JSON Schema | `src/lib/timeline/*` | 单测：每个 op、撤销往返、两方并发改不同元素都保留、同元素冲突给出诊断 |
| **M2 存储与渲染** | 3 天 | `DesignPayload.timeline` 字段（`design_path` JSON 内）；`PATCH /api/projects/[id]/timeline/[snapshotId]`（按 revision 应用 tx，追加 `timeline-log/<snapId>.jsonl`）；`ImageCanvas` 识别时间线 design 走 `MakaronTimeline` 组件；Lambda 新 composition `makaron-timeline` 与浏览器导出；pending clip 占位 | `src/types`、`src/app/api/...`、`ImageCanvas.tsx`、`src/remotion/` | 本地真实项目：新建 → 编辑 → 刷新一致 → 导出 MP4 与预览一致 |
| **M3 GUI 时间线** | 4 天 | 原型 Dock 产品化到 `src/components/timeline/`；`Editor.tsx` 底部槽增加 `isViewingTimeline` 分支（手机 192px）；画布选中复用 / 扩展 `DesignOverlay`（clip 选择、拖动、拉角缩放）；底部编辑行；把 `VideoRetakeTimeline` 的抽帧提取成共享 `useVideoFrames`；老视频保持 pills + 提示；四语言；iOS 手势与键盘 | `Editor.tsx`、`ImageCanvas.tsx`、`DesignOverlay.tsx`、`VideoRetakeTimeline.tsx`、`src/lib/locales/*` | 桌面 + iPhone 真机：改字、换素材、裁剪、分割、删除、画中画拖动缩放、字幕逐句改、撤销；老视频零回归 |
| **M4 Agent 实时剪辑** | 4 天 | 工具 `get_timeline` / `edit_timeline` / `preview_timeline`；`generate_*` 加 `place` 参数先插 pending；prompt 节奏规则（一步一个 tx）；`/api/agent` SSE 增加 `timeline_tx` 事件 + Supabase Realtime 广播 `timeline:{snapshotId}`；前端 `TimelineStore` + 动画编排（过渡、发光、跟随、See 恢复）；CLI / 后台运行同样可见；CUI 不改 | `src/app/api/agent/route.ts`、Agent 工具目录、`src/components/timeline/` | 真实对话：Agent 把素材剪成带字幕和配乐的视频，全过程在 GUI 实时可见；运行中用户改字不被覆盖；撤销 Agent 某一步；终端 CLI 发起、浏览器实时看到 |
| **M5 验收与发布** | 2 天 | 真实项目流程回归、Preview / Export 一致性、性能（长视频 60s+ 胶片与滚动）、Vercel Preview 验收、changelog、合并 dev → 生产 | — | 发布门禁：真实项目流程 + Preview/Export 一致 + 双端交互 + 四语言 |

依赖与顺序：M0 → M1 → M2 → M4；M3 在 M1 的 schema 定下后开始，和 M2 并行，最晚在 M4 前接上真实存储。M0 的抽帧性能结论决定 M3 是前端抽帧还是服务端生成胶片图。

---

## 7. 风险与开放问题

- **多 clip 预览卡顿**（Safari `<Sequence>` 切换）：时间线化后更明显，P2 起接入 proxy track（`codex/remotion-preview-proxy-track` 的成果）。
- **字体**：文字/字幕改字引入新字符时需刷新字体子集而不重编译组件。
- **Agent 自由度 vs 结构**：组件逃生舱保证创造力；需要观察 Agent 是否过度依赖 `component` 而不用结构化元素——prompt 里明确“能用结构化元素就用结构化元素，组件只用于样式和特效”。
- **Realtime 成本与顺序**：tx 按 revision 有序应用，乱序时按 revision 补拉；广播只发 tx，不发整份文档。
- **共享 Preview 环境**：Lambda runtime 与 Snapshot 变更不能占用共享 `git-dev` alias（AGENTS.md）。


## 8. 实现记录（2026-11-06 03:25 CST）

### 8.1 与计划的差异（有意为之）

- **不升级 Remotion、不新建 Lambda composition**。时间线视频 = 一个 design：`code` 是固定的时间线运行时（`src/lib/timeline/runtime-code.ts`，首行 `// makaron-timeline-runtime v1`），`props.timeline` 是 MTP v1 文档。预览（Player）、浏览器导出、Lambda `dynamic-design`、海报截图、字体固定、导出媒体预处理全部沿用现有链路，所以 Preview / Export 一致性直接继承，不碰共享 Lambda 站点。运行时只用两端都有的 scope（Sequence、Video、Audio、Img、AbsoluteFill、interpolate）。以后要用 `<Track>` 时再 bump 运行时版本，旧视频保留各自保存的代码。
- **实时链路用现有 SSE + agent_events 回放**，没有另开 Supabase Realtime broadcast：`edit_timeline` 产生 `timeline_tx` 事件，DualWriter 写入 `agent_events` 并推 SSE；后台运行 / 重连通过 `useAgentRun` 回放，按 revision 去重。
- **服务端以工作区 design JSON 为唯一持久副本**：用户编辑走 `POST /api/projects/[id]/snapshots/[snapshotId]/timeline`（同一 reducer、元素级变基、冲突 409 回传最新文档）；旧的 design 保存路由和截海报保存不会把时间线回滚到更低 revision。暂未单独写 `timeline-log` 流水文件（Agent 每步在 agent_events 里有记录）。

### 8.2 已交付范围

- 协议与 reducer：insert / update / remove / split / set_meta，主轨磁吸，反向 op（撤销），pending→成片原地替换，原子事务，按元素变基与冲突。单测 `__tests__/timelineReducer.test.ts`、`timelineRuntime.test.ts`。
- 编辑器：底部内容槽的 TimelineDock（真实逐帧胶片、空轨隐藏、缩放滚动、手机 192px + 居中播放头）、内联编辑行（文字 / 字幕逐句 / 分割 / 删除）、裁剪手柄、主轨拖动换序、画布选中 / 拖动 / 拉角缩放、撤销（Agent 每步一格）、跟随与 See 恢复、手机键盘上移。
- Agent：`create_timeline` / `get_timeline` / `edit_timeline`（媒体可用 `<<<media_N>>>`），当前视频为时间线视频时的上下文与路由，`preview_frame({snapshot_id})` 直接可用；两件工具纳入 durable 输入版本守卫。
- 老视频：原 pills 与浮层编辑器不变，工具行多一句“时间线编辑适用于新视频”。四语言文案齐全。

### 8.3 本地验收证据（测试账号，本地 dev + 共享数据库）

- 真实 Agent（gpt-6-luna / Azure 回退）：一句话“三段素材剪成竖版 + 音乐 + 标题 + 三句字幕” → `create_timeline` 出主轨与音乐，随后两次 `edit_timeline` 依次加标题、字幕，页面实时出现并发光、播放头跟随。
- 第二轮“字幕改黄色高亮 + 右下角画中画 3–7 秒”：Agent 先读时间线，分两步改；保留了用户刚手改的标题“东京夜游”。运行结束后状态不回退（修复了快照合并回滚的问题）。
- 用户编辑：改标题、选择、拖画中画、撤销，刷新后保持。
- 导出：Lambda（`makaron-media-transport-20261103-v4` 站点）9 秒 720×1280 带音轨，1.5 / 4.5 / 7.5 秒抽帧与预览一致（标题、黄色高亮字幕、画中画位置）。
- 门禁：`tsc` 全量通过；vitest 全量通过；i18n 守卫通过；外部 Skill 路由预检 3/3（未执行媒体操作）。
- 注意：本地 `.env.local` 里的 `REMOTION_LAMBDA_SERVE_URL` 指向 2026-10-09 的旧站点（没有运行时标记），本地导出会报 site version mismatch；验收时用 worktree 本地 `.env.development.local` 覆盖到 v4 站点，未改共享配置。

### 8.4 已知限制 / 后续

- 生成中的素材：Agent 可以先插 pending clip 再替换，但异步生成完成后**不会自动**回填 pending clip（需要 Agent 在同一运行内或下一轮替换）。自动回填需要接三条视频轮询路径，单独排期。
- 字幕逐句边界拖动、关键帧、节拍吸附、剪辑过程回放未做（P5）。
- Agent 组件（`component` clip + propsSchema）未做；精心设计的动效仍走 run_code 经典合成。
- 两次写入同一时间线文件之间没有存储层 CAS（读-改-写），极端并发下后写覆盖先写；客户端会在下一次响应或冲突时重新同步。
- CLI：时间线工具在服务端 Agent 内可用，`makaron chat` 不需要改包；本次不发布 npm（发布前按 release checklist 复核）。

### 8.5 发布记录（2026-11-06 03:50 CST）

- 门禁：独立 runner（`--path /Users/tianyicai/ai-image-editor-runner-timeline`，默认 runner 有他人 9 月未提交改动，未动）跑 `runner:test` 全量通过（skill-sync、tsc、vitest 387 文件、CLI 测试、webpack build + 运行时打包检查）。合并 origin/dev 后重跑外部 Skill 路由预检 3/3、门禁再次全过。
- Preview：`runner:preview` 独立部署（未占用 `git-dev` alias），首页 200、`/api/health` 全部 healthy、新时间线 API 已部署（未登录 401）。未在 Preview 登录测试账号。
- Production：dev 快进到 70209385 并推送，`npm run release:prod` 门禁全过后部署，`www.makaron.app` 已切换，`/api/health` 13/13 healthy。
- 生产真实导出：同一时间线视频经生产 `/api/remotion/export`（Lambda）导出 9 秒 720×1280 带音轨，4.5 秒帧与本地 Lambda 导出一致。
- 未改任何 Vercel 环境变量、Lambda 站点或 Snapshot 配置。CLI / npm：时间线工具在服务端 Agent 内生效，`makaron chat` 无需改包，本次不发 npm。
- 环境提醒：本地 `.env.local` 的 `REMOTION_LAMBDA_SERVE_URL` 仍指向 10-09 旧站点，本地导出会失败（生产不受影响）；如需本地导出，改到 `makaron-media-transport-20261103-v4` 或更新站点。
