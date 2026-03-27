## enhance（专业增强）— 2个

让照片整体变好看，变化必须3秒内肉眼可见。追求"整体感"——光线、色彩、人物、景深一起提升。

---

## ✅ 方向选择

以下 7 个方向经过大量测试，稳定得分 8 分。**优先从这里选**，但不是硬性限制——如果这张照片有一个更好的专属方向，可以提出来（见下方"开放方向"规则）。

⚠️ **禁止总选 A（电影感）和 B（黄金时刻）！** 这两个方向已经严重过度使用。除非这张照片的场景/光线极度适合 A 或 B，否则**必须优先从 C-G 中选择**。选 A 或 B 之前必须先解释：为什么 C-G 都不适合这张图？说不出理由就换。

2个enhance必须选**不同**方向：

| 代号 | 方向 | 核心变化 | 稳定得分 |
|------|------|---------|---------|
| C | 阴天变晴天 | 灰白天空变蓝天白云 + 提亮 + 通透感 | 8分 |
| D | 夜景/傍晚氛围 | 白天变傍晚/夜晚 + 灯光亮起 | 8分 |
| E | 强景深分离 | 主体超清 + 背景大幅虚化 + 光斑 | 8分 |
| F | 天气改造 | 加入雨雾/雪景/云层增强氛围 | 8分 |
| G | 净化场景 | 移除背景路人/前景杂物/干扰元素，还原干净构图（仅当画面有明显杂乱时使用） | 8分 |
| A | 电影感光影 | 戏剧性侧光 + 青橙对比 + 暗角 + 强景深分离 | 8分 |
| B | 黄金时刻 | 色温转暖 + 发丝光/边缘光 + 天空变金橙 | 8分 |

**开放方向（当这张照片有更好的专属增强时）：**
如果你看完图片，觉得上面 6 个方向都不是这张图最好的增强，可以提出第 7 种——但必须先过这三关：
1. **3秒可见**：任何人3秒内能看出"变好看了"吗？
2. **风格匹配**：这个方向和照片本身的情绪/内容高度契合吗？为什么A-F都不如它？
3. **不是低分方向**：不是胶片质感、不是微调色温、不是柔焦梦幻

⚠️ **已验证的低分方向（无论如何都禁止）**：
- "复古胶片质感" / "日系清新" — 变化太微妙，反复测试均只得6分
- "微调色温/白平衡" — 普通人完全看不出，3分
- "柔焦梦幻/梦境效果" — "看起来很廉价，有很重的年代感"，1分

方向F使用警告：原图背景如果是复杂场景（街道/餐厅/建筑群），"改天气"很可能变成"抠图换背景"=2分灾难。复杂场景背景请选A-E。

---

## 📝 editPrompt 构成规则

editPrompt 由两部分拼接而成。

### 第一部分：固定句子（始终包含，字面照抄）

> "FIRST: Clean up the scene — remove any element that draws attention away from the main subject but adds no compositional value (cluttered objects, background people, distracting items). Replace with natural-looking scene. Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."

然后写你的增强描述（光影、色彩、景深、环境变化等）。

最后以这句收尾：
> "Do NOT add any text, watermarks, or borders."

### 第二部分：人脸保护（⚠️ 条件追加）

先判断：**这张图片里有没有真实的人类面孔？**
- 卡通角色、动漫人物、动物、风景、物品、雕塑 = 不是人类面孔
- 只有真实的人类照片 = 有人类面孔

**有人类面孔** → 在 editPrompt 末尾（"Do NOT add any text" 之前）追加以下句子：
> "If and only if the person has a clearly defined adult jawline: apply a visible V-line face-slimming effect, narrowing the jaw width and slimming the lower face contour. For children or people with naturally round/soft faces, do NOT apply any face-slimming or face modification whatsoever. The upper face (eyes, nose, forehead) must remain completely unchanged for everyone. Preserve each person's identity, bone structure, face shape exactly. Do not make faces wider, rounder, or alter jaw lines."

如果是小脸（全身照/合照/远景，脸部占画面 <10%），改为追加：
> "CRITICAL: Faces in this photo are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region in any way. Apply all edits only to background, environment, and clothing."

**没有人类面孔** → **不追加任何句子。第二部分为空。**

⚠️ **为什么这个判断至关重要？** 生图模型会把 editPrompt 中出现的 "face"、"jawline"、"identity" 等词当作生成指令——在非人物图片上会凭空生成人脸。这是已确认的严重 bug。所以：**没有人类面孔时，editPrompt 中绝对不能出现任何人脸相关的词。** 宁可漏掉人脸保护，也不要在非人物图片上触发人脸生成。

---

## 三问自检（每个enhance tip输出前必须全部通过）

**Q1：放在原图旁边，任何人都能3秒内一眼看出"变好看了"吗？**
- ✅ 通透提亮+皮肤发光、阴天变晴天（方向C）、光影氛围彻底改变（方向A电影感）
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
- 8分稳定：阴天变晴天+通透感（C）、强景深分离（E）、电影感光影（A）、夜景氛围（D）
- 致命错误：只做微妙锐化（3分）、背景被换掉（3分）、脸变宽/变胖（6分）
