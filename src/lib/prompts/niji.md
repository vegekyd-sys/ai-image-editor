## niji（二次元画风）— 2个

把真实照片转化为二次元动漫插画风格。核心是**画风转换**——不是加滤镜，而是完全重绘为统一的 2D 动漫画面。

### 三问自检（每个niji tip必须全部通过）

**Q1：画风匹配了吗？** — 照片的情绪/场景 → 画风选择必须有因果关系。
- ✅ 明亮活泼的日常 → 萌系 Moe（大眼圆润、元气满满）
- ✅ 安静文艺的独照 → 透明感 Transparency（空气感、清冷氛围）
- ✅ 潮流街拍/电竞 → 鲜艳动感 Vibrant（霓虹撞色、动感线条）
- ✅ 复古场景/老照片 → 复古90年代 Retro（赛璐璐平涂、胶片质感）
- ✅ 暗黑哥特/忧郁气质 → 地雷系 Jirai-kei（粉紫+黑灰、脆弱美学）
- ✅ 帅气冷酷/大片感 → 半写实 PBR（游戏CG、电影级光影）
- ❌ 随便选一个画风套上去，跟照片情绪完全不搭

**Q2：保留了什么？** — 原图的构图、人物姿态、场景布局必须保持，只是"换了一层皮"。
- ✅ 人还是那个姿势，场景还是那个场景，只是变成了动漫画风
- ✅ 人物的发型、配饰、衣服特征都能对应上
- ❌ 人物姿势完全变了、场景被换掉了 — 说明方向选错了，不需要重画
- ❌ 多人照片里人数变了、位置变了

**Q3：有辨识度吗？** — 3秒内能看出是哪种画风。6种画风之间必须拉开差距。
- ✅ 萌系 vs 透明感：眼睛大小、色彩饱和度、线条粗细完全不同
- ✅ 鲜艳动感 vs 复古90年代：一个是霓虹荧光，一个是怀旧暖色
- ❌ 两个 tip 选了视觉上相似的画风（如萌系和透明感只差一点点 — 必须在关键特征上拉开）
- ❌ 画风特征不够极致，看不出是什么风格 — 宁可过火也不要暧昧

---

### ✅ 画风方向（6选2，必须选不同方向）

| 代号 | 画风 | 核心特征 | editPrompt 关键词 |
|------|------|---------|------------------|
| A | 萌系 Moe | 大眼、圆润、明亮清新、碧蓝档案风 | large sparkling eyes, rounded features, bright pastel palette, kawaii aesthetic |
| B | 透明感 Transparency | 清淡通透、自然光影、空气感、米山舞风 | ethereal transparency, soft diffused lighting, desaturated cool tones, airy negative space |
| C | 鲜艳动感 Vibrant | 高饱和荧光撞色、动感线条、Mika Pikazo风 | hypersaturated neon colors, dynamic flowing lines, cyberpunk texture, explosive energy |
| D | 复古90年代 Retro | 赛璐璐阴影、粗线条、胶片颗粒、City Pop | cel-shaded flat colors, thick outlines, film grain VHS overlay, retro 90s anime aesthetic |
| E | 地雷系 Jirai-kei | 粉紫+黑灰、绷带眼泪、脆弱感、哥特萝莉 | pink-purple with dark accents, bandages and tears motif, gothic lolita, fragile melancholy |
| F | 半写实 PBR | 真实比例、精细材质、电影光影、游戏CG风 | semi-realistic proportions, PBR material rendering, cinematic volumetric lighting, game CG quality |

**各画风详细说明：**

**A. 萌系 Moe**
碧蓝档案 / 原神 / Vtuber 立绘风格。标志性大眼睛（占脸部面积 30%+），虹膜多层高光，圆润的五官和体型。色彩明亮饱和但不刺眼，偏粉蓝黄的糖果色系。线条干净利落，阴影柔和。适合：活泼日常、可爱自拍、甜美场景。

**B. 透明感 Transparency**
米山舞 / loundraw 风格。用色极度克制——水彩般的淡色调，大量留白和负空间。光影是灵魂：逆光、侧光穿透发丝和衣物边缘，营造"空气可见"的通透感。眼睛不大但极精致，瞳孔有水光。线条纤细若有若无。适合：安静独照、文艺场景、自然光环境。

**C. 鲜艳动感 Vibrant/Dynamic**
Mika Pikazo / LAM 风格。色彩是武器——荧光粉、电光蓝、酸性绿大面积碰撞。动态流线和速度线贯穿画面，头发和衣物像被风暴吹起。瞳孔里可能有十字星或几何图案。背景充满赛博朋克纹理、数据流、光粒子。适合：潮流穿搭、运动瞬间、电竞/科技场景。

**D. 复古90年代 Retro/90s**
《美少女战士》/ 《城市猎人》/ City Pop 风格。赛璐璐平涂上色——色块边缘锐利，阴影只有 1-2 层。粗而均匀的黑色描边。VHS 胶片颗粒和扫描线覆盖。色调偏暖黄橙，带怀旧感。眼睛细长有棱角（不是圆萌系）。适合：复古穿搭、城市街景、怀旧情绪照片。

**E. 地雷系 Jirai-kei**
地雷系 / 病み可愛い 风格。配色极端——粉红+紫罗兰+黑灰，偶尔点缀血红。装饰性极强：绷带、十字架、眼泪纹身、破碎玫瑰、蝴蝶结过量。人物表情在微笑和哭泣之间——"笑着流泪"。暗角和颗粒增加压抑感。适合：暗黑穿搭、忧郁情绪照、哥特/朋克风格。

**F. 半写实 PBR**
游戏 CG / 虚幻引擎过场风格。人体比例接近真实（不是大头短身），五官精细但仍有动漫特征（略大的眼睛、尖下巴）。重点在材质渲染——皮肤有次表面散射、头发逐根可辨、衣物纤维可见。电影级体积光和景深。适合：帅气/冷酷人物、大片感照片、想要"像游戏角色"的需求。

---

### 📝 editPrompt 必须包含的固定句子（每条都必须有，字面照抄）

**句子1（构图锚定）：**
> "Maintain the exact same composition, pose, and scene layout as the original photo."

**句子2（人脸映射）：**
> "Map each person's face to anime proportions while preserving their unique identity features (hairstyle, accessories, expression direction)."

**句子3（画风一致性，[STYLE_NAME] 替换为具体画风名）：**
> "Apply [STYLE_NAME] style consistently across the entire frame — characters, background, lighting must all be in the same art style."

**句子4（禁止混搭）：**
> "Do NOT mix realistic and anime elements — everything must be fully converted to 2D anime illustration."

**句子5（收尾）：**
> "Do NOT add any text, watermarks, or borders."

---

### 执行标准

#### 全面转换，不留死角
- 人物、背景、前景物品、光影全部必须转为同一画风
- ❌ 人物是动漫风但背景还是照片 — 这是最常见的失败模式
- ❌ 主体是动漫风但手/脚还是写实的

#### 人物身份保留
- 发型（长度、颜色、刘海形状）必须对应原图
- 衣服款式和颜色必须对应原图
- 配饰（眼镜、帽子、耳环、项链）必须保留
- 表情方向（微笑/严肃/大笑）必须一致
- 多人照片中人物数量和相对位置不能变

#### 画风特征要拉满
- 每种画风都有核心视觉特征（见上方详细说明），必须做到位
- 萌系的眼睛必须够大、透明感的色彩必须够淡、鲜艳的颜色必须够冲击
- 做到 70% 不如做到 120% — 画风暧昧不如画风极致

#### 2个 tip 必须视觉上完全不同
- ❌ 都选了暖色系画风（如萌系 + 复古 — 都偏暖）
- ✅ 一个冷色系（透明感/鲜艳动感）+ 一个暖色系（萌系/复古）
- ✅ 一个线条感强的（复古/鲜艳）+ 一个色彩渲染型的（透明感/半写实）

#### 多人照片处理
- 所有人物必须转为同一画风，不能一个萌系一个半写实
- 人物之间的互动关系（搂肩、牵手、对视）必须保持
- 背景人群也要转为动漫风格，不能留写实路人

---

### 评分标杆

- **10分公式**：画风极致 + 身份可辨 + 构图完全保留 + 全画面统一 = "这就是我的动漫形象！"
- 8分稳定：画风特征到位、人物可辨认、全画面统一转换
- 致命错误：画风混搭（人物动漫+背景写实=3分）、人物认不出（身份丢失=3分）、构图完全变了（2分）
