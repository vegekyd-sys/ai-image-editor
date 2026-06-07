# Makaron 定位 + Meta 创意切口

日期：2026-05-29

## 产品理解

Makaron 不应该被定位成一个泛泛的 AI 修图工具。

目前最强的内部定位，其实已经写在 `src/lib/prompts/agent.md` 里：

> Makaron is the creative partner that turns one person into a studio.

也就是：Makaron 是一个能把“一个人”变成“一个创意工作室”的创意伙伴。

用户买的不是简单修图。用户真正买的是一个创意伙伴：它可以把普通相册素材变成适合社交发布的视觉作品，包括图片、海报、视频、音乐、可复用 workflow，以及可以 remix 的 skill。

## 核心能力

- 通过 `generate_image` 做图片编辑和图片生成
- Skill 驱动的 workflow；这里的 skill 更像一个 app / preset / workflow，而不是普通滤镜
- 通过 `generate_animation` 做照片转视频和动画
- 用户明确要求配乐时，可以生成音乐 / soundtrack
- 相机旋转和视角变化
- CUI 聊天，一个类似创意总监的 agent
- Timeline snapshots，让每次编辑都成为一条创意路径，而不是一次性导出
- 首页 skill marketplace 有明确结果导向：Photo to Video、Night Flash、Diamond Bling、Fan Merch、Idol Building、Idol Selfie、黑白肖像、宠物 / 社交风格编辑等

## Meta Ad Library 调研发现

Apify 跑数结果：

- `docs/meta-swipe-runs/2026-05-29T03-32-51-469Z-swipe.md`
- `docs/meta-swipe-runs/2026-05-29T03-35-30-711Z-swipe.md`

第一轮 broad run 太脏：

- `photo booth` 大多搜到线下活动拍照亭供应商。
- `creator template` 搜到 AI creator 课程、Captions、视频编辑工具。
- `idol selfie` 抓到一个很强的 Glam AI 案例，但也混进很多无关的 romance / getaway 广告。

结论：泛关键词很弱。后续应该用竞品、主页、品牌名和 trend phrasing 来抓。

第二轮竞品跑法有用很多：

- Glam AI：`POV: you uploaded one selfie and now you're performing in front of a sold out arena`、`K-pop idol era`、`preset`、`no prompt needed`
- Remini：`Side by side, picture perfect! Try the new Remini AI Photobooth`、`Ever wondered how you’d look in a mugshot?`、`AI Drawing trend`、`caricature`
- Hypic：`love the way these turned out with this effect`、`nostalgic`、`2016 camera effects`、`photo ideas`
- Captions：`AI Edit > manually editing for HOURS`，强调 sound effects、transitions、text、更好的视频
- Mojo / OnBeat：`Create outstanding content`、`stress-free video editing`

## 策略判断

市场并不是在卖 “AI photo editor”。市场真正卖的是：

- 一个 trend
- 一个 scene
- 一个 era
- 一个 camera effect
- 一个 social identity
- 一个 one-click workflow

这对 Makaron 是好事，因为 Makaron 本来就有 skills。产品可以被包装成：

> 用一组创意 skills，把你的照片变成 posts、posters、videos、fandom artifacts 和 stories。

## 推荐第一切口

### 工作切口

**Your camera roll, but in its idol era.**

中文理解：你的相册，进入 idol era。

为什么选这个切口：

- 它直接连接 Asian-cool 审美，但不需要在文案里说 “Are you Asian?”
- 它能映射到现有 Makaron skills：Idol Selfie、Photo Booth / CCD、Fan Merch、Idol Building、Diamond Bling、Photo to Video
- 它比 “AI photo editor” 更具体，又比单纯 K-pop 更宽
- 它可以让素材自然筛人：Asian faces、boba、night city、photo booth、fan merch visuals，而不需要写 personal-attribute copy
- 它天然适配手机 H5 和桌面 Web，因为动作很简单：上传照片 -> 选择 skill -> 得到结果

### 可替换文案

- One photo. A whole idol-era drop.
- Turn your camera roll into a fan edit.
- Make your selfie look like it escaped a pop comeback.
- Your photos, but ready for the group chat.
- Drop a selfie. Get a poster, photo booth strip, or mini vlog.

## 第一轮测试集群

不要一上来讲 Makaron 的所有能力。第一轮只打一个 cluster：

**Idol-era selfie engine**

落地页：

- `/home/idol-selfie`
- `/home/fan-merch`
- `/home/idol-building`
- `/home/nightclub-diamond-bling`
- `/home/photo-to-video`

创意方向：

1. Idol Poster Reveal
   - Hook：`One selfie. Your idol-era poster.`
   - 前 2 秒：直接展示完成后的 poster，然后 rewind 到原始自拍。
   - CTA：`Create yours`

2. Photo Booth Strip
   - Hook：`Make your photos feel like a Seoul photo booth strip.`
   - 前 2 秒：四格 photo booth strip 滑入。
   - CTA：`Try it with your photo`

3. Fan Merch Drop
   - Hook：`Turn your photo into fan-style merch.`
   - 前 2 秒：phone case / badge / banner mockups 弹出。
   - CTA：`Use this skill`

4. Night Flash Profile Pic
   - Hook：`Give your profile pic a late-night flash upgrade.`
   - 前 2 秒：before / after flash cut。
   - CTA：`Create yours`

5. Photo to Mini Vlog
   - Hook：`Drop in 3 photos. Get a mini vlog.`
   - 前 2 秒：先展示最终 vlog montage，然后展示三张输入照片。
   - CTA：`Try it`

## 文案规则

可以用：

- `idol-era`
- `photo booth`
- `fan edit`
- `camera-roll`
- `profile pic`
- `mini vlog`
- `poster`
- `your photo`
- `your selfie`

避免用：

- `Are you Asian?`
- `For Chinese people`
- `Asian users love this`
- 宽泛的 `AI photo editor`
- 把 `make your photo better` 当主 hook

## 下一轮 Apify 调研

更好的查询词：

- `Glam AI`
- `Remini AI Photobooth`
- `K-pop idol AI`
- `AI photobooth`
- `2016 camera effect`
- `photo ideas`
- `AI video template`
- `fan edit`
- `profile picture trend`

竞品主页 / 品牌：

- Glam AI
- Remini
- Hypic
- EPIK
- BeautyPlus
- SNOW
- Meitu
- Prequel
- Lensa
- CapCut
- Mojo
- Captions

每次跑数建议使用：

- `media_type=video`
- `active_status=active`
- `country=US`
- `resultsLimit=5-20`

## 决策

第一轮真正的付费社交测试应该是：

**Campaign A: Idol-Era Skill Landing Test**

而不是：

**Campaign A: AI Photo Editor Test**

产品承诺应该是：

> Makaron turns one selfie into the kind of visual world people already save, share, and remix.

中文理解：

> Makaron 把一张自拍变成大家本来就会保存、分享、二创的视觉世界。
