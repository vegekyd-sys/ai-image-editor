# Makaron Skill 投放优先级与素材改造计划

日期：2026-05-29

## 输入来源

本轮判断基于三类数据：

1. Supabase 线上 skill 货架
   - `docs/meta-skill-research/supabase-home-skills.md`
   - `docs/meta-skill-research/supabase-home-skills.json`

2. Apify 抓取的 Meta Ad Library 竞品广告
   - `docs/meta-swipe-runs/2026-05-29T03-35-30-711Z-swipe.md`
   - `docs/meta-swipe-runs/2026-05-29T03-55-05-523Z-swipe.md`
   - `docs/meta-swipe-runs/combined-creator-video-normalized.json`

3. Gemini 视频分镜分析
   - 竞品视频：`docs/meta-skill-research/video-analysis/2026-05-29T04-10-30-207Z-ad-video-analysis.md`
   - Makaron 现有 skill 视频：`docs/meta-skill-research/video-analysis/2026-05-29T04-02-58-400Z-internal-video-analysis.md`

## 核心结论

不要投 “AI photo editor”。

Meta 上有效的素材不是在卖工具名，而是在卖：

- 一个能立刻看懂的 trend
- 一个具体场景
- 一个身份幻想
- 一个照片变视频的瞬间
- 一个“我也能做”的低门槛 workflow

Makaron 最适合的第一轮打法是：

> 用具体 skill 当广告商品，而不是用 Makaron 总品牌当广告商品。

也就是：广告不要说 “Makaron can edit photos with AI”，而要说：

- `Turn one selfie into a K-pop stage video.`
- `Put yourself on the stadium kiss cam.`
- `Turn your pet into a movie criminal.`
- `Make your photos feel like a 2016 digital camera dump.`

## Skill 货架概览

Supabase 当前查到 78 个 home skills。

| 类别 | 数量 | 视频/GIF 封面 | 备注 |
|---|---:|---:|---|
| idol-social | 19 | 4 | 最贴合原始 Asian-cool 定位，适合做主线 |
| pet | 18 | 4 | 最可能拿到便宜流量和高分享率，适合低成本放量测试 |
| visual | 11 | 3 | 视觉强，但主题分散 |
| utility | 11 | 0 | 更像工具型/搜索型，不适合第一轮 Reels 冷启动 |
| video | 8 | 7 | 结果强，适合短视频投放，但竞争也更强 |
| ip-fantasy | 8 | 0 | 视觉强，但版权/IP 风险高，不建议第一轮 paid ads |
| travel | 3 | 1 | 有潜力，但素材要重新包装成“旅行照片变 vlog/地图” |

## 第一优先级：建议立刻投放测试

### 1. One-Take / 打歌舞台

推荐等级：S

为什么投：

- 和 Glam AI 跑出来的 K-pop / idol-era 广告高度一致。
- 竞品素材证明：`selfie -> K-pop stage performance` 是真实在投的高相关 angle。
- 这是 Makaron 最贴合 “Asian-cool / idol era” 的视频 skill。
- 内部 Gemini 分析给到 Hook 9、Clarity 9、Makaron relevance 10。

当前素材问题：

- 现有封面像成品展示，但缺少用户输入照片和 Makaron 操作路径。
- 用户会觉得“这是一个好看的视频”，但不一定立刻理解“我上传自拍也能生成”。

素材改造：

- 前 0.5 秒：普通卧室/自拍原图，贴字 `One selfie`
- 0.5-2 秒：硬切到打歌舞台高能 close-up，贴字 `Your idol-era stage`
- 2-4 秒：快速展示 Makaron skill 卡片 + 上传照片
- 4-7 秒：完整 stage reveal
- CTA：`Create yours`

推荐 hook：

- `One selfie. Your idol-era stage.`
- `Turn your bedroom selfie into a K-pop stage video.`
- `Your camera roll, but in its idol era.`

### 2. Broadcast Candid / 棒球直播抓拍

推荐等级：S

为什么投：

- 直接对应 Glam AI 的 stadium camera / kiss cam trend。
- 比泛 K-pop 更稀缺，有“我被直播镜头拍到”的主角感。
- 素材天然像真实电视转播，信任感强。
- 内部分析：Hook 8、Clarity 9、Relevance 10。

当前素材问题：

- 成品很强，但没有解释“上传自拍 -> 进入直播画面”。
- 如果直接投，用户可能以为是普通 KBO/棒球内容。

素材改造：

- 前 0-1 秒：直接放转播画面里主角震惊抬头，贴字 `POV: the camera finds you`
- 1-2 秒：切回原始自拍，贴字 `from one selfie`
- 2-4 秒：展示 Makaron 选择 `Broadcast Candid`
- 4-7 秒：完整转播片段 + cheer reaction

推荐 hook：

- `Put yourself on the stadium big screen.`
- `One selfie -> live broadcast main character.`
- `POV: the camera finds you at the game.`

### 3. Photo Booth / Retro CCD / Flash Snap 组合

推荐等级：A

为什么投：

- Remini 正在投 `AI Photobooth`，Hypic 正在投 `2016 camera effects`。
- 这是年轻用户已经理解的 visual language：photo booth、CCD、nostalgia、camera dump。
- 和 Asian-cool 审美自然贴合，不需要写 personal attribute。
- 相比视频生成，静态生成成本和等待时间可能更低，利于注册/上传转化。

建议不要单独投一个 skill，而是打一个组合：

> Photo Booth Pack

包含：

- Photo Booth / 大头贴
- Retro CCD / 复古 CCD
- Flash Snap / 闪光灯抓拍
- Polaroid / 拍立得

当前素材问题：

- 多数是静态封面，缺少 Reels 的节奏。
- 有些 skill 当前需要 idol + fan 两张图，冷启动用户可能没有第二张图，输入门槛偏高。

素材改造：

- 做成 9:16 短视频，不是静态图。
- 前 2 秒必须直接显示 4 格 photo booth / CCD 日期戳 / flash snap before-after。
- 屏幕上写 `Upload 1 selfie` 或 `Upload 2 photos`，避免用户误解。
- 如果 skill 实际需要两张图，要做一个“一张自拍版”的广告落地 skill，否则投放漏斗会掉。

推荐 hook：

- `Make your photos feel like a Seoul photo booth strip.`
- `Your selfie, but shot on a 2006 CCD.`
- `Turn your camera roll into a photo booth dump.`

### 4. Pet Mugshot / Pet Action Movie

推荐等级：A

为什么投：

- Pet 是最可能拿便宜流量的方向：受众大、分享动机强、身份属性风险低。
- Apify 里 VideoExpress / FotoPro 都在投 AI pet / emotional pet / pet story。
- Makaron 自己已有多个 pet skill，且 Pet Mugshot / Pet Action Movie 有视频封面。
- 内部分析：Pet Mugshot Hook 8、Clarity 10、Relevance 10；Pet Action Movie Hook 9、Clarity 10、Relevance 10。

和 Asian-cool 主线的关系：

- 它不完全是 Asian-cool，但可以作为低成本流量池。
- 可以单独开 Campaign B，不要混进 idol campaign。

当前素材问题：

- Pet Mugshot / Pet Action Movie 成品强，但同样缺少 before photo。
- 需要更明确告诉用户“上传宠物照片就能做”。

素材改造：

- 前 0-1 秒：宠物原图 + `Your pet did what?`
- 1-2 秒：mugshot / action movie reveal
- 2-4 秒：Makaron skill 卡片 + `Upload pet photo`
- 4-7 秒：更多成品变体

推荐 hook：

- `Caught red-pawed. Turn your pet into a mugshot.`
- `Your pet, but as a Hollywood action star.`
- `Upload one pet photo. Get a whole movie scene.`

### 5. Photo to Video

推荐等级：A-

为什么投：

- 最大众、最容易解释。
- 内部视频分析 Hook 8、Clarity 9、Relevance 10。
- 和 Mojo / OnBeat / Vidix 的竞品方向一致。

为什么不是 S：

- `photo to video` 竞争非常激烈，容易进入高 CPM / 高 CPI 赛道。
- 如果只说 “bring photos to life”，会和所有 AI video app 撞车。

素材改造：

- 不要投泛 “Photo to Video”。
- 必须绑定更具体的场景，比如：
  - `Photo to Idol Stage`
  - `Photo to Pet Movie`
  - `Photo to Travel Map`
  - `Photo to Main Character Moment`

推荐 hook：

- `Stop posting still photos. Make them move.`
- `One photo. One mini movie.`
- `Your camera roll deserves a scene.`

## 第二优先级：可做小预算探索

### Character Select / 游戏角色选择

推荐等级：B+

优点：

- 视觉冲击强，内部分析 Hook 9、Clarity 10、Relevance 10。
- 对 gamer / anime / cyberpunk 人群可能 CTR 高。

风险：

- 和原本 Asian-cool young female / diaspora aesthetic 不完全一致。
- 素材偏硬核，可能吸来喜欢看爽片但不一定愿意上传自拍的流量。

建议：

- 小预算测，不要作为第一主线。
- 文案走 `Turn your selfie into a game character`，不要走泛 gaming。

### Map Tap Transition / Travel Stamp / Travel Route Map

推荐等级：B

优点：

- 旅行素材普适，适合 IG Reels。
- Map Tap Transition 视频封面很完整。

风险：

- 旅行赛道竞争也强，且与 Makaron 的 idol/social 主线弱一些。

建议：

- 等第一轮找到付费/注册转化后再测。
- 或者作为 retargeting 素材：访问过 Photo to Video 的用户再推旅行 video skill。

### Fan Merch / Idol Building / Fan Trending

推荐等级：B

优点：

- 很贴 Asian fandom。
- 和 `idol-era` 定位一致。

风险：

- 静态素材多，需要重做视频广告。
- Fan Merch 可能用户理解成本高：这是给真人自己做 merch，还是给 idol 做 merch？

建议：

- 先用作 One-Take / Photo Booth campaign 的第二层素材。
- 等我们能产出很强的 before/after merch mockup 视频，再独立投。

## 不建议第一轮投放

### IP/Fantasy 类

包括：

- Jujutsu Kaisen
- One Piece Gear 5
- Squid Game
- Attack on Titan
- Totoro Forest
- Spirited Away
- Makima / Zero Two / Android 18 等

原因：

- 版权/IP 风险高。
- Meta 审核和后续 scale 都有不确定性。
- 即使 CTR 高，也可能吸引“看 IP 爽图”的流量，不一定转化为 Makaron 核心用户。

### 过度 romantic / intimate 类

包括：

- Rainy Kiss
- Date Vlog 如果表达太像真实恋爱合成

原因：

- 容易碰到肖像、亲密关系、误导性合成的敏感边界。
- 第一轮不需要冒这个风险。

### Utility 类

包括：

- Palm Reading
- Hairstyle Analysis
- E-Commerce Listing
- Food Photo

原因：

- 这些更适合搜索 / SEO / retargeting，不适合 Asian-cool Reels 冷启动。
- 素材冲击弱，第一轮不应分散预算。

## 建议的第一轮 Campaign 结构

### Campaign A：Idol-Era / Asian-Cool 主线

预算占比：55%

投放 skill：

1. One-Take
2. Broadcast Candid
3. Photo Booth Pack

目标：

- 验证 Asian-cool creative-led targeting 是否能拿到上传和注册。
- Landing 直接落具体 skill 页，不投综合首页。

核心 KPI：

- CTR
- skill page ViewContent -> upload / project create
- CompleteRegistration
- InitiateCheckout / Subscribe

### Campaign B：Pet Viral 低成本流量池

预算占比：25%

投放 skill：

1. Pet Mugshot
2. Pet Action Movie
3. Pet Movie Poster 或 Who Is That Pet

目标：

- 拿低 CPC / 高分享素材。
- 测试非 Asian-cool 但高 viral 的流量性价比。

### Campaign C：Photo-to-Video / Template 工具线

预算占比：20%

投放 skill：

1. Photo to Video
2. Seamless and silky transition
3. Character Select 小预算插入测试

目标：

- 对标 Mojo / OnBeat / Vidix 这类视频工具广告。
- 看 Makaron 是否能在 “template/video” 人群里吃到量。

## 素材改造总规则

现有素材不能直接大量投。不是因为质量差，而是因为它们更像 showcase，不像 direct-response ad。

所有素材都要改成这个结构：

1. 前 0-1 秒：先给结果，或给强烈问题/POV
2. 前 1-2 秒：明确原始输入是什么
3. 2-4 秒：展示 Makaron skill / upload / create
4. 4-7 秒：展示最终结果和变体
5. 结尾：`Try it with your photo` / `Create yours`

必须出现：

- 用户原图 / 宠物原图 / 手机相册输入
- Makaron skill 名称
- 结果成品
- 明确 CTA

尽量不要出现：

- 长解释
- “AI photo editor”
- “all-in-one AI tool”
- 纯成品混剪但不解释怎么来的

## 每个优先 skill 的素材生产任务

### One-Take

需要新做：

- 3 条 9:16 视频
- 2 张 before/after static

分镜：

- `Bedroom selfie -> stage close-up -> wide stage -> Makaron UI -> final reveal`

### Broadcast Candid

需要新做：

- 3 条 9:16 视频
- 1 条 tutorial-style UGC

分镜：

- `Selfie -> phone upload -> TV broadcast lower-third -> shocked reaction -> crowd cheering`

### Photo Booth Pack

需要新做：

- 3 条 9:16 视频
- 3 张 static carousel

分镜：

- `Camera roll grid -> one selfie selected -> 4-frame strip -> CCD date stamp -> flash snap`

### Pet Mugshot / Pet Action Movie

需要新做：

- 4 条 9:16 视频，每个 skill 2 条
- 2 张 static before/after

分镜：

- `Messy pet photo -> crime label -> mugshot reveal`
- `Pet photo -> suit/action scene -> movie poster/title card`

### Photo to Video

需要新做：

- 3 条场景化视频，不要泛 demo

分镜：

- `Still photo -> moving scene -> mini movie`
- 每条绑定一个具体主题：idol / pet / travel，不要空泛。

## 最终建议

第一轮最有流量性价比的组合：

1. **One-Take**：最贴 Asian-cool / idol-era，负责品牌方向和高意图用户。
2. **Broadcast Candid**：吃 stadium camera / kiss cam trend，差异化强。
3. **Photo Booth Pack**：吃 Remini/Hypic 已验证的 photobooth + nostalgia 需求，生成成本低。
4. **Pet Mugshot / Pet Action Movie**：负责低成本流量和 viral 分享，不和主线混 campaign。
5. **Photo to Video**：只作为场景化视频，不打泛词。

第一轮不要急着投 10 个 skill。更好的做法是：

> 5 个 skill cluster，每个 3 条视频素材，先跑 7 天，看上传率和注册/checkout，再决定扩素材还是换 skill。
