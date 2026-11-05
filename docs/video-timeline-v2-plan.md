# Makaron 视频时间线化 V2：方案与设计

> 状态：方案稿（2026-11-05 CST），尚未开始实现、未合并、未上线。
> Worktree：`.claude/worktrees/makaron-video-timeline-upgrade-7fec73`，分支 `claude/makaron-video-timeline-upgrade-7fec73`。
> 配套 UI 稿：[`docs/design/video-timeline-v2-mockup.html`](design/video-timeline-v2-mockup.html)

## 0. 一句话结论

**把每条 Makaron 视频从“一段 Agent 写的 React 组件 + 扁平 props”升级为“一份 `TimelineProject` JSON 驱动的 Remotion 合成”**：

- React（scene 代码）决定**画面长什么样**；
- Timeline 协议决定**什么时候出现、出现多久、叠在哪一层**；
- Player 预览、截帧、浏览器导出、Lambda 导出都吃同一份编译产物；
- UI 和 Agent 改的是同一份文档，通过同一个 reducer 和同一套 revision 机制。

我们不从零开始：`codex/editable-timeline-project`（8 月，22 个独立提交、未合并、已落后 dev 791 个提交）已经做出协议内核和编译器，V2 在它的基础上做**收敛 + 对齐 Remotion 新能力 + 补齐迁移和 UI**。

---

## 1. 调研：Remotion 最近“更新的时间线”到底是什么

| 事实 | 版本 / 日期 | 对我们的意义 |
|---|---|---|
| Remotion Studio“全新时间线体验”：`<Track>` / `<Series>` / `<TransitionSeries>` 默认在 Studio 时间线上显示为共享轨道（PR #12228） | v4.0.536，2026-10-16 | 说明 Remotion 官方的时间线模型就是“轨道 + 不重叠 clip”，和我们要做的协议同构 |
| 核心包新增 `<Track>` 组件：`name / width / height / showInTimeline / hidden / freeze` + 标准时间 props（`from / durationInFrames / trimBefore / trimAfter / playbackRate / loop`）；同一 Track 上 clip 重叠会抛错；不产生 DOM | v4.0.534+ | **编译器输出目标**：我们的 track 直接编译成 `<Track>`，免费得到“同轨不重叠”的运行时校验，并兼容 Studio 和 OTIO 导出 |
| Studio 新增 rolling edit、波形/缩略图缓存、虚拟化轨道、undo/redo（PR #12875） | v4.0.53x | UI 交互参考（不能直接嵌入我们的 Player） |
| Studio Interactivity：时间线/画布上的编辑写回源码（`Interactive.Div` 等） | v4.0.475+ | “编辑写回代码”这条路对用户产品不适用（要求本地源码 + Studio），**不采用** |
| `@remotion/timeline-utils`（波形、filmstrip） | 4.0.541，标注 internal | 可以参考实现，**不依赖**（非公开 API） |
| 付费 **Remotion Timeline**（复制 `timeline/` 文件夹，Tailwind，`TimelineProvider/Timeline/ZoomSlider/CanvasComposition`） | 无公开 changelog | 交互现成，但状态结构不公开、风格要重做，见 §7 决策点 |
| 付费 **Editor Starter**：`UndoableState = { tracks, assets: Record, items: Record, fps, compositionWidth, compositionHeight, deletedAssets }`，item 类型 Image/Text/Video/Gif/Solid/Audio/Captions，50 步 undo，Lambda 渲染 | — | **数据形状对齐参考**：规范化 `items/assets` 字典 + `tracks[]` 只存 id 顺序 |
| 官方 skill `export-opentimeline`：composition → OTIO（Resolve / Premiere） | — | 协议定好后可以零成本获得“导出到专业剪辑软件” |
| 当前最新 v4.0.541（2026-11-05），没有 5.x；Makaron 锁在 **4.0.527** | — | 需要升级到 ≥4.0.536 才能用 `<Track>` |

**判断**：Remotion 官方现在的方向是“代码即时间线”（Track 写在 JSX 里，Studio 从运行时读出来），这适合开发者，不适合我们的终端用户。Makaron 应采用 **JSON 为唯一真相 → 编译成 `<Track>/<Sequence>/<TransitionSeries>`** 的路线（Editor Starter 的路线），同时利用 Remotion 的运行时 sequence 注册机制做**旧视频迁移**（§4）。

---

## 2. 现状（本 worktree 基线）

- 视频 = `DesignPayload { code, props, editables, animation{fps,durationInSeconds} }`，存在 workspace `code/<snapId>.json`（`snapshots.design_path`）。
- 时间信息藏在 Agent 写的 JSX 里（`<Sequence from>`、`trimBefore`）或者任意 props 数组里；GUI 只能改 props，改不了“时间”。
- 可编辑属性靠 `editable-manifest` 推断，变换/裁剪存成扁平 props：`_pos_<id>`、`_scale_<id>`、`_trimBefore_<id>`。
- 预览 `RemotionRenderer`（`@remotion/player`）、导出 `renderMediaOnWeb` / Lambda `dynamic-design` composition，全部吃 `{code, designProps}`。
- 现在说的“timeline”其实是**版本快照条**（`timeline-utils.ts` / `timeline-derivations.ts`），和合成时间线是两回事。V2 里把新东西统一叫 **“剪辑时间线（Edit Timeline）”**，代码命名 `timelineProject`，避免再混淆。

历史尝试：

| 分支 | 做了什么 | 结论 |
|---|---|---|
| `codex/editable-timeline-project`（未合并） | `TimelineProject` Zod schema、`compileTimelineProject → RenderPlan/RenderBundle`、事务 reducer + revision 冲突、`TimelineComposition`、`EditableTimelineDock` UI、5 种 clip | **内核可复用**；问题是没合并、落后太多、transition/effect 未实现、旧视频只能整段包成一个 clip |
| 2026-07 `ai-image-editor-remotion-timeline-editor` | 在现有 Player 上做剪辑 UI（拉伸、缩放、紧凑/展开） | 教训：**旧 composition 必须真的映射成 clip**，壳子不算数；时间线获得焦点时要吞掉键盘快捷键 |
| `codex/remotion-preview-proxy-track`（未合并） | 多 clip 预览卡顿的 proxy 轨 | 时间线化后更依赖它，作为性能保障并入 Phase 3 |

---

## 3. 时间线协议：Makaron Timeline Protocol（MTP）v2

### 3.1 设计原则

1. **JSON 是唯一真相**。时间语义只存在于 `timelineProject`，不再双写到 `design.props`，运行时永远不用正则从源码猜时间。
2. **两张正交的图**（沿用 v1）：Editable 节点图（`sceneId / nodeId`，管长相）和时间图（`clipId / trackId / assetId`，管时间）。同一个 scene 可以被多个 clip 复用，每个 clip 可以有自己的覆盖值。
3. **整数帧**。所有时间字段都是 frame；对外的秒只在 Agent / CLI 输入边界换算（与“外部 clip 合同用秒”的约定一致）。
4. **规范化存储**（对齐 Editor Starter）：`tracks[]` 只存顺序和 clipId，`clips / assets / scenes` 存字典，方便事务 patch 和 diff。
5. **一个编译器、一个 reducer**：UI、Agent、CLI、迁移脚本都只能通过 `applyTransaction` 改文档，通过 `compile` 出渲染计划。

### 3.2 文档结构

```ts
interface TimelineProject {
  kind: 'makaron-timeline';
  schemaVersion: 2;
  revision: number;                       // CAS，每次事务 +1
  canvas: { width: number; height: number; fps: number };
  duration: { type: 'story' } | { type: 'fixed'; frames: number };

  tracks: Track[];                        // 数组顺序 = 图层顺序（上层在后）
  clips: Record<ClipId, Clip>;
  assets: Record<AssetId, Asset>;         // 视频/图片/音频/字体，带来源和 poster
  scenes: Record<SceneId, SceneRef>;      // React scene：源码路径 + hash + 节点清单
  transitions: Record<TransitionId, Transition>;  // 只存在于 story 轨相邻 clip 之间
  overrides: Record<`${ClipId}/${NodeId}`, NodeOverride>;

  migration?: { from: 'legacy-design'; method: 'native' | 'runtime-capture' | 'wrap'; confidence: number; sourceHash: string; at: string };
}

interface Track {
  id: TrackId;
  kind: 'story' | 'overlay' | 'text' | 'audio' | 'caption';
  label: string;
  layout: 'magnetic' | 'free';   // story 固定 magnetic：clip 首尾相接，删除/拉长自动 ripple
  muted?: boolean; hidden?: boolean; locked?: boolean;
  clipIds: ClipId[];              // magnetic 轨按此顺序排列；free 轨仅作索引
}
```

### 3.3 Clip

```ts
type Clip = SceneClip | VideoClip | ImageClip | AudioClip | TextClip | CaptionClip;

interface ClipBase {
  id: ClipId; trackId: TrackId; label: string;
  placement:
    | { type: 'magnetic' }                                        // 仅 story 轨
    | { type: 'absolute'; from: number }
    | { type: 'attached'; to: ClipId; edge: 'start' | 'end'; offset: number };  // 跟随某个 story clip
  durationInFrames: number | { type: 'to-end' };                  // to-end：铺满到项目结尾（背景音乐）
  playbackRate?: number;
  opacity?: number; volume?: number;                              // volume 支持 0..1 或关键帧数组（Phase 4）
  props?: JsonRecord;
}

interface SceneClip extends ClipBase { kind: 'scene'; sceneId: SceneId; sceneIn: number }   // 新增 sceneIn
interface VideoClip extends ClipBase { kind: 'video'; assetId: AssetId; sourceIn: number }
interface AudioClip extends ClipBase { kind: 'audio'; assetId: AssetId; sourceIn: number; fadeIn?: number; fadeOut?: number }
interface ImageClip extends ClipBase { kind: 'image'; assetId: AssetId; fit?: 'cover' | 'contain'; motion?: 'none' | 'ken-burns' }
interface TextClip  extends ClipBase { kind: 'text'; presetId: string; text: string; style?: JsonRecord }
interface CaptionClip extends ClipBase { kind: 'caption'; assetId: AssetId /* 词级时间轴 JSON */; presetId: string }

interface Transition {
  id: TransitionId; fromClipId: ClipId; toClipId: ClipId;   // 必须是 story 轨上的相邻 clip
  presentation: 'fade' | 'slide' | 'wipe' | 'flip' | 'clock-wipe' | 'custom';
  durationInFrames: number; direction?: string; customSceneId?: SceneId;
}
```

相对 v1 的收敛点（每一条都有理由）：

| v1 | v2 | 为什么 |
|---|---|---|
| `sequence / absolute / relative` + `fixed / until / project-rest` 六种组合 | `magnetic / absolute / attached` + `frames / to-end` | v1 的组合在 UI 上无法解释；剪映/CapCut 的心智就是“主轨磁吸 + 其他元素可以吸附到主轨片段”，够覆盖 95% |
| scene clip 没有入点 | `SceneClip.sceneIn` | **旧视频切分的关键**：一个整段旧 composition 切成两半 = 两个 clip 引用同一个 scene，`sceneIn` 不同 |
| transition 是一种 clip，未实现 | 独立 `transitions` 字典，编译到 `@remotion/transitions` 的 `TransitionSeries` | 转场本质是“边”不是“片段”；和 Remotion 语义一致，会让 story 总时长缩短重叠帧 |
| `effect` / `component` 轨，报 capability error | 删除；特效 = scene（自定义 React） | 不承诺做不到的东西；Agent 想要特效就写 scene |
| 新增 | `text` / `caption` 一等 clip | 文字和字幕是用户最常改的东西，必须不经过 Agent 就能增删、拖动 |
| 节点覆盖存 `transform / mediaTrim` | 保留，key 改成 `clipId/nodeId` 的字典 | 便于 O(1) patch；继续禁止把 `_pos_*` 写进 canonical 文档（只在运行时投影） |

### 3.4 事务（UI 与 Agent 共用）

```ts
applyTransaction(project, {
  expectedRevision: 7,
  label: '把开场延长到 3 秒',        // 进 undo 栈和 Agent 时间线卡片
  origin: 'user' | 'agent' | 'migration',
  ops: [
    { op: 'set_duration', clipId: 'c_intro', frames: 90 },
    { op: 'set_override', clipId: 'c_intro', nodeId: 'title', values: { title: '新标题' } },
  ],
}) → { ok: true, project, revision: 8 } | { ok: false, code: 'revision_conflict' | 'invalid', diagnostics }
```

操作集合：`insert_clip / remove_clip / move_clip（跨轨、改顺序）/ set_duration / trim（左右）/ split / set_speed / set_placement / upsert_asset / upsert_scene / set_override / clear_override / upsert_transition / remove_transition / upsert_track / set_track_flags`。

- reducer 先应用到候选文档 → schema 校验 → 语义校验（引用、`attached` 无环、源素材边界、同轨重叠、transition 相邻且不长于两侧 clip）→ 原子提交，revision +1。
- **undo/redo 存的是反向事务**，不是整份快照（对齐 Editor Starter 的 50 步，但更省内存，也天然可同步给 Agent）。
- Agent 的过期写入拿到 `revision_conflict`，必须重新读再改，不会覆盖用户刚在画布上的修改。

### 3.5 编译与渲染

```
TimelineProject ──compileTimeline()──▶ RenderPlan（解析后的整数帧排程、z 序、资源表、每 clip 的有效 props）
                                         │
              ┌──────────────────────────┼─────────────────────────────┐
         Player 预览                 截帧/poster                  浏览器 MP4 / Lambda MP4
   <MakaronTimeline plan={…}/>   renderStillOnWeb(同组件)    renderMediaOnLambda('makaron-timeline', inputProps=bundle)
```

`MakaronTimeline` 组件的结构（Remotion ≥ 4.0.536）：

```tsx
<AbsoluteFill>
  {plan.tracks.map((t) =>
    t.kind === 'story'
      ? <Track key={t.id} name={t.label}>
          <TransitionSeries>{/* scene/video/image clip + TransitionSeries.Transition */}</TransitionSeries>
        </Track>
      : <Track key={t.id} name={t.label} hidden={t.hidden}>
          {t.clips.map((c) => <Sequence key={c.id} from={c.from} durationInFrames={c.duration} premountFor={…}>
                                <ClipRenderer clip={c} />
                              </Sequence>)}
        </Track>
  )}
</AbsoluteFill>
```

- **scene 源码按 `sceneId + sourceHash` 编译并缓存**，时间轴操作和文字覆盖只改 `inputProps`，不重新编译、不重置 Player（v1 已验证的边界）。
- `SceneClip` 用 `<Sequence from={-sceneIn}>` 实现 scene 内部入点，这样旧 composition 被切开后两段都正确。
- Lambda 侧新注册 composition `makaron-timeline`，与旧 `dynamic-design` 并存；Web App 与版本化 Lambda runtime **成对发布、成对回滚**（沿用 editable ABI 的教训）。
- 编译到 `<Track>` 之后，Remotion 官方 OTIO 导出 skill 可直接用于“导出到 Premiere / Resolve”（Phase 5 可选）。

### 3.6 持久化

- 继续使用 `code/<snapId>.json`，在 `DesignPayload` 上新增 `timeline?: TimelineProject`，scene 源码放 `scenes/<sceneId>.<hash>.tsx`（不可变），文档只存引用和 hash。
- 写入复用现有 `PUT .../snapshots/[snapshotId]/design` 路由，把 `__makaronEditableRevision` 升级为 `timeline.revision` 的 CAS；失败在 UI 上明确显示“未保存”，不静默吞掉。
- 不需要数据库迁移。旧视频读取时在内存里适配（§4），**第一次编辑时才落盘**为 V2 文档，不做批量改写生产数据。

---

## 4. “每条视频都时间线驱动”：迁移策略

目标：**不管多老的视频，打开后都能看到时间线并编辑时间**，而不是只有新视频才有。分三档，按顺序尝试，结果写进 `migration.method / confidence`：

| 档 | 适用 | 做法 | 结果 |
|---|---|---|---|
| A. 原生 | 新的 Agent 产出 | Agent 先写 scene（`run_code` 只写 React scene），再用 `edit_timeline` 编排 | 多 scene、多轨，完整可编辑 |
| B. 运行时捕获 | 旧 composition，顶层由 `<Sequence>/<Series>/<TransitionSeries>` 组成（视频 Director 合同产出的大多是这种） | 在隐藏的 Player 中挂载旧代码，读取 Remotion 运行时 sequence 注册表（Studio 时间线就是这么来的）拿到每个顶层 sequence 的 `from / durationInFrames / displayName / 媒体 src`，生成 scene clip + 外部视频/音频 clip；**不读源码文本** | 1 个视频 → N 个 story clip + 音频轨，置信度 ≥0.8 才自动采用 |
| C. 整段包装 | 任何其他情况 | 整个旧 composition = 1 个 scene，1 个全时长 story clip | 仍然可以：切分（靠 `sceneIn`）、改时长、加文字/字幕/音乐轨、调速、加转场 |

- B 档依赖 Remotion 内部 `SequenceManager` 在 Player 里是否可读，**需要 Phase 0 spike 验证**；不可用时 B 档降级为“导出时一次性 AST 迁移”（v1 文档已规划），仍然不允许运行时反复猜。
- 迁移结果用户可以“一键还原为原始视频”（保留原 `design.code` 不删）。
- 2026-07 那次的验收用例必须保留：**“6 张图 + 特效生成的视频”打开后要看到 6 个 clip**，不是一个壳。

---

## 5. Agent 合同

| 工具 | 作用 |
|---|---|
| `get_timeline` | 读取精简视图：轨道、clip（秒+帧）、scene 节点清单、当前 revision；大文档分页 |
| `edit_timeline({ expectedRevision, ops })` | 唯一的时间编辑入口，返回新 revision 或 diagnostics |
| `run_code`（scene 模式） | 只负责新增/修改 React scene 的长相；**不再负责排时间** |
| `preview_timeline({ frames \| seconds })` | 用同一编译产物截帧给 Agent 自检 |
| `publish_timeline` / `materialize_media` | 定稿与导出 MP4（沿用现有发布链路） |

- prompt 只说意图与路由；ops 的 JSON Schema 由 Zod 直接生成，不手写第二份。
- 典型对话：“把第二段换成那条海边视频，加个淡入淡出，配乐铺满” → 1 次 `upsert_asset` + `move_clip/remove_clip` + `upsert_transition` + `insert_clip(audio, to-end)`，一次事务，UI 上直接动画呈现变化。
- CLI / MCP 同步暴露 `timeline get / edit`，发布时按 release checklist 同步 NPM（AGENTS.md 要求）。

---

## 6. UI 设计（Makaron 风格）

详见 mockup。核心原则：**简单的默认 + 渐进展开**——用户第一眼只看到一条故事轨，需要时才展开文字/音频/字幕轨。

### 6.1 视觉语言（全部来自现有 token）

- 底色纯黑 `#000`，面板 `#0a0a0a / #141414`，描边 `rgba(255,255,255,.08–.12)`；
- 主色 fuchsia `#d946ef / #e879f9`：选中、播放头、拖拽手柄；辅色 cyan（`rgba(34,211,238)`，liquid rail 已有）用于音频；
- Liquid glass：`mkr-liquid-timeline-rail` 的模糊 + 内高光 + 顶部径向光，dock 整体是一块玻璃；
- Geist Sans / Geist Mono（时间码一律 tabular-nums mono）；圆角 clip 6px、dock 16–20px；
- 动效：clip 进出 `animate-tip-in`，Agent 改动以 fuchsia 光扫过对应 clip（“AI 刚改了这里”）。

### 6.2 布局

```
┌──────────── 画布（Remotion Player，DesignOverlay 照旧） ────────────┐
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
 ▶  00:04.12 / 00:18.00     [时间线 | 元素]        ⤺ ⤻   − ●── +
 ───────────────────────── 时间刻度 ────────────────┃─────────────────
 故事   [ 片段1 filmstrip ]◆[ 片段2 ]◆[  片段3  ]◆[ 片段4 ]   ＋
 文字          ( 标题 )            ( 副标题 )
 音频   ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿ 配乐 ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿
        ＋ 字幕   ＋ 画中画
 ─────────────────────────────────────────────────────────────────────
 选中后：[ ✂ 分割 ] [ ⏱ 时长 ] [ 1.0× 速度 ] [ ⇄ 替换 ] [ 🗑 删除 ] [ ✦ 让 Agent 改 ]
```

- **Dock 两个模式**：`时间线`（管时间）/ `元素`（现有 DesignEditPanel pills，管内容）。在画布上点元素 → 自动切到元素；在时间线上点 clip → 画布跳到该 clip 并高亮其节点。两者是同一选择状态。
- **故事轨**最高（桌面 56px / 移动 48px），显示 poster filmstrip；clip 之间的 ◆ 是转场芯片，点它选择转场类型；末尾 `＋` 直接唤起上传/生成。
- **叠加轨**：文字是胶囊形 clip，音频显示波形（cyan），字幕显示词块；默认折叠，只有有内容时才出现。
- **播放头**：1px 白线 + fuchsia 圆头 + 轻微辉光；桌面自由拖动，移动端**固定居中、内容滚动**（剪映式，单手友好）。
- **选中态**：fuchsia 1.5px 描边 + 外发光 + 左右竖条手柄（命中区 ≥ 24px，移动端 ≥ 44px）；拖动时显示时长气泡和吸附线（吸附到播放头、clip 边缘、整秒）。
- **上下文操作条**沿用 `PillCarousel` / liquid pill 样式，固定在 dock 底部；最后一个按钮“让 Agent 改”把选中 clip 作为上下文塞进 CUI。
- **紧凑 / 展开**：默认紧凑（只有故事轨 + 当前选中的轨），上滑 dock 或点 ⌄ 展开全部轨道；桌面可拖动 dock 高度（复用 resizable CUI panel 的做法）。

### 6.3 交互清单

| 操作 | 桌面 | iPhone |
|---|---|---|
| 定位 | 点刻度 / 拖播放头 | 左右滑动时间线 |
| 缩放 | ⌘+滚轮 / 滑杆 | 双指捏合 |
| 选择 | 单击，Shift 多选 | 点按 |
| 改时长 / 裁剪 | 拖左右手柄 | 拖手柄（带放大时长气泡） |
| 重新排序 | 拖动 story clip（其余自动让位） | 长按后拖动 |
| 分割 | `S` / 操作条 ✂ | 操作条 ✂（在播放头处分割） |
| 删除 | `Delete` | 操作条 🗑 |
| 撤销 / 重做 | ⌘Z / ⇧⌘Z | 顶部 ⤺ ⤻ |

- 时间线获得焦点时**吞掉键盘快捷键**，不触发项目级上一张/下一张（7 月教训）。
- GUI/CUI 互斥渲染与 iOS 返回手势路径保持不变；时间线横向滚动区域留出左边缘 20px 不响应，避免与 Safari 返回手势冲突。
- 四种语言（zh / zh-Hant / ja / en）同批补齐，包括 tooltip 和无障碍文案。

### 6.4 用不用 Remotion 的 UI 组件

“可以直接用 Remotion”的理解：**渲染与时间语义直接用 Remotion（Player、`<Track>`、`TransitionSeries`、`@remotion/media-utils` 波形），时间线 UI 自建**。理由：Remotion 没有可嵌入用户产品的免费时间线组件；付费 Timeline 的状态结构不公开、视觉要整体重画，买来主要省的是拖拽/缩放的交互细节。建议先基于 v1 的 `EditableTimelineDock` 继续做，把付费 Timeline 作为可选参考（见 §7）。

---

## 7. 需要你拍板的决策

1. **是否复用 `codex/editable-timeline-project`**：建议“复用内核文件、在最新 dev 上重建分支”，不直接 merge 那个落后 791 个提交的分支。
2. **Remotion 升级 4.0.527 → 4.0.541**：`<Track>` 需要 ≥4.0.534；升级涉及 Lambda site/函数重新部署与 Snapshot 重建，需要单独验收。
3. **是否购买 Remotion Timeline / Editor Starter 作参考**：价格未能确认；Makaron 本身的 Remotion 公司授权情况需要你确认。
4. **V2 首发范围**：建议先做 story / text / audio 三类轨 + 转场；caption 轨、画中画、关键帧音量放到第二批。

---

## 8. 分期与验收

| 阶段 | 内容 | 验收证据 |
|---|---|---|
| P0 Spike（2–3 天） | 新分支基于最新 dev；升级 Remotion 到 4.0.541；验证 `<Track>` + `TransitionSeries` 在 Player / `renderMediaOnWeb` / Lambda 三处一致；验证 Player 内能否读 sequence 注册表（决定迁移 B 档） | 同一份 3 段 JSON 的三份 MP4 逐帧对比；spike 报告 |
| P1 协议内核 | 从 v1 移植并收敛 schema（§3.3 的差异）、reducer、编译器、反向事务 undo；单测覆盖：磁吸 ripple、attached 跟随、split（含 sceneIn）、转场缩短时长、revision 冲突 | 单测 + schema 快照 |
| P2 渲染接入 | `MakaronTimeline` 组件、Player 热更新不重编译、poster/截帧只准备当前帧可见资源、Lambda composition 成对发布 | 本地 Makaron 项目页真实播放 + 浏览器 MP4 + Lambda MP4 一致 |
| P3 迁移 | A/B/C 三档 + “还原原始视频”；接入 proxy track 解决多 clip 卡顿 | 抽 20 个真实旧项目（含“6 图 + 特效”）全部能出时间线；B 档命中率与置信度报告 |
| P4 时间线 UI | Dock、故事轨、叠加轨、操作条、移动端居中播放头、四语言 | 桌面 + iPhone 真机：改字、拖动、裁剪、重排、分割、撤销，保存后重开完全一致 |
| P5 Agent | `get_timeline / edit_timeline / preview_timeline`、prompt 路由、CLI/MCP 同步 | 真实对话：Agent 生成多段视频 → 用户画布改字 → Agent 再改时长不覆盖用户修改 → 导出 |

发布门禁沿用 v1 的 Phase 5：单测或 Agent 任务通过都不算发布证据，必须是真实项目流程 + Preview/Export 一致 + 双端交互。

## 9. 风险

- **多 clip 预览卡顿**：Safari 上 `<Sequence>` 切换卡顿已知（proxy track 分支）。时间线化会放大这个问题，P3 必须带上。
- **字体**：文字覆盖引入新字符时需要刷新字体子集而不重编译 scene（v1 遗留）。
- **迁移 B 档依赖 Remotion 内部 API**：只在迁移时用一次，结果固化到 JSON，运行时不依赖；锁定 Remotion 版本并加回归测试。
- **共享 Preview 环境**：Lambda runtime 与 Snapshot 变更不能占用共享 `git-dev` alias（AGENTS.md）。
