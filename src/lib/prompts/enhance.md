## enhance（专业增强）— 2个

让照片整体变好看，追求"整体感"——光线、色彩、人物、景深一起提升。
评分标杆（用户给9-10分的特征）：通透感 + 人物轮廓保真 + 前后景深变化 + 自然色调 = wow

### 三问自检（每个enhance tip必须全部通过）

**Q1：放在原图旁边，任何人都能一眼看出"变好看了"吗？**
- ✅ 光影氛围彻底改变（10分电影感）、阴天变晴天（8分）
- ❌ 微妙的锐化/细节增强（3分，"看不出变化"）、几乎看不出的胶片颗粒（3分）

**Q2：增强风格与照片情绪匹配吗？**
- ✅ 搞笑合照 → 明亮活泼（日系清新、通透提亮）
- ✅ 浪漫约会 → 暖光金色
- ❌ 搞笑表情配阴天沉闷（4分，"不一定合适"）

**Q3：编辑后的背景还是原图的背景吗？**
- ✅ 原图是海滩，编辑后还是同一个海滩，只是光影/色彩变了
- ✅ 原图是泳池，编辑后还是同一个泳池，水的颜色更好看了
- ❌ 原图是海滩，编辑后背景完全不同了（3分，"背景被换掉了，不符合enhance"）
- ❌ 编辑后人物都变了、认不出是同一个人（1分，"人物都变了"）
- enhance是提升原图，不是生成新图！editPrompt必须包含"Keep the original background scene intact"

### 核心原则

#### 1. 通透感是第一优先级
- 皮肤要通透、有光泽、气色好——不是"磨皮"而是"让皮肤发光"
- 保留皮肤自然纹理、微小阴影变化（嘴角、腮帮、眼窝的细微光影）
- editPrompt写法：用"luminous, translucent skin with natural micro-texture"，不用"smooth skin"
- ❌ 绝对禁止：过度磨皮、蜡像质感、塑料感皮肤

#### 2. 人物轮廓+微表情保真
- 必须保留人物的神韵和微表情（如嘴角的小皱纹、眼神方向、微笑弧度）
- 允许适度优化五官比例（如脸稍微P小一点、下巴线条更流畅），用户明确允许适度P脸
- editPrompt必须写："Preserve every subtle facial expression, micro-wrinkles, and the person's unique facial character. Slightly refine facial proportions for a more flattering look while keeping identity intact."

#### 3. 前后景深分离 + 背景净化
- 前景人物和背景必须有不同的景深处理，创造视觉层次
- 人物是视觉焦点，背景要有适当的虚化或光影区隔
- **必须去除杂乱的背景路人**：如果背景有无关紧要的路人/杂物干扰构图，必须在enhance中清理掉（V11四个tip因"背景人物没去除"扣分）
- editPrompt必须写："Create clear depth separation — sharp focus on foreground subjects with natural background depth falloff. IMPORTANT: Remove ALL background pedestrians, bystanders, and passersby completely — replace with clean, empty background."

#### 4. 色调多样性
- 避免单一色调铺满全画面（如整体过黄、过粉）
- 即使用暖色/冷色调，也要保持色彩丰富性和层次感
- ❌ 禁止："Everything bathed in yellow/pink" → ✅ "Warm highlights with cool shadow tones for contrast"

#### 5. 情绪匹配（极其重要！）
- 先判断照片的情绪基调：搞笑/轻松/浪漫/庄严/冒险/温馨？
- enhance的风格必须与照片情绪匹配：
  * 搞笑合照（鬼脸、夸张表情） → 明亮活泼的调色（日系清新、通透提亮），不要阴沉暗调
  * 浪漫约会 → 暖光柔和、金色光影
  * 壮丽风景 → 戏剧性光影、HDR
  * 城市街拍 → 电影感冷暖对比、胶片
- ❌ 致命错误：搞笑表情配沉闷阴天氛围(4分)、活泼场景配压抑暗调

### 2个tip从以下方向中选最适合画面的组合：

#### 方向A：氛围光影升级（推荐首选，9分稳定）
根据画面情绪选最匹配的光影+调色方案：
- 电影级光影：青橙对比、侧光轮廓、戏剧性明暗（高分方向）
- 晴天通透：把阴天变晴天+蓝天白云+皮肤通透气色好（高分方向）
- 黄金时刻：温暖侧光+金色主光但阴影保持冷调对比（注意别整体过黄！）
- 日系清新：高亮度低饱和+自然通透肤色
- 冷蓝夜景：冷调蓝紫+霓虹反光+皮肤通透
- 暗调聚焦：压暗环境突出主体+戏剧性打光（高分方向）

#### 方向B：天气/环境氛围增强
整体大气变化，不是加滤镜：
- 丁达尔光束穿过树林/建筑
- 唯美雨丝+湿润反光+室内暖光对比
- 北极光+星空

⚠️ **方向B自检：天气改造还是换背景？**
原图背景是"有内容的场景"（街道、餐厅、建筑群）还是"纯自然环境"（天空、山、水）？
- 纯自然环境 → ✅ 天气改造效果好（漓江阴天→晴天=10分）
- 复杂场景背景 → ⚠️ "改天气"很可能变成"抠图换背景"=2分灾难 → 用方向A代替

#### 方向C：复古质感（仅当画面适合时）
- Kodak Portra 400：柔和颗粒+温暖肤色但不过度
- 90年代杂志质感：略微交叉冲洗色调+光泽纸感（高分方向）
- CineStill 800T：钨丝灯光感

#### 方向D：HDR质感增强
增强动态范围+暗部细节+高光层次+色彩饱满

### 禁止方向（用户反馈差）
- ❌ 柔焦梦幻/梦境效果——"看起來很廉價，有很重的年代感"(1分)
- ❌ 全画面统一色温——"整體色調過黃，没有前景后景的光影处理"(1分)
- ❌ 过度虚化背景——"背景虛化過度"(5分)
- ❌ 微妙到看不出变化的增强——"看不出变化不ok"(3分)、"带来的视觉冲击不强"(6分)

### 视觉冲击力是必须的！
- 10分标杆：电影感光影把整个光影氛围彻底改变，一眼就看到提升
- ❌ 致命错误：只做微妙的锐化/细节增强(3分)、几乎看不出的胶片颗粒(3分)
- enhance必须做到：放在原图旁边，任何人都能一眼看出"哇变好看了"
- 如果增强方向的视觉变化不够大，宁可选一个更戏剧性的光影方案

### editPrompt必须包含至少一个"锚点变化"
每个enhance editPrompt都必须描述至少一个观者能立刻指出的具体视觉变化点：
- ✅ "天空从灰白变为通透蓝色+白云" — 一眼可见
- ✅ "侧光在人物轮廓形成金色边缘光" — 一眼可见
- ✅ "背景从杂乱变为干净虚化" — 一眼可见
- ✅ "整体色调从偏冷灰变为温暖青橙电影感" — 一眼可见
- ❌ "增加微妙的胶片颗粒" — 需要凑近才看到=3分
- ❌ "轻微锐化细节" — 几乎看不出=3分
- ❌ "微调白平衡" — 普通人看不出=4分
自检：想象用户左右滑动对比原图和编辑图，**3秒内能指出哪里变了吗？** 指不出=换更大的变化方向。

### 已验证的高分enhance方向（优先选择！）
以下方向在用户测试中持续获得8-10分：
- **电影感光影**：戏剧性侧光+青橙对比+暗角+强景深分离 — 最稳定的8分方向
- **白天→黄金时刻**：整体色温转暖+发丝光/边缘光+天空变金橙 — 视觉冲击极强
- **阴天→晴天**：灰白天空变蓝天白云+提亮+增加通透感 — 一眼可见
- **夜景氛围**：白天场景变为傍晚/夜晚+灯光亮起 — 戏剧性最强
- **强景深分离**：主体超清+背景大幅虚化+光斑 — 专业感极强
⚠️ 已验证的低分方向（避免！）：
- "复古胶片质感" — 反复测试均只得6分，变化太微妙
- "日系清新" — 变化太小，看不出区别
- "微调色温/白平衡" — 普通人完全看不出

### 重要约束
- 2个enhance tip必须选**视觉上完全不同的方向**！用户必须一眼就能看出两张图的区别。
  * ❌ 都用暖光/都用金色/都做类似的光影调整(6分，"跟第一张类似")
  * ✅ 一个做光影氛围(如电影感)，另一个做环境/质感(如胶片质感或天气改造)
  * ✅ 一个偏暖色调，另一个偏冷色调或完全不同的风格
- enhance可以调整构图（裁切/比例），但编辑后必须一眼认出是同一张照片。**"画面变化太多了"=3分** — 不能改变场景内容，只能提升光影/色彩/质感/构图
- 每个editPrompt都必须包含：光影方案 + 色彩方案 + 景深处理 + 背景净化 + 人物美化（有人物时） + **"Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."**
- ⚠️ **人脸形状保真是enhance最大扣分项**：V8中3个enhance因"脸变胖"扣到6分
  * editPrompt必须包含：**"Preserve each person's face shape, bone structure, and proportions exactly — do not make faces wider, rounder, or alter jaw lines."**
  * 允许适度P小脸（用户允许），但绝不能把脸变胖/变宽
- 皮肤处理措辞：
  * ✅ "luminous, translucent skin preserving natural texture and micro-shadows"
  * ✅ "healthy, glowing complexion with natural pore texture retained"
  * ❌ "smooth skin" / "porcelain" / "flawless" / "soft focus on face"
- 无人物时跳过美颜，做纯光影+色彩+景深+质感提升

### ⚠️ 小脸场景特殊处理（全身照/合照/远景/广角）
当人脸在画面中占比小时，enhance的face preservation更难。
- editPrompt必须包含：**"CRITICAL: Faces in this photo are small. Each person's face must remain PIXEL-IDENTICAL to the original — same face shape, same skin, same features, same expression. Do NOT regenerate, retouch, relight, or alter any face. Copy faces exactly as-is."**
- 小脸场景下，不要写 "luminous skin" 或 "refine facial proportions" 等涉及面部处理的指令——这些在小脸上会导致面部重新生成
- 光影/色彩改变只作用于环境和身体，面部区域保持原样
