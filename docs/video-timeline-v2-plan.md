# Makaron 视频时间线 V2：方案与设计（第二版）

> 状态：方案稿，2026-11-05 CST。未实现、未合并、未上线。
> 分支：`claude/video-timeline-v2`（基于 `origin/dev` 0df70536）。
> UI 原型：开发环境打开 `/timeline-v2-prototype`（代码 `src/app/timeline-v2-prototype/`），基于真实 Editor 结构和组件搭建，含 Agent 实时剪辑演示。

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

- 点时间线上的 clip → 画布高亮该元素 → 属性条出现该元素的字段。
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
- **自定义组件**承接 Agent 的创造力：`run_code` 以后写的是 `ComponentDef`（一个标题动画、一个片头、一个转场），由时间线实例化。组件用 `propsSchema` 声明可编辑字段，所以 Agent 写的任何东西依然能在属性条里编辑——这就是“所有之前 editable 能编辑的东西”的延续。
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

### 4.1 用户看到什么（全部落在现有 GUI / CUI 结构里）

不新增光标、卡片、胶囊等新控件；Agent 的每一步改动通过下面这些**现有位置**体现。原型见 §5.0。

| 现有位置 | 今天显示什么 | Agent 剪辑时显示什么 |
|---|---|---|
| GUI 底部 `AgentStatusBar` | 呼吸点 + Agent 状态文字 | 当前这一步：“加字幕：第 2 句”“生成画中画素材 · 预计 3 秒”；完成后“已完成 6 处修改” |
| GUI 底部内容槽（Tips / pills / 视频卡同一位置） | design 的 editable pills | **TimelineDock**：被改的 clip 用现有 `mkr-liquid-pill-selected` 发光 + 同款呼吸点；新 clip 用现有 `animate-tip-in` 出现；主轨磁吸让位用宽度/位置过渡 |
| 画布 `DesignOverlay` 选中框 | fuchsia 框 + 角标 + 名称标签 | 同一套框落在 Agent 正在改的元素上，标签写成“Agent · 字幕” |
| 画布播放器 | 自定义播放/时间/进度条 | 播放头跳到正在改的位置（跟随）；完成后从头播放一遍 |
| CUI 消息流 | 用户气泡、Assistant 文本、Studio Run 阶段卡 | Assistant 文本下方用 Studio Run `TimedItems` 同款“时间码 + 文本”行逐条追加每一步；点击一行 = 选中该 clip 并定位 |
| CUI 消息底部状态行 | 脉冲点 + 12px 状态文字 | 同 AgentStatusBar 的当前步骤 |
| 手机 CUI 的 PiP 小窗 | 当前图片 | 直接播放这条时间线视频，Agent 改动实时可见，底部一枚 fuchsia 标签写正在改的元素 |
| 生成中的素材 | 画布 spinner “AI 正在生成…” | 时间线上的 pending clip：虚线边框 + 同款 spinner + 百分比；画面上同位置显示占位框，完成后原地替换 |

**跟随**：Agent 运行时播放头和画布默认跟随。用户一旦点时间线、点画布或拖动，跟随暂停；`AgentStatusBar` 用现有通知形态显示“Agent 仍在剪辑 · 已暂停跟随”，右侧现有 **See** 按钮恢复跟随。

**撤销**：Agent 的每个 tx 是撤销栈里的一步，入口就是时间线 Dock 工具行的“撤销”。不在对话行上另加按钮。

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

### 5.0 可运行原型

- 路由：`/timeline-v2-prototype`，仅开发环境（生产 `notFound()`）。代码在 `src/app/timeline-v2-prototype/`。
- 直接复用真实组件：`AgentStatusBar`、`DesignEditorFrame` + `DesignFieldEditor`（文字编辑和视频裁剪编辑器原样复用）、`StudioRunStageCard`、播放按钮 / 时间徽标 / 进度条 / 历史点轨 / Save / 输入框的原 class 与样式。播放用真实的 `@remotion/player`，素材用 `public/home-hero` 视频和 `public/home-studio/night.mp3`。
- 新增的只有 `TimelineDock`（以及原型用的文档、reducer 和 Remotion 编译）。
- 打开后自动跑一遍脚本化的 Agent：剪短开头 → 逐句加 3 句字幕 → 画中画 pending → 揭开。可在输入框再次发送来重跑。改字、拖 clip、裁剪、拖画中画、撤销都能操作。
- 设计稿 HTML（`docs/design/video-timeline-v2-mockup.html`）已删除：它自造了一套界面，不再作为依据。

### 5.1 原则

1. **时间线视频复用现有布局**：只替换底部内容槽里的那一个组件，其他（画布、顶栏、历史点轨、AgentStatusBar、CUI 面板 / 全屏、手势）全部不动。
2. **新控件用现有词汇拼**：clip = `mkr-liquid-pill` + pill 渐变；选中 = `border-fuchsia-500 ring-1 ring-fuchsia-500/50`（同 editable pill）；裁剪手柄 = `DesignVideoTrimEditor` 的 fuchsia 手柄 + 黑色握把；播放头 = `VideoRetakeTimeline` 的白线 + 三角；工具行 = `DesignEditPanel` 的 “Design · N editables” 11px 文字行。
3. **编辑器不重写**：选中元素后点 Edit 或双击，打开今天的 `DesignEditorFrame`（桌面浮在 GUI 左下 bottom:160 / left:12，手机在底部槽内联替换）。文字用 `DesignTextEditor`，视频用 `DesignVideoTrimEditor`，图片 / 画中画在画布上用 `DesignOverlay` 拖动和缩放。
4. 颜色只用现有 token：fuchsia 系、白色透明度阶梯；不引入新的轨道配色。

### 5.2 桌面（≥1024px）

```
┌──────────── GUI 列（flex-1）────────────┐│┌──── CUI 面板 500px（可拖宽，原样）────┐
│ ← +                               Save ││ │ 用户气泡                             │
│                                        ││ │ ● 合成制作 已完成  Studio Run 6/8     │
│      Remotion Player（9:16 居中）       ││ │ Assistant：第一版已经放到时间线上…    │
│      ┌Agent · 字幕┐ ← DesignOverlay 框   ││ │ 用户：开头剪短一点，加上字幕…        │
│ (▶)        ● ● ▬ Video        0:05/0:07││ │ Assistant：好，我直接在时间线上改：   │
│━━━━━━━━━━━━━━━━━ 进度条 ━━━━━━━━━━━━━━━━││ │ 0:00  开头缩短 1 秒，后续片段前移     │
├────────────────────────────────────────┤│ │ 0:00  字幕「夜色从海底开始」         │
│ ● 加字幕：第 2 句          AgentStatusBar││ │ 0:02  画中画 · 生成中 …              │
│ 0s   1s   2s   3s   4s   5s ...  刻度   ││ │ ● 加字幕：第 2 句     ← 状态行       │
│ ▣ [   画中画 38% ◌   ]                  ││ ├──────────────────────────────────────┤
│ T [东京夜色]                            ││ │ [ 让 Agent 改时间线…           (↑) ] │
│ 字 [夜色从海底开始|霓虹醒来|这座城不睡]   ││ └──────────────────────────────────────┘
│ ▶ [水母][机器人][时装]   ┃ 播放头         ││
│ ♪ ∿∿∿∿∿∿∿ night.mp3 ∿∿∿∿∿∿∿∿∿∿∿∿∿∿     ││
│   Timeline · 0:03.2 / 0:07.6 · 撤销      ││  ← 选中时变成：标题 · 0:00.2–0:02.8 [Edit] 删除
└────────────────────────────────────────┘│
```

- 轨道从上到下：画中画 / 文字 / 字幕 / 主轨 / 音频，上方轨道在画面上层。左侧 26px 轨道图标格沿用 pill 的图标格（`rgba(255,255,255,.045)` 底 + white/30 图标）。
- 轨道高度：画中画 / 文字 / 字幕 26px，主轨 46px（poster 封面），音频 22px（波形）。
- 时间线默认铺满宽度；长视频时可横向滚动和缩放（P3 加）。

### 5.3 手机（<1024px）

- **GUI**：画布 + 原有控件不变；底部仍是 `AgentStatusBar`（带“聊天”按钮）+ 120.5px 内容槽（`MOBILE_EDITOR_SLOT_HEIGHT`），槽内放 TimelineDock 紧凑版：画中画 / 文字 / 字幕各 12px（9px 标签），主轨 24px，音频 5px 细条，下面一行工具行。
- 选中 clip 后点 Edit：`DesignEditorFrame` 按今天的方式在同一个 120.5px 槽内联替换时间线，键盘弹起时随之上移；关闭后时间线回来。
- **CUI**：仍是全屏、右侧滑入、左上返回、左缘右滑返回。唯一变化是 PiP 小窗里播放这条时间线视频，所以用户在聊天里也能看到 Agent 改出来的画面。
- 时间线横向手势区避开左缘 36px（与现有返回手势阈值一致）。

### 5.4 老视频（不兼容，优雅展示）

- 不做任何改变：老的 composition 视频继续显示今天的 `DesignEditPanel` pills（“Design · N editables”），播放、编辑、导出零回归。
- 唯一新增：工具行文字后面加一句弱提示“时间线编辑适用于新视频”（11px white/25）。不加迁移按钮。

### 5.5 交互清单

| 操作 | 桌面 | 手机 |
|---|---|---|
| 定位 | 点时间线空白处 / 拖动 | 同左 |
| 选择 | 点 clip，或点画布上的元素（双向同步） | 同左 |
| 编辑内容 | 工具行 Edit / 双击 clip → 现有 DesignEditorFrame | 工具行 Edit |
| 裁剪 / 改时长 | 拖 clip 两端 fuchsia 手柄（主轨磁吸，后面自动前移） | 同左 |
| 移动 | 拖 clip（主轨按顺序磁吸，其它轨自由放置） | 长按后拖（P3） |
| 位置 / 大小 | 画布上拖选中框（画中画、文字） | 同左 |
| 删除 | 工具行“删除” | 同左 |
| 撤销 | 工具行“撤销” / ⌘Z（Agent 的一个 tx 是一步） | 工具行“撤销” |
| 恢复跟随 | AgentStatusBar 的 See | 同左 |

时间线获得焦点时吞掉键盘快捷键，避免触发项目级上一张/下一张。**产品实现时四种语言（zh / zh-Hant / ja / en）同批补齐；原型里的中文文案只用于评审。**

---

## 6. 分期与验收

| 阶段 | 内容 | 验收证据 |
|---|---|---|
| P0 Spike | 升级 Remotion 4.0.541；`<Track>` + `TransitionSeries` + overlay 画中画 + 字幕在 Player / 浏览器 MP4 / Lambda MP4 三处一致；SSE + Realtime 推送一个 tx 到页面的最小链路 | 三份 MP4 逐帧对比；录屏：终端发 tx，浏览器实时出现 |
| P1 协议内核 | Zod schema、reducer（含主轨磁吸、split、元素级变基、反向 op）、compile、Agent JSON Schema 生成 | 单测 + 冲突/变基用例 |
| P2 渲染与存储 | `MakaronTimeline` 组件、组件 hash 缓存、pending 占位、design JSON 存取、tx 流水、Lambda composition | 本地项目页真实播放、保存重开一致、导出一致 |
| P3 时间线 UI | 把原型的 TimelineDock 正式接入 Editor 底部内容槽：五类轨道、画布↔时间线双向选择、复用 DesignEditorFrame 编辑、字幕逐句编辑、画中画、移动端紧凑版、长视频滚动缩放、老视频保持 pills | 桌面 + iPhone 真机：覆盖旧 editable 的全部能力（改字、换图、换视频+裁剪、拖位置、缩放）+ 字幕 + 画中画 |
| P4 Agent 实时剪辑 | 工具、prompt 节奏规则、Choreographer、跟随 / See 恢复、AgentStatusBar 与 CUI 时间码行、pending clip、PiP 实时播放、CLI/后台广播 | 真实对话：Agent 从素材剪出 30 秒带字幕配乐视频，全过程实时可见；中途用户改字不被覆盖；撤销 Agent 某一步 |
| P5 打磨 | 关键帧、节拍吸附、剪辑过程回放（需要时再设计入口） | 演示视频 |

发布门禁：单测或 Agent 任务通过不算发布证据，必须是真实项目流程 + Preview/Export 一致 + 双端交互 + 四语言。

## 7. 风险与开放问题

- **多 clip 预览卡顿**（Safari `<Sequence>` 切换）：时间线化后更明显，P2 起接入 proxy track（`codex/remotion-preview-proxy-track` 的成果）。
- **字体**：文字/字幕改字引入新字符时需刷新字体子集而不重编译组件。
- **Agent 自由度 vs 结构**：组件逃生舱保证创造力；需要观察 Agent 是否过度依赖 `component` 而不用结构化元素——prompt 里明确“能用结构化元素就用结构化元素，组件只用于样式和特效”。
- **Realtime 成本与顺序**：tx 按 revision 有序应用，乱序时按 revision 补拉；广播只发 tx，不发整份文档。
- **共享 Preview 环境**：Lambda runtime 与 Snapshot 变更不能占用共享 `git-dev` alias（AGENTS.md）。
