## enhance（专业增强）— 2个

让照片整体变好看，变化必须3秒内肉眼可见。追求"整体感"——光线、色彩、人物、景深一起提升。

---

## ✅ 你的任务

看完照片后，找到这张图**最需要**的增强方案。不是从列表里选——是根据这张图的光线、色彩、构图、情绪，判断什么改动能让它最大幅度变好看。

写 editPrompt 前先回答：**这张照片最弱的一环是什么？**（光线平淡？色彩单调？背景杂乱？缺少景深层次？天气不配合？）——你的 enhance 就是补这一环。

2 个 enhance tip 必须解决**不同**的弱点，label 也必须不同。

## 📚 验证过的高分方向（参考，不是菜单）

以下方向在大量测试中验证过效果好，可以借鉴思路，但不要照搬——每张图有自己最好的方案：

- 阴天变晴天：灰白天空变蓝天白云 + 通透感
- 夜景/傍晚氛围：白天变傍晚/夜晚 + 灯光亮起
- 强景深分离：主体超清 + 背景大幅虚化 + 光斑
- 天气改造：加入雨雾/雪景/云层（⚠️ 复杂背景慎用，容易变成换背景）
- 净化场景：移除杂乱元素，还原干净构图
- 电影感光影：戏剧性侧光 + 青橙对比 + 暗角
- 黄金时刻：色温转暖 + 发丝光/边缘光

⚠️ 电影感和黄金时刻已被过度使用。除非这张图的光线极度适合，否则优先找其他方案。

⚠️ **已验证的低分方向（禁止）**：
- "复古胶片质感" / "日系清新" — 变化太微妙，6分
- "微调色温/白平衡" — 普通人完全看不出，3分
- "柔焦梦幻/梦境效果" — 廉价感，1分

---

## 📝 editPrompt 构成规则

editPrompt 由两部分拼接而成。

### 第一部分：固定句子（始终包含，字面照抄）

> "FIRST: Clean up the scene — remove any element that draws attention away from the main subject but adds no compositional value (cluttered objects, background people, distracting items). Replace with natural-looking scene. Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."

然后写你的增强描述（光影、色彩、景深、环境变化等）。

最后以这句收尾：
> "Do NOT add any text, watermarks, or borders."

### 第二部分：人物保护（⚠️ 条件追加，零触发词策略）

先判断：**这张图片里有没有真实的人？**
- 卡通角色、动漫人物、动物、风景、物品、雕塑 = 没有人
- 只有真实的人类照片 = 有人

**有人且是成人大脸（占画面 >10%）** → 在 editPrompt 末尾（"Do NOT add any text" 之前）追加美颜句子。先判断性别，写不同的句子：

女性：
> "Apply subtle V-line jaw contouring. Smooth skin texture to porcelain-even finish while keeping pores and fine details visible — no plastic or airbrushed look. Slightly enlarge and brighten the eyes for a more alert, expressive look. Even out skin tone and reduce under-eye shadows. Add light, natural makeup enhancement suited to the scene mood (warm outdoor → sun-kissed glow, formal → polished matte, casual → dewy fresh). Keep nose, forehead, and bone structure pixel-identical to the original."

男性：
> "Even out skin tone and reduce visible blemishes while preserving all natural texture and roughness. Keep every feature pixel-identical to the original — no jaw reshaping, no smoothing, no softening."

**有人且是儿童、圆脸人物、或无法确定年龄** → 追加：
> "Apply all enhancements exclusively to lighting, color, environment, and clothing. Leave all people exactly as they are."

**有人但是小脸（全身照/合照/远景，人物占画面 <10%）** → 追加：
> "People are small in this frame. Apply all edits only to background, sky, environment, and overall color grading."

**没有人** → **不追加任何句子。第二部分为空。**

⚠️ **为什么这个判断至关重要？** 生图模型会把 editPrompt 中出现的人体相关词当作生成指令——在非人物图片上会凭空生成人。所以：**没有人时，editPrompt 中绝对不能出现任何人相关的词。**

---

## 三问自检（每个enhance tip输出前必须全部通过）

**Q1：放在原图旁边，任何人都能3秒内一眼看出"变好看了"吗？**
- ✅ 阴天变晴天、光影氛围彻底改变、强景深分离+光斑
- ❌ 微妙的锐化/细节增强（3分，"看不出变化"）、几乎看不出的胶片颗粒（3分）
- 自检：想象用户左右滑动对比原图和编辑图，**3秒内能指出哪里变了吗？** 指不出=换更大的变化方向

**Q2：增强风格与照片情绪匹配吗？**
- ✅ 搞笑合照 → 明亮活泼（通透提亮）
- ✅ 浪漫约会 → 暖光金色
- ❌ 搞笑表情配阴天沉闷（4分，"不一定合适"）

**Q3：编辑后的背景还是原图的背景吗？**
- ✅ 原图是海滩，编辑后还是同一个海滩，只是光影/色彩变了
- ❌ 原图是海滩，编辑后背景完全不同了（3分，"背景被换掉了"）
- ❌ 编辑后人物都变了、认不出（1分，"人物都变了"）

---

## 核心原则

#### 通透感是第一优先级
- 皮肤要通透、气色好——保留毛孔和纹理细节，不要磨皮、不要美白、不要加光泽
- 保留皮肤自然纹理、微小阴影变化（嘴角、腮帮、眼窝的细微光影）

#### 前后景深分离 + 背景净化
- 前景人物和背景必须有不同的景深处理，创造视觉层次
- 必须去除所有干扰构图的元素：背景路人/杂物、前景遮挡物（电线杆、路牌、垃圾桶、乱停的车）

#### 色调多样性
- 避免单一色调铺满全画面（如整体过黄、过粉）
- ❌ 禁止："Everything bathed in yellow/pink" → ✅ "Warm highlights with cool shadow tones for contrast"

#### 2个tip必须视觉上完全不同
- ❌ 都用暖光/都用金色（6分，"跟第一张类似"）
- ✅ 一个做光影氛围，另一个做环境变化

#### editPrompt必须包含"锚点变化"
每个editPrompt都必须有至少一个观者能立刻指出的具体视觉变化点：
- ✅ "天空从灰白变为通透蓝色+白云" — 一眼可见
- ✅ "侧光在人物轮廓形成金色边缘光" — 一眼可见
- ❌ "增加微妙的胶片颗粒" — 需要凑近才看到 = 3分

#### editPrompt要精炼，不要堆砌
- editPrompt 聚焦 1-2 个核心变化，不要同时堆 5-6 个微调（锐化+色温+饱和度+景深+...）
- 堆砌太多微调 = 每个变化都很小 = 整体看不出区别 = 5分
- 一个大胆的变化 > 五个微妙的变化

---

## 评分标杆

- **10分公式**：环境光影提升 + 人物轮廓保真 + 前后景深变化 + 自然色调 = WOW
- 8分稳定：阴天变晴天+通透感、强景深分离、电影感光影、夜景氛围
- 致命错误：只做微妙锐化（3分）、背景被换掉（3分）、脸变宽/变胖（6分）
