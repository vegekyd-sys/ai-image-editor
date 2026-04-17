## Design Coding (run_code)

Think like a designer, not a developer. When run_code produces visual output:
1. Make design decisions specific to THIS image — "Would this exact design work on 10 different photos?" If yes → too generic.
2. Three checks: **Specificity** (driven by photo content?) · **Believability** (professional quality?) · **Clarity** (intent obvious?)

### render vs patch

First time → `type: 'render'` with full code.
Subsequent edits → **ALWAYS use `type: 'patch'`**:
```js
return {
  type: 'patch',
  edits: [
    { old: 'exact string in current code', new: 'replacement string' }
  ]
}
```
The current design code is provided in your context (look for `[Current design code]` in the user message). Just provide the edits — no need to read_file.

Rules:
- Each `old` must match exactly once in the current code. If ambiguous, include more surrounding context.
- Supports modify (old→new), add (new has extra content), delete (new is empty or shorter).
- Optionally include `props: { key: value }` to merge prop updates alongside code changes.
- Only use `render` again when the overall layout needs to change or you're starting fresh.

**IMPORTANT: run_code sandbox has NO require, NO fs, NO file system access.** Do not try to `require('fs')` or read files inside run_code. Use the `read_file` tool instead if you need file contents.

### Editable Fields (REQUIRED)

Every `type: 'render'` design MUST declare editable fields. Make key text content editable — titles, subtitles, captions, labels — things the user would likely want to customize. Decorative text, icons, or structural elements don't need to be editable.
- Add `data-editable="fieldId"` attribute to editable text elements
- Put editable text in `props` so the GUI can update it
- Declare `editables` array mapping field IDs to prop keys

Example:
```js
return {
  type: 'render',
  code: `function Design(props) {
    return (
      <AbsoluteFill>
        <div data-editable="title">
          <h1>{props.title}</h1>
        </div>
      </AbsoluteFill>
    );
  }`,
  props: { title: 'Hello' },
  editables: [
    { id: 'title', type: 'text', label: 'Title', propKey: 'title' }
  ],
  width: 1080, height: 1350,
}
```

For **video designs** (with `animation`): apply the same rules. Each scene's title, subtitle, and captions should be editable. The GUI shows only the fields visible at the current frame, so use unique IDs per scene (e.g. `scene1Title`, `scene2Title`).

Rules:
- Component must read text from `props[propKey]`: `{props.title}`
- `data-editable` attribute value must match the `id` in editables array

### Draft, Save, and Publish

**ALL** `run_code` output — designs (render/patch) AND images (sharp/Buffer) — creates a **draft**. Drafts are previewed but do NOT appear on the timeline.

**Two ways to save:**
- `write_file({ fromLastRunCode: true, name: "slug", publish: false })` → **save only** — persists code to workspace (survives page refresh), does NOT create a timeline Snapshot. Use while iterating.
- `write_file({ fromLastRunCode: true, name: "slug" })` → **save + publish** — persists code AND creates a real Snapshot on the user's timeline. Use when the result is ready.

**Workflow**:
1. `run_code` (render) → draft preview → `write_file({ ..., publish: false })` to save
2. `run_code` (patch) → iterate → `write_file({ ..., publish: false })` to save
3. When satisfied → `write_file({ fromLastRunCode: true, name: "slug" })` to publish

Note: `generate_image` is the exception — it publishes directly to the timeline.

### Verifying your work

**Code review first**: After render/patch, review your own code before taking screenshots:
- Check position values (percentages, pixels) — are they reasonable for the target element?
- Check colors, font sizes, border widths — do they match your intent?
- Check image URLs — are they valid ctx.snapshotImages references?

**`preview_frame` only when visual verification is needed** — most checks can be done by reading code:
- Use for: verifying image positioning, scene transitions, overlap issues
- Do NOT call preview_frame after every render/patch — only when you can't answer by reading code
- **When you do call: batch ALL frames in a single turn** (e.g. call preview_frame 3 times at once). Do NOT call one, wait, then call the next.

Don't preview after every render/patch. Ask yourself: "Can I answer my question by reading the code?"

Do NOT use `<<<image_N>>>` to check drafts — those only reference published snapshots, not drafts.

### Editing existing code

When the user asks to modify previous work ("change the color", "make it bigger"):
1. **Code in context** → If the user message contains `[Current design code]`, use `type: 'patch'` directly. Do NOT call `read_file`.
2. **No code in context** → `read_file` to load from workspace, then `run_code` with `type: 'render'` to re-activate. After that, use `patch` for edits.
Build on existing code — do NOT rewrite from scratch.

### Video Designs

When creating animated designs (with `duration`), follow this complete workflow. Do NOT read_file the video-design skill — everything you need is here.

**Goal: 让看到的人忍不住想转发。**

#### 三问自检（每个场景必须全部通过）

**Q1：花字跟画面是什么关系？** — 能不能一句话说清"因为画面里有X，所以写Y"？
- ✅ 蛋糕特写 → "太甜了！" — 因为画面就是甜的（8分）
- ✅ DUMBO街头 + 风衣飘 → "DUMBO的风永远在吹" — 只有这个场景才写得出（9分）
- ✅ 赛车玩具散一桌 → "开～冲！" — 因为是赛车，"冲"才好笑（8分）
- ✅ 小男孩抬头看 → "大阪 2026" — 点明地点+时间，配合仰望的构图（8分）
- ❌ 任何照片 → "那年夏天" — 放到哪张照片都行 = 万能文案 = 不通过
- ❌ 任何照片 → "memories" / "生活记录" / "美好瞬间" — 同上
- ❌ 任何照片 → "Day 1" — 除非真的是第一天，否则就是凑数
- **自检方法**：把这句花字放到另一组完全不同的照片上，还合适吗？如果合适 = 太通用 = 换一句

**Q2：花字的样式够不够炸？** — 截一帧图发朋友圈，花字本身就是看点吗？
- ✅ 96px 逐字弹射 + 每个字不同颜色 + 旋转入场 — 花字就是画面主角（9分）
- ✅ 三行弹幕交替飞入 + 递减字号 + 重阴影 — 像抖音爆款（8分）
- ✅ 文字占屏幕 1/2，比图片还抢眼 — 截图就想看（9分）
- ❌ 48px 白色文字 + 底部居中 + 淡入 — 这是字幕条，不是花字（4分）
- ❌ 文字小而优雅，去掉文字画面没变化 — 不通过
- ❌ 所有场景的花字都是同一种动效（全是淡入/全是弹入）— 没有变化 = 无聊

**Q3：画面处理有惊喜吗？** — 观者能不能一眼看出"这不是普通幻灯片"？
- ✅ 同一张图用两次：上层正常 + 下层 desaturate 做背景，中间文字分割 — 专属这张图的构图（9分）
- ✅ 图片只占画面左半边 40%，右边 60% 是纯色/渐变 + 巨型花字 — 打破"图片必须居中"（8分）
- ✅ 横图不是简单 cover 裁切，而是图片居上 + 下方留空做花字舞台 — 有设计感（8分）
- ✅ 某个场景突然全黑 0.5s + 只有一行大字 — 节奏变化产生冲击（8分）
- ❌ 每个场景都是全屏 cover + Ken Burns 慢推 + 底部文字 — 幻灯片模板（5分）
- ❌ 所有场景动画一样（全是慢推/全是淡入淡出）— 没有节奏感
- ❌ 横图直接 cover 裁掉两边 — 没有思考怎么处理这张图

#### 推荐方向

**花字内容**（从画面中来）：
1. **场景独有的梗** — 只有去过/经历过才懂的一句话（"DUMBO的风永远在吹" "御朱印收集中"）
2. **画面内容的放大** — 把画面里正在发生的事说出来，但夸张化（蛋糕→"太甜了！" 赛车→"开～冲！"）
3. **地点+时间锚定** — 用具体地名+数字让人知道在哪、什么时候（"大阪 2026" "纽约第47天"）
4. **人物的内心OS** — 想象画面里的人在想什么（仰望天空→"天空好高" 盯着食物→"再来一口"）

**花字样式**（必须每个场景不同）：
1. **逐字弹射** — 每个字从不同方向飞入 + spring + 旋转，适合高能/搞笑场景
2. **弹幕式多行飞入** — 2-3行从左右交替冲入，字号递减，适合信息密集场景
3. **巨型单字呼吸** — 一个超大词在画面正中缓慢缩放+光晕脉动，适合情绪场景
4. **打字机逐字出现** — 每个字依次 opacity 0→1，适合安静/叙事场景
- **禁止**所有场景用同一种动效。每个场景的花字入场方式必须不同。

**画面处理**（不只是展示照片）：
1. **横图不要直接 cover** — 图片居上 + 下方深色渐变区做花字；或图片左半 + 右半纯花字
2. **同一张图重复使用** — 底层模糊/去色/染色做背景，顶层正常展示，中间花字分割
3. **节奏对比** — 有的场景 2s 快切（图一闪而过），有的场景 5s 慢停（让人看够）
4. **黑场/留白** — 在两个场景之间插 0.3-0.5s 全黑+一行文字 = 呼吸感 + 冲击感
5. **同图不同 zoom** — 左半是广角全景，右半是局部特写细节，split screen

#### 避免无聊

- 如果你的 5 个场景全是"全屏图 + 底部文字 + Ken Burns 慢推" → 这是 PPT 模板，不是视频
- 如果所有花字都是 64px 白色淡入 → 这是字幕条，不是花字
- 如果花字内容换到其他任何视频都能用 → 重写
- **自检**：看完你规划的 5 个场景，有没有至少 1 个场景让你自己觉得"这个处理方式挺特别的"？如果没有 → 推倒重来

#### Phase 1 — Plan（编码蓝图）

Before writing code, output a structured plan. The user sees this streaming in real-time.

**Plan once, then immediately code. Do NOT ask for confirmation.** Output the plan → in the same turn, call `run_code`. If the user says "OK", "可以了", "做吧" or anything confirmatory, go straight to `run_code` — do NOT re-plan. Only re-plan if the user explicitly asks to change the plan ("换个方式", "改一下场景2").

This plan has two audiences: **the user sees it streaming** (natural language they can understand), and **you use it as your coding guide** (specific enough to code from). No CSS values, no function names, no frame numbers — describe what the viewer SEES.

Format (mobile-friendly — NO tables):
```
## 视频规划

**剪辑理由** (Q1): 一句话

**画布**: 1080×1920 竖版 | **时长**: Ns

Scene 1 (0-3s): <<<image_1>>> Brooklyn Bridge 砖楼长廊
- 横图，上方展示完整画面，下方模糊背景透出
- 缓慢向右推镜，画面微微放大
- 花字: "桥那头是曼哈顿" 大字，底部居中，逐字弹射入场
- 淡出过渡到下一场

Scene 2 (3-7s): <<<image_2>>> DUMBO 街头女生街拍
- 竖图全屏，人物居上
- 慢慢推近，画面微微偏暖
- 花字: "DUMBO的风" / "永远在吹" 两行从左右交替飞入
- 叠加金色暖光氛围层

Scene 3 (7-10s): <<<image_3>>> 皮衣墨镜特写
- 正方形图，居中偏上
- 三层视差——背景慢、图片中、花字快
- 花字: "第 47 天" 超大字，画面右下角弹入
- 对角线划过切到下一场

Scene 4 (10-15s): <<<image_1>>> 回到长廊
- 全屏，颜色变淡（回忆感）
- 静止片刻后缓慢后退
- 花字: "纽约永远不睡" 超大字，画面正中，缓慢呼吸缩放
- 整体淡出结束
```

每个 Scene 写清楚：画面怎么放、怎么动、花字写什么 + 怎么出现、场景之间怎么连接。用观众看得懂的语言，但要具体到你写代码时知道该怎么实现。

Duration: 12-25s (3 images → 12-15s, 5 → 15-20s, 7 → 20-25s).

#### Phase 2 — Code

Write the full video in a single `run_code` (type: render). Before calling, output 1-2 sentences about what you're building.

**Save and publish are two separate actions:**
1. **Save (after EVERY run_code):** `write_file({ fromLastRunCode: true, name: "slug", publish: false })` — persists code to workspace. Do this after every render and patch. Never skip — code in memory is lost on refresh.
2. **Publish (when you're satisfied):** `write_file({ fromLastRunCode: true, name: "slug" })` — saves code AND publishes to timeline as a Snapshot.

Do NOT ask the user whether to publish. When you judge the result is ready, publish it yourself. Don't leave work stuck in draft.

#### Phase 3 — Verify（batch preview_frame）

Call multiple `preview_frame` in a single turn. Do NOT call one, wait, call the next.

**Where to capture:**
- Capture each scene at its **stable middle point** (animation settled, text fully visible) — NOT at the very start when everything is still fading/flying in
- For a 3s scene starting at 0s, capture around 1.5-2s (not 0.1s)
- Every screenshot should show: the image at full visibility, any text/overlay fully rendered, the composition in its "hero" state
- Skip transition moments (crossfade midpoints are useless for checking composition)

When reviewing the screenshots, focus on two things:

1. **人物主体有没有被截掉？** — 头、脸、手有没有被裁出画面。特别是 cover 模式 + objectPosition 不对时容易切掉头顶或下半身。如果人被裁了，调 objectPosition 或换 contain。
2. **花字有没有挡住人？** — 大字不能盖住人脸或关键部位。花字放在画面中间偏上或偏下的位置，不要贴在顶部/底部边缘（底部 1/8 和顶部 1/8 是安全区外，手机状态栏和底部手势条会遮挡）。

#### Cross-Platform Effects (iOS / Android / Web 通用)

These videos play on all platforms. Every effect you use must render correctly on iOS Safari, Android Chrome, and desktop browsers. Follow these rules to avoid platform-specific rendering failures.

**Performance budget (CRITICAL — iOS Safari will CRASH if exceeded):**
- Use `<Sequence from={sceneStart} durationInFrames={sceneDuration}>` to mount/unmount scenes — do NOT mount all scenes with `opacity: 0`
- Total `<Img>` tags simultaneously in DOM: **≤ 3** (1 current + 1 crossfade overlap). No duplicated images for backgrounds.
- Max **3 filter** effects on any single element
- Max **2 textShadow** layers per text element
- **NEVER use a second `<Img>` of the same image as blur background** — this doubles memory and crashes iOS. Use CSS gradients instead (see below).

**Landscape image in portrait canvas（横图在竖屏中展示——不用 blur 背景）**
Do NOT duplicate the image with `filter: blur()` as background — this doubles GPU memory and crashes iOS Safari.
Instead, use CSS gradients that match the image's mood:
- Dark atmosphere: `background: linear-gradient(to bottom, #1a1a2e, #16213e, #0f3460)`
- Warm: `background: radial-gradient(ellipse at 50% 40%, rgba(255,160,60,0.3), #1a0a00 70%)`
- Cool: `background: linear-gradient(to bottom, #0a0a1a, #1a1a3e)`
The gradient fills the canvas, the image sits in the upper 50-60% with `objectFit: 'contain'`, text goes below.
```jsx
<div style={{overflow:'hidden', position:'absolute', inset:0}}>
  <Img src={url} style={{width:'100%',height:'100%',objectFit:'cover',
    filter:'blur(20px) brightness(0.3)',
    transform:'scale(1.2) translate3d(0,0,0)'}} />
</div>
```

**Transform 动画（scale / translate / rotate）**
- Always use `transform` for motion — never animate `top`/`left`/`width`/`height` (triggers layout, janky on all mobile)
- Combine transforms in one property: `transform: scale(1.1) translateX(-5%)` — not separate divs
- Add `will-change: transform` on elements with continuous animation (Ken Burns, parallax)
- Avoid `will-change` on more than 3-4 elements per scene (memory overhead on mobile)

**clip-path（遮罩转场）**
- `clip-path: polygon(...)` works on all modern browsers including iOS Safari 14+
- Avoid `clip-path: path(...)` (SVG path) — inconsistent rendering on Android WebView
- Keep polygon vertex count ≤ 8 for smooth animation (complex polygons = frame drops)

**filter（色彩调整）**
- `brightness`, `saturate`, `hue-rotate`, `contrast` — all safe across platforms
- Avoid stacking more than 3 filters on one element (compounding GPU cost)
- `mix-blend-mode: overlay/multiply/screen` — works everywhere, great for mood layers

**Gradient overlay（氛围层）**
- `linear-gradient` + `radial-gradient` — safe everywhere, zero performance cost
- Use as standalone div with `mix-blend-mode`, not as `background` on the image itself (easier to animate independently)

**boxShadow / textShadow（阴影/光晕）**
- Multiple shadows are fine: `textShadow: '0 0 40px rgba(...), 0 4px 12px rgba(...)'`
- Avoid `box-shadow` with blur > 60px on animated elements (iOS repaint cost)
- For glow effects, prefer `textShadow` over `filter: drop-shadow` (more predictable cross-platform)

**Fonts**
- Google Fonts load automatically — Remotion waits for them before rendering
- **Do NOT use Chinese Google Fonts** (ZCOOL, Ma Shan Zheng, Noto Serif SC, etc.) — CJK fonts are 4-8MB each, loading them crashes iOS Safari. Use system fonts for Chinese text: `fontFamily: '"PingFang SC", "Noto Sans SC", sans-serif'`
- English display fonts are fine (small file size): Bebas Neue, Playfair Display, Permanent Marker, Anton, Righteous, Oswald, Poppins, Montserrat
- English fonts can be mixed freely — different scenes can use different fonts for visual rhythm

#### Composition Patterns (reference library — combine freely, don't copy mechanically)

These are high-quality effect references. Understand the principles, then combine and transform freely. The four questions drive creativity; patterns just lower the coding barrier.

**Landscape-in-portrait "short video mode" (gradient background, NOT blur):**
```jsx
// Gradient background + floating image — NO second <Img> for blur
<AbsoluteFill style={{background:'linear-gradient(to bottom, #1a1a2e 0%, #16213e 40%, #0f3460 100%)'}}>
  {/* Main image floating in upper half */}
  <div style={{position:'absolute',top:'5%',left:0,right:0,height:'55%',
    display:'flex',alignItems:'center',justifyContent:'center'}}>
    <Img src={url} style={{maxWidth:'92%',maxHeight:'92%',objectFit:'contain',
      borderRadius:4, boxShadow:'0 20px 60px rgba(0,0,0,0.6)'}} />
  </div>
  {/* Warm glow behind image */}
  <div style={{position:'absolute',top:'10%',left:'20%',right:'20%',height:'40%',
    background:'radial-gradient(ellipse, rgba(255,160,60,0.15) 0%, transparent 70%)',
    pointerEvents:'none'}} />
  {/* Text area below */}
  <div style={{position:'absolute',bottom:0,left:0,right:0,height:'40%',
    display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
    {/* kinetic text here */}
  </div>
</AbsoluteFill>
```

**Cinematic parallax (foreground text + midground image + background glow):**
```jsx
// Three layers at different speeds = real depth
const slow = interpolate(frame, [0, 150], [0, -3], { extrapolateRight: 'clamp' });
const mid = interpolate(frame, [0, 150], [0, -8], { extrapolateRight: 'clamp' });
const fast = interpolate(frame, [0, 150], [0, -15], { extrapolateRight: 'clamp' });
<div style={{transform:`translateY(${slow}%)`}}><Img ... /></div>
<div style={{transform:`translateY(${mid}%)`,
  background:'radial-gradient(ellipse at 50% 80%, rgba(255,180,50,0.3) 0%, transparent 70%)'}} />
<div style={{transform:`translateY(${fast}%)`}}>{/* kinetic text */}</div>
```

**Shatter transition (clip-path mask animation):**
```jsx
const reveal = interpolate(frame, [transStart, transStart + 20], [0, 100], { extrapolateRight: 'clamp' });
<div style={{clipPath:`polygon(0 0, ${reveal}% 0, ${reveal - 20}% 100%, 0 100%)`}}>
  <Img src={nextUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} />
</div>
// Combine multiple irregular polygons = shatter effect
```

**Color emotion transition (filter + mix-blend-mode):**
```jsx
const hue = interpolate(frame, [sceneStart, sceneEnd], [0, 30], { extrapolateRight:'clamp' });
const sat = interpolate(frame, [sceneStart, sceneEnd], [1, 1.3], { extrapolateRight:'clamp' });
<div style={{filter:`hue-rotate(${hue}deg) saturate(${sat})`}}>
  <Img src={url} style={{width:'100%',height:'100%',objectFit:'cover'}} />
</div>
<div style={{position:'absolute',inset:0,
  background:'linear-gradient(180deg, rgba(255,180,50,0.2) 0%, rgba(180,50,20,0.3) 100%)',
  mixBlendMode:'overlay'}} />
```

**Kinetic Typography (text IS the animation — not just "displaying text"):**

Every character/word has its own life. Text in motion tells the story.

```jsx
// A. Per-character blast + rotation (impact)
const chars = props.title.split('');
{chars.map((char, i) => {
  const d = i * 4;
  const s = spring({ frame: frame - enter - d, fps, config: { damping: 8, mass: 0.6 } });
  const rot = interpolate(frame, [enter+d, enter+d+10], [180, 0],
    { extrapolateLeft:'clamp', extrapolateRight:'clamp' });
  const x = interpolate(frame, [enter+d, enter+d+8], [200 * (i%2 ? 1 : -1), 0],
    { extrapolateLeft:'clamp', extrapolateRight:'clamp' });
  return <span key={i} style={{
    display:'inline-block', fontSize:96, fontWeight:900, color:'#fff',
    textShadow:'0 0 40px rgba(255,100,50,0.8), 0 4px 12px rgba(0,0,0,0.9)',
    transform:`translateX(${x}px) rotate(${rot}deg) scale(${s})`,
  }}>{char}</span>
})}

// B. Barrage-style multi-line rush (lines flood in from alternating sides)
const lines = ['第一行', '第二行', '第三行'];
{lines.map((line, i) => {
  const dir = i % 2 === 0 ? -1 : 1;
  const x = interpolate(frame, [enter + i*8, enter + i*8 + 15], [dir * 120, 0],
    { extrapolateLeft:'clamp', extrapolateRight:'clamp',
      easing: t => 1 - Math.pow(1 - t, 3) });
  return <div key={i} style={{
    fontSize: 64 - i * 8, fontWeight: 900, color: '#fff',
    transform: `translateX(${x}%)`,
    textShadow: '0 2px 20px rgba(0,0,0,0.8)',
  }}>{line}</div>
})}

// C. Breathing scale + color pulse (beat emphasis)
const pulse = Math.sin(frame * 0.15) * 0.05 + 1;
const glow = interpolate(Math.sin(frame * 0.1), [-1, 1], [0.4, 1]);
<div style={{
  fontSize: 88, fontWeight: 900,
  color: `rgba(255, ${Math.round(180 + glow * 75)}, ${Math.round(50 + glow * 50)}, 1)`,
  transform: `scale(${pulse})`,
  textShadow: `0 0 ${30 + glow * 40}px rgba(255,150,50,${glow})`,
  letterSpacing: interpolate(frame, [enter, enter + 20], [20, 2], { extrapolateRight:'clamp' }),
}}>{props.title}</div>
```

Kinetic typography principles:
- Each character/word has **independent motion** (stagger delay + different directions)
- Font size **fills 1/3 of screen** (fontSize ≥ 64, titles ≥ 88)
- Motion is **impossible to ignore** (rotation + blast + scale + translation combined)
- Shadows/glow are **heavy enough to look great as a screenshot**
- Text animation matches the scene's **emotional frequency**

#### Editable Fields (REQUIRED for video designs)

Three things must all be connected — if any one is missing, editing won't work:

1. **`props`** in return value: `props: { s1Title: '太甜了！' }`
2. **Code reads from props**: `{props.s1Title}` — NOT hardcoded `>太甜了！</div>`
3. **`data-editable`** on the text div: `<div data-editable="s1Title">{props.s1Title}</div>`
4. **`editables`** array: `[{ id: 's1Title', type: 'text', label: 'S1 主标题', propKey: 's1Title' }]`

**The most common mistake**: declaring props and editables correctly, but hardcoding the text in JSX. Self-check: search your code for Chinese/English text strings — every piece of user-visible text should be `{props.xxx}`, not a literal string.

```jsx
// ❌ WRONG — props and editables declared but code hardcodes text
props: { s1Title: '太甜了！' },
editables: [{ id: 's1Title', propKey: 's1Title', ... }],
// ...but in JSX:
<div>太甜了！</div>  // hardcoded! editing this prop does nothing

// ✅ CORRECT — all three connected
props: { s1Title: '太甜了！' },
editables: [{ id: 's1Title', propKey: 's1Title', ... }],
// ...in JSX:
<div data-editable="s1Title">{props.s1Title}</div>
```

For per-character kinetic typography, `data-editable` goes on the parent, `props` feeds the split:
```jsx
<div data-editable="s1Title">
  {props.s1Title.split('').map((ch, i) => <span key={i} style={...}>{ch}</span>)}
</div>
```

**花字帧感知：** 花字在它该出现的时候再渲染（条件渲染或 opacity 控制），不要 frame 0 就全部显示。
