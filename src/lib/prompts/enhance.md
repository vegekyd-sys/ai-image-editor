## enhance（专业增强）— 2个

让照片整体变好看，变化必须3秒内肉眼可见。追求"整体感"——光线、色彩、人物、景深一起提升。

---

## ⚠️ 第一步：判断人脸大小！（每次分析图片必须先做这步）

- **大脸**（特写/半身照，脸部占画面 >10%）→ 正常处理
- **小脸**（全身照/合照/远景/广角，脸部占画面 <10%）→ 触发小脸保护模式

**小脸保护模式：所有editPrompt必须加入以下句子（字面照抄）：**
> "CRITICAL: Faces in this photo are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region in any way. Apply all edits only to background, environment, and clothing. Treat face areas as if they are masked off and invisible to you."

小脸时不要写 "luminous skin"、"slim face"、"enlarge eyes" 等任何面部处理指令——这些在小脸上会导致马赛克感或面部重新生成。光影/色彩改变只作用于环境和身体，面部区域保持原样。

---

## ✅ 必选方向（只从以下6个选！禁止其他方向！）

2个enhance必须选**不同**方向：

| 代号 | 方向 | 核心变化 | 稳定得分 |
|------|------|---------|---------|
| A | 电影感光影 | 戏剧性侧光 + 青橙对比 + 暗角 + 强景深分离 | 8分 |
| B | 黄金时刻 | 色温转暖 + 发丝光/边缘光 + 天空变金橙 | 8分 |
| C | 阴天变晴天 | 灰白天空变蓝天白云 + 提亮 + 通透感 | 8分 |
| D | 夜景/傍晚氛围 | 白天变傍晚/夜晚 + 灯光亮起 | 8分 |
| E | 强景深分离 | 主体超清 + 背景大幅虚化 + 光斑 | 8分 |
| F | 天气改造 | 加入雨雾/雪景/云层增强氛围 | 8分 |

⚠️ **已验证的低分方向（禁止！）**：
- "复古胶片质感" / "日系清新" — 变化太微妙，反复测试均只得6分
- "微调色温/白平衡" — 普通人完全看不出，3分
- "柔焦梦幻/梦境效果" — "看起来很廉价，有很重的年代感"，1分

方向F使用警告：原图背景如果是复杂场景（街道/餐厅/建筑群），"改天气"很可能变成"抠图换背景"=2分灾难。复杂场景背景请选A-E。

---

## 📝 editPrompt必须包含的固定句子（每条都必须有，字面照抄）

**句子1（场景净化，必须是第一句）：**
> "FIRST: Clean up the scene — remove any element that draws attention away from the main subject but adds no compositional value (cluttered objects, background people, distracting items). Replace with natural-looking scene."

**句子2（背景锚定）：**
> "Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."

**句子3（瘦脸，有人物时）：**
> "If and only if the person has a clearly defined adult jawline: apply a visible V-line face-slimming effect, narrowing the jaw width and slimming the lower face contour. For children or people with naturally round/soft faces, do NOT apply any face-slimming or face modification whatsoever. The upper face (eyes, nose, forehead) must remain completely unchanged for everyone."

**句子4（人脸保真）：**
> "Preserve each person's identity, bone structure, face shape exactly. Do not make faces wider, rounder, or alter jaw lines."

**句子5（收尾）：**
> "Do NOT add any text, watermarks, or borders."

⚠️ **绝对禁止修改眼睛大小/形状**——眼部改动会导致面部重新生成，人物认不出来。

皮肤描述措辞：用 "luminous, translucent skin with natural micro-texture"，禁止 "smooth skin" / "porcelain" / "flawless" / "soft focus on face"。

---

## 三问自检（每个enhance tip输出前必须全部通过）

**Q1：放在原图旁边，任何人都能3秒内一眼看出"变好看了"吗？**
- ✅ 光影氛围彻底改变（方向A电影感）、阴天变晴天（方向C）
- ❌ 微妙的锐化/细节增强（3分，"看不出变化"）、几乎看不出的胶片颗粒（3分）
- 自检：想象用户左右滑动对比原图和编辑图，**3秒内能指出哪里变了吗？** 指不出=换更大的变化方向

**Q2：增强风格与照片情绪匹配吗？**
- ✅ 搞笑合照 → 明亮活泼（通透提亮）
- ✅ 浪漫约会 → 暖光金色（方向B）
- ❌ 搞笑表情配阴天沉闷（4分，"不一定合适"）

**Q3：编辑后的背景还是原图的背景吗？**
- ✅ 原图是海滩，编辑后还是同一个海滩，只是光影/色彩变了
- ❌ 原图是海滩，编辑后背景完全不同了（3分，"背景被换掉了"）
- ❌ 编辑后人物都变了、认不出（1分，"人物都变了"）

---

## 核心原则

#### 通透感是第一优先级
- 皮肤要通透、有光泽、气色好——不是"磨皮"而是"让皮肤发光"
- 保留皮肤自然纹理、微小阴影变化（嘴角、腮帮、眼窝的细微光影）

#### 前后景深分离 + 背景净化
- 前景人物和背景必须有不同的景深处理，创造视觉层次
- 必须去除所有干扰构图的元素：背景路人/杂物、前景遮挡物（电线杆、路牌、垃圾桶、乱停的车）

#### 色调多样性
- 避免单一色调铺满全画面（如整体过黄、过粉）
- ❌ 禁止："Everything bathed in yellow/pink" → ✅ "Warm highlights with cool shadow tones for contrast"

#### 2个tip必须视觉上完全不同
- ❌ 都用暖光/都用金色（6分，"跟第一张类似"）
- ✅ 一个做光影氛围（如方向A），另一个做环境变化（如方向C或F）

#### editPrompt必须包含"锚点变化"
每个editPrompt都必须有至少一个观者能立刻指出的具体视觉变化点：
- ✅ "天空从灰白变为通透蓝色+白云" — 一眼可见
- ✅ "侧光在人物轮廓形成金色边缘光" — 一眼可见
- ❌ "增加微妙的胶片颗粒" — 需要凑近才看到 = 3分

---

## 评分标杆

- **10分公式**：通透感 + 人物轮廓保真 + 前后景深变化 + 自然色调 = WOW
- 8分稳定：电影感光影（A）、黄金时刻（B）、阴天变晴天（C）、夜景氛围（D）
- 致命错误：只做微妙锐化（3分）、背景被换掉（3分）、脸变宽/变胖（6分）
