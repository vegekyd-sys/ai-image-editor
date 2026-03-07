# Tips 优化进度追踪

## 项目目标
通过人机协作循环，迭代优化 tips 的 prompt 系统，直到每个测试结果都能让用户打出 8 分以上（"wow"感）。

## 架构概览
- Tips 系统：`TIPS_SYSTEM_PROMPT`（短指令）+ `.md` 模板文件（`enhance.md`, `creative.md`, `wild.md`）
- 生成流程：图片 → Gemini 生成 6 tips（2 enhance + 2 creative + 2 wild）→ 逐 tip 编辑图片
- 测试脚本：`scripts/batch-test.mjs` — 随机选图、生成 tips、编辑、生成交互式报告
- 模型：`gemini-3.1-flash-image-preview`（2026-02-27 从 `gemini-3-pro-image-preview` 切换）

## 实验设计原则
- **每轮必须使用不同的随机图片**（从 50 张 testcase 中随机 5 张），不能对同一组图片反复优化
- 目标是 prompt 的泛用性，不是针对特定图片的过拟合

---

## V1 测试结果 (test-results/v1/)
- **图片**：IMG_1256.HEIC, DJI_20210913_170156_032.JPG, IMG_1230.JPG, IMG_5555.HEIC, IMG_0090.jpg
- **成功率**：30/30
- **平均分**：5.2
- **低于 8 分**：18/30

### V1 关键发现
- 人脸保持问题严重
- enhance 美颜效果太网红
- 很多 creative tip 无聊（简单换背景、bokeh、发光）
- 高分方向：黄金时刻光影(10)、吉卜力(8)、手办(8)

---

## V2 测试结果 (test-results/v2/)
- **图片**：与 V1 相同（这是错误的实验设计，V3 已修正）
- **成功率**：30/30
- **平均分**：5.1（略微下降）
- **低于 8 分**：20/30

### V2 评分数据 (test-results/v2/scores.json 或下方)

#### 高分（≥8）及原因：
| 分数 | Tip | 原因 |
|------|-----|------|
| 10 | 穿越90s杂志 | 人物輪廓、微表情、前後景深、色調都把握良好 |
| 9 | 暖光电影感 | 光影效果和色溫都不錯 |
| 9 | 晴空万里梯田 | 人物的通透感，看起來氣色好。視覺焦點更加平衡，整體畫面的景深更好 |
| 9 | 聚焦主厨时刻 | — |
| 9 | 雨天窗景感 | — |
| 8 | 暖光溢彩盛宴 | — |
| 8 | 吉卜力手绘风(厨师) | — |
| 8 | 长城之巅片鸭 | — |
| 8 | 漫画风重绘 | 背景人物挺好。前景女生輪廓可以再柔和一些 |
| 8 | 变身潮玩公仔 | 人物輪廓失真，衣服包包缺少細節精緻感 |

#### 低分（≤4）及原因：
| 分数 | Tip | 原因 |
|------|-----|------|
| 1 | 穿越古风仙境 | 左邊兩位人物失真。人物缺少仙俠世界的縹緲氛圍感。光線過硬 |
| 1 | 沐浴金色暖光 | 人物皮膚不夠通透，牙齒過黃。整體色調過黃，沒有前景後景的光影處理 |
| 1 | 营造柔焦梦境 | 看起來很廉價。沒有藝術感，有很重的年代感 |
| 1 | 置身樱花雨中 | 廉價 |
| 1 | 化身精致手办 | 衣物質感不錯。人半身截斷很詭異 |
| 1 | 穿越大唐宫廷 | 頭身比例不協調。人物臉部過於素顏，沒有古代氛圍感 |
| 2 | 胶片感调色 | 女生的神韻和微表情沒有捕捉到。人物皮膚過度磨皮 |
| 2 | 冬日飘雪氛围 | 人物輪廓失真，銳化過度。背景與前景人物不搭 |
| 4 | 吉卜力手绘风(梯田) | 水彩顏色好看，但失去原本人物輪廓特徵 |
| 4 | 丰收金秋梯田 | 背景質感過於完美而不真實。人物失去通透感。景深和融合不夠 |
| 4 | 精致手办上桌 | 微縮梯田與人物間的比例不合適 |
| 4 | 吉卜力手绘风(女) | 筆觸和畫風很好，但失去人物本身輪廓特色 |
| 4 | 清新通透感 | 畫面通透感良好。前景後景光影需要有變化。人物眼神略顯失焦 |

### V2 → V3 核心洞察（10分公式）

**通透感 + 人物轮廓保真 + 前后景深变化 + 自然色调 = WOW**

1. **通透感是第一优先级**：皮肤要"发光透亮"而不是"磨皮光滑"。保留微小阴影变化（嘴角、腮帮、眼窝）
2. **人物轮廓+微表情保真**：五官大小不能变，神韵和微表情必须保留（嘴角皱纹、眼神方向）
3. **前后景深分离**：前景人物清晰锐利 + 背景有适当景深处理 = 视觉层次
4. **自然色调**：禁止单一色温铺满全画面（如整体过黄），要有冷暖对比
5. **反廉价感**：柔焦梦幻 = 廉价，过度处理 = 廉价，缺乏细节 = 廉价

### 各类别总结
- **enhance**：禁止柔焦梦幻；皮肤用"luminous translucent"不用"smooth"；必须有景深分离
- **creative**：禁止樱花雨、冬日飘雪；风格化重绘时人物面部轮廓必须可辨认
- **wild**：手办必须全身不截断；历史穿越必须加时代妆容；头身比例不能失调

---

## V3 测试结果 (test-results/v3/)
- **图片**：7E8B2F7E...tmp.JPG, IMG_5457.HEIC, DJI_20210913_170203_470.JPG, IMG_0090.jpg, IMG_8315.HEIC
- **成功率**：30/30
- **平均分**：4.4（下降！）
- **低于 8 分**：20/30（评27个）

### V3 最大问题：tips 风格过于统一
用户反馈：每张图都生成了吉卜力+手办+场景穿越，严重缺乏多样性。

#### 高分（≥8）：
| 分数 | Tip | 原因 |
|------|-----|------|
| 8 | 清透蓝调夜色(enhance) | — |
| 8 | 90年代滑板杂志(wild) | — |
| 8 | 变身动漫主角(creative) | — |
| 8 | 电影感青橙调(enhance) | — |
| 8 | 穿越古代农耕(wild) | "还挺好笑的" |
| 8 | 暖阳侧脸光影(enhance) | — |
| 8 | 复古胶片质感(enhance) | — |

#### 低分总结及致命反馈：
- **吉卜力：全部1分** — "每次都吉卜力，已经腻了"、"重复画风"、"随机感太弱了"
- **手办：全部1分** — "太傻了"×多次
- **场景穿越：1分** — "更换的场景是硬换，不好玩"、"人都变了"
- **通用魔法特效：1分** — "道具没关系"、"道具和主体没关"
- **历史穿越：null** — "人物不像，wild我们要重新定位下"

### V3 → V4 核心洞察（方向重定义）

#### 用户提供了参考图（烤鸭场景示例），明确了三个类别的正确方向：

**enhance = 专业增强**（V3已经不错，微调即可）
- 电影感光影、胶片质感、景深优化
- enhance 一致7-8分，方向正确

**creative = 有趣！有故事！**（需彻底重写）
- 参考：一只真鸡坐在旁边看同胞被切（幽默！与烤鸭强关联）
- 参考：卡通鸭子戴墨镜滑板（荒诞！与鸭主题关联）
- 参考：切鸭时食物飞溅的戏剧瞬间（动态！）
- 核心：加入与画面内容**有故事关联**的幽默道具/角色
- 不是"好看"，是"有趣到想转发"

**wild = 脑洞大开！下一秒发生什么？**（需彻底重写）
- 参考：凤凰从烤鸭中涅槃重生（下一秒发生了什么？）
- 参考：巨型烤鸭变成城市建筑（极端尺寸变化！）
- 参考：太空舱里若无其事切鸭（荒诞混搭！）
- 核心：不改变人，想象画面中**物品/食物**发生疯狂的事
- 不是"换场景"，是"这个东西如果...会怎样？"

### V4 prompt 改动
- creative.md 彻底重写：禁吉卜力、禁通用魔法、核心方向改为幽默道具+动态瞬间+多样风格化
- wild.md 彻底重写：禁手办、禁场景穿越、禁换古装。核心方向改为"下一秒发生了什么"+极端变化+物品活化+逻辑反转
- TIPS_SYSTEM_PROMPT：新增多样性规则（6个tip必须各不相同）、明确禁止吉卜力/手办/场景穿越

---

## V4 测试结果 (test-results/v4/)
- **图片**：IMG_5071.HEIC, IMG_5044.HEIC, DJI_20210913_170208_314.JPG, IMG_5020.HEIC, IMG_0050.HEIC
- **成功率**：30/30
- **平均分**：6.8（大幅提升！从4.4→6.8）
- **低于 8 分**：12/29（评29个）
- **≥8 分**：17/29

### V4 评分数据

#### 高分（≥8）及原因：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 8 | 黄金时刻光影 | enhance | — |
| 8 | 通透色彩增强 | enhance | — |
| 8 | 知识的光尘 | creative | "有趣，道具有关了。能够道具更显眼点就好了" |
| 8 | 建筑水彩画风 | creative | — |
| 8 | 天花板复活 | wild | "好玩，我觉得下方的人物会抬头很有意思" |
| 8 | 点亮暮色光影 | enhance | "把画面增强了很多" |
| 8 | 变为漫画风格 | creative | — |
| 8 | 加入迷路探险家 | creative | "很好玩的，加入的东西有关" |
| 8 | 揭开隐藏世界 | wild | "很好玩的" |
| 8 | 胶片质感增强 | enhance | "人物处理的很棒" |
| 8 | 清透光感肤质 | enhance | — |
| 8 | 酷拽变色龙 | creative | "很可爱" |
| 8 | 信封里的魔法 | wild | "好玩，但是人物有点变样了" |
| 8 | 光影层次增强 | enhance | — |
| 8 | 加入围观小鸡 | creative | "好玩" |
| 8 | 波普艺术风格 | creative | "cool" |
| 8 | 盘中虾米开派对 | wild | — |

#### 中分（5-7）及原因：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 7 | 赋予胶片质感 | enhance | — |
| 7 | 暖阳电影感 | enhance | "背后的走动的人物可以去一下就更好了。眼镜的反光非常棒" |
| 6 | 嘘！有牛在叫 | creative | "人物其实在做斗鸡眼，而不是嘘，理解错了" |
| 6 | 美漫风格重绘 | creative | "美漫跟这个画面没什么关系" |
| 6 | 胶片质感与景深 | enhance | "胶片出现太多次了" |
| 6 | 炸鸡长翅膀飞走 | wild | "idea一般" |
| 5 | 镜面水上书殿 | wild | "idea 有意思，但是体现的地方太少了" |

#### 低分（≤4）及原因：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 4 | 阴天氛围光影 | enhance | "人物在做搞笑表情，配一个阴天氛围可能不一定合适" |
| 3 | 美漫风格重绘 | creative | "美漫跟这个画面没什么关系" |
| 3 | 梯田变成巨型蛋糕 | wild | "巨型蛋糕和画面没什么关系" |
| 2 | 巨型购物袋之门 | wild | "生成的图片没什么关系" |
| null | 降下巨型图钉 | wild | "画面主体变化太大了，看不到原图的影子了" |

### V4 核心洞察

#### 成功公式（得到8分的共同特征）：
1. **enhance**：通透感+景深分离已稳定（6个enhance平均7.5），但**胶片质感重复太多**
2. **creative 幽默道具方向大获成功**：围观小鸡(8)、酷拽变色龙(8)、迷路探险家(8)、知识的光尘(8)
3. **wild 物品活化/下一秒方向成功**：天花板复活(8)、虾米开派对(8)、揭开隐藏世界(8)、信封里的魔法(8)

#### 失败模式：
1. **"与画面无关"是最大杀手**：美漫(3)不搭画面、巨型蛋糕(3)与画面无关、购物袋之门(2)生成图没关系
2. **误读画面内容**：把斗鸡眼理解为"嘘"(6)→理解错导致创意不搭
3. **enhance与情绪不匹配**：搞笑表情配阴天氛围(4)→enhance也需考虑画面情绪
4. **风格化选择需有理由**：美漫风格(3/6)如果跟画面无关就是低分
5. **idea好但执行弱**：镜面水上书殿idea好但体现太少(5)、炸鸡长翅膀idea一般(6)

#### V4 → V5 改进方向：
1. **实施多步agentic流程**：先深度分析图片→再基于分析生成tips（已实现代码）
2. **enhance多样性**：2个enhance必须选不同方向，禁止都用胶片
3. **enhance考虑情绪**：分析人物表情/动作，匹配相应的增强风格
4. **creative/wild的关联性**：每个创意必须能解释"为什么这个道具/事件跟这张图有关"
5. **风格化要有理由**：不是随便选美漫/水彩，要跟画面内容呼应

---

## V5 测试（运行中）
- **图片**：IMG_1112.JPG, IMG_0052.HEIC, IMG_0088.HEIC, IMG_1222.HEIC, DJI_20210912_113822_696.JPG

### V5 改动（基于V4图片视觉复盘）

#### 新增"加法而非替换"原则（最重要的发现）
通过直接对比V4高分和低分图片，发现核心规律：
- **高分(8分)**都是往画面里**加入**小元素：变色龙趴肩膀、小鸡站盘边、天花板壁画飞出天使、盘中虾米开派对、探险家站前景
- **低分(2-3分)**都是**替换**画面大面积区域：梯田全变蛋糕、建筑变巨型图钉、背景加银河门
- 新规则：原图80%以上保持不变，创意聚焦在一个小区域

#### 新增"情绪匹配"规则（enhance）
- V4中"搞笑合照(斗鸡眼) + 阴天氛围"=4分，而"搞笑合照 + 胶片质感"=8分
- enhance风格必须匹配照片的情绪基调

#### 新增"一眼就懂"测试（creative）
- 每个创意必须通过：一句话解释为什么好笑
- 迷路探险家 + "You don't know SoHo" = 秒懂 ✅
- 美漫风格 + 中国梯田 = 文化不搭 ❌

#### 新增"聚焦变化"规则（wild）
- 变化集中在一个小区域（盘子、手持物、壁画区域）
- 不要替换整个背景

#### 多步agentic流程
- Step 1：深度图片分析（新增情绪基调、幽默潜力、最佳聚焦点分析）
- Step 2：基于分析结果生成tips

### V5 测试结果
- **成功率**：30/30
- **平均分**：6.1（下降，V4是6.8）
- **≥8 分**：12/30
- **10分**：2个！（电影感光影="this is crazy good"、救生衣极速膨胀="巨搞笑"）

### V5 关键问题
1. **"看不出变化"** — enhance变化太微妙(3分×2)，用户看不出区别
2. **"廉价感"** — 简陋卡通道具(2-5分)，"小卡通牛廉价"、"星星很差很廉价"
3. **Wild被过度约束** — "wild似乎也只会加道具了，不是初衷，期望可以改更多东西"
4. **道具太小** — "蜜蜂太小了看不出"(3分)
5. **"不合时宜"** — HIGH FIVE+佛像(5分)、人脸变化(2分)

### V5 → V6 核心洞察

#### Wild的正确定义：物品的夸张变形，不是加小道具！
- 10分救生衣膨胀 = 已有物品发生巨大变化
- 8分甜品传送口 = 已有物品变成另一个东西
- 2分Lucky Star = 只是加了个小道具 → 这是creative不是wild！
- Wild与Creative的区别：Creative加新元素，Wild让已有物品变化

#### Enhance必须有视觉冲击力
- 10分电影感光影 = 光影氛围彻底改变，一眼看出
- 3分细节增强/胶片质感 = 几乎看不出变化

#### Creative道具需要高品质
- 写实风道具安全（变色龙8、猴子8、鹦鹉8）
- 简陋卡通=廉价（小牛5、星星2、精灵5）

### V6 改动
1. wild.md：移除过度的"只加小道具"约束，强调让已有物品发生显著变形
2. enhance.md：新增"视觉冲击力是必须的"规则
3. creative.md：新增"避免廉价感"和"大小可见性"规则
4. **合并分析步骤**：去掉独立的analyzeImage API调用，改为在tips生成prompt中内置分析指引（节省30-40s/图）
5. TIPS_SYSTEM_PROMPT：明确三类tip的核心区别

---

## V6 测试结果 (test-results/v6/)
- **图片**：IMG_4336.HEIC, IMG_5555.HEIC, DJI_20210913_170156_032.JPG, IMG_6470.HEIC, IMG_5502.HEIC
- **成功率**：30/30
- **平均分**：6.2（V5 6.1 → V6 6.2，微升）
- **≥8 分**：15/30
- **低于 8 分**：15/30

### V6 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 8 | 增强电影级光影 | enhance | — |
| 8 | 注入暖阳金光 | enhance | — |
| 8 | 阳光梯田合照 | enhance | "左2人物脸可以P小点 允许P脸大小" |
| 8 | 暮色金光质感 | enhance | — |
| 8 | 点亮乐园阳光 | enhance | — |
| 8 | 电影感夜景光影 | enhance | — |
| 8 | 孕肚宝宝互动 | creative | "very surprising" |
| 8 | 熊猫摄影助理 | creative | — |
| 8 | 转为现代插画 | creative | "纽约配波普很漂亮" |
| 8 | 加入三眼仔围观 | creative | — |
| 8 | 施展奇妙魔法(Tinker Bell) | creative | — |
| 8 | 相机变复古电影机 | wild | "我喜欢人物表情的变化，应景" |
| 8 | 让弹簧狗冲出墙面 | wild | — |
| 8 | 脖子变成弹簧 | wild | — |
| 8 | 背景塔变成发射井 | wild | — |

#### 中分（5-7）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 7 | 营造电影景深 | enhance | "背景人物去了就更好了" |
| 7 | 活化纸巾盒子 | wild | — |
| 6 | 沐浴金色暖阳 | enhance | "其实很好，但是跟第一张类似" |
| 6 | 赋予胶片质感 | enhance | "enhance部分可以把无关紧要的背后路人去掉" |
| 6 | 梦幻星光背景 | enhance | — |
| 6 | 加入夜游小猫头鹰 | creative | — |
| 6 | 反转镜中世界 | wild | "概念有意思，但背景人物太多整体很乱" |
| 5 | 衣服图案起飞 | wild | "人物跟无人机无互动，导致无人机像个摆设" |

#### 低分（≤4）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 4 | 手持浪漫仙女棒 | creative | — |
| 3 | 饭团精灵探头 | creative | — |
| 3 | 梯田变大蛋糕 | wild | — |
| 2 | 召唤T恤小怪兽 | creative | "猫跟画面没什么关系" |
| 2 | 鳄鱼加入合影 | creative | "似乎只有吓人 并不是好玩" |
| 2 | 梯田变千层蛋糕 | wild | "梯田变千层蛋糕有什么意思啊？" |
| 2 | 巨型UFO飞过头顶 | wild | "人脸变化了，不像图片本人了" |

### V6 核心洞察

#### 禁止清单模式彻底失败
- 梯田变蛋糕：明确写了"❌ 梯田变蛋糕"，结果在2张图上都出现了（2分+3分）
- 鳄鱼：明确写了"❌ 吓人的动物"，结果还是出现了（2分）
- 仙女棒：明确写了"❌ 魔法棒/仙女棒"，结果还是出现了（4分）
- 结论：**逐条列禁止项是打地鼠，模型记不住也不理解为什么禁**

#### 真正的成功模式（高分共同特征）
- **enhance**：稳定在7-8分，电影感/金色暖光/阳光/景深都好使
- **creative 8分**全部通过了"因果关系"测试：孕妇+宝宝、梯田+熊猫（中国元素）、纽约+波普、Disney+三眼仔/Tinker Bell
- **wild 8分**全部基于画面中已有物品：相机→电影机、壁画弹簧狗→冲出墙面、脖子→弹簧（呼应弹簧狗）、塔→火箭

#### Disney那组是最佳案例（全6个tip都≥7分，平均7.8）
- 原因：Disney场景有明确的IP/主题，creative和wild都能找到极强的关联元素

### V6 → V7 改动（方法论革新）
- **彻底移除所有禁止清单**，改为"三问自检"框架
- creative三问：①为什么是这个元素（因果关系）②情绪对不对 ③这个创意能用在其他照片上吗（太通用=换）
- wild三问：①变化的主角是画面中已有的什么 ②变化够大吗 ③变化基于物品特点还是表面视觉类比
- enhance两问：①一眼看出提升吗 ②风格与情绪匹配吗
- 核心理念：教模型**自己判断好坏的能力**，而不是靠记忆禁止清单

---

## V8 测试结果 (test-results/v8/) — 三问自检框架
- **图片**：IMG_4999.jpg, IMG_0050.HEIC, DJI_20210913_170159_782.JPG, IMG_5457.HEIC, IMG_5101.HEIC
- **成功率**：30/30
- **平均分**：7.2（V6 6.2 → V8 7.2，大幅提升！）
- **≥8 分**：19/29
- **评分**：29/30（1个null）

### V8 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 9 | 耳环变成精灵 | wild | "很可爱" |
| 9 | 梯田化身巨龙 | wild | "非常好，很有惊喜！" |
| 8 | 营造暖调光影 | enhance | — |
| 8 | 提升电影质感 | enhance | — |
| 8 | 电影感侧光增强 | enhance | — |
| 8 | 热带夜通透质感 | enhance | — |
| 8 | 暖阳梯田暮色 | enhance | — |
| 8 | 沐浴史诗金光 | enhance | — |
| 8 | 聚焦雕像主体 | enhance | — |
| 8 | 小鸡惊现背景 | creative | — |
| 8 | 眼镜反光藏惊喜 | creative | — |
| 8 | 偶遇打工熊猫 | creative | "加的东西蛮好玩的" |
| 8 | 吉卜力手绘风 | creative | — |
| 8 | 海鸥停在肩头 | creative | — |
| 8 | 戴上船长帽子 | creative | — |
| 8 | 膝上惊现萌猫 | creative | — |
| 8 | 手持现代手机 | creative | "很好笑" |
| 8 | 雕像崩裂金光 | wild | — |
| 8 | 脚下化作尼罗河 | wild | — |

#### 中分（5-7）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 7 | 手指发射光波 | wild | "很好，可惜左1女生人脸变了" |
| 7 | 手中炸鸡变巨型 | wild | "很有意思的idea，但人物表情变了以后不像了" |
| 6 | 电影光影质感 | enhance | "左2男子脸太胖了" |
| 6 | 暖阳金光人像 | enhance | "左1男生脸太胖" |
| 6 | 电影感通透蓝调 | enhance | "左1男生脸太胖" |
| 6 | 炒饭虾米开派对 | wild | "很有意思的idea，但人物表情变了以后不像了" |
| 5 | 加入可爱萌宠 | creative | "小松鼠加入的很好，但跟人物没有互动，可以让人物看向松鼠" |
| 5 | 定制镜片反射 | creative | "不好玩" |
| 5 | 墨镜映出日落 | wild | "反射出的东西很无聊" |

#### 低分（≤4）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 2 | 背景快艇飞跃 | wild | "两个人脸变了" |
| null | 饮料喷发彩虹 | wild | "红色饮料是画面中不太重要的部分，基于不重要内容做文章不是好主意" |

### V8 核心洞察

#### 三问自检框架效果显著
- 平均分从6.2→7.2，≥8分从15/30→19/29
- **没有再出现"梯田变蛋糕"、"鳄鱼"、"仙女棒"等之前反复出现的低分模式**
- 禁止清单模式彻底移除后反而更好了

#### 成功模式
- **enhance 稳定在7-8分**（8个enhance平均7.5）
- **creative 大获成功**：小鸡围观(8)、熊猫打工(8)、海鸥肩头(8)、船长帽(8)、法老猫(8)、手机自拍(8)、吉卜力(8)
- **wild 两个9分**：耳环→精灵（物品活化）、梯田→巨龙（Q3通过：基于梯田蜿蜒形态而非表面视觉类比）

#### 新发现的问题
1. **人脸保真仍是最大扣分项**：快艇(2分)、光波(7分)、炒饭虾米(6分)、炸鸡变大(7分) — 都是"idea很好但人脸变了"
   - 特别是需要改变表情的tip，人脸容易失真
   - enhance也有脸变胖的问题（6分×3）
2. **"墨镜反射"方向无聊**：镜片反射(5分×2) — "不好玩"、"反射出的东西很无聊"
3. **不重要的画面元素不该做文章**：饮料杯(null) — "画面中不太重要的部分，基于不重要内容做文章不是好主意"
4. **道具加入需要互动**：松鼠(5分) — "跟人物没有互动，贴纸感"

#### V8 → V9 改进方向
1. **强化人脸保真**：表情变化的tip需要更严格的面部保持指令
2. **移除"墨镜/眼镜反射"方向**：连续低分，概念本身不够有趣
3. **Wild选择元素要考虑"重要性"**：只选画面中视觉占比大/重要的元素做变化
4. **Creative加入的元素要与人物有互动/眼神交流**

---

## V9 prompt 改进 (test-results/v9/) — 基于 V8 反馈
- **模型**：gemini-2.5-flash-image（Google 配额用完，临时降级）
- **未正式评分**（flash 模型质量不够，报告有 category 缺失 bug）

### V9 prompt 改动（基于 V8 反馈）
1. **强化人脸保真**：enhance editPrompt 必须包含 "Preserve each person's face shape, bone structure, and proportions exactly — do not make faces wider, rounder, or alter jaw lines."
2. **Creative 互动规则**：加入的元素必须与人物有互动/眼神交流，不能像贴纸（5分教训）
3. **Wild 元素重要性**：只选画面中重要/显眼的元素做变化，不要选边缘模糊的小物件
4. **禁止墨镜/眼镜反射**：连续5分，"无聊"
5. **Wild 表情风险提示**：需要改表情的 wild/creative 风险极高，优先选不需要改表情的方向

### V9 技术 bug
- flash 模型有时不返回 category 字段，导致报告中 3/5 图片的 tip 卡片不显示
- 修复：batch-test.mjs 中按 2+2+2 模式自动补全缺失 category
- 新增 `scripts/regen-report.mjs` 工具，可从 results.json 重新生成报告

---

## V10 测试结果 (test-results/v10/) — OpenRouter + gemini-3（无参数调优）
- **图片**：IMG_4336.HEIC, IMG_0428.jpg, 7E8B2F7E...tmp.JPG, DJI_20210912_113807_485.JPG, DJI_20210912_113822_696.JPG
- **模型**：gemini-3-pro-image-preview via OpenRouter（首次使用）
- **成功率**：30/30
- **平均分**：5.4（V8 7.2 → V10 5.4，大幅下降！）
- **评分**：23/30
- **≥8 分**：4/23

### V10 核心问题：OpenRouter 人脸变形严重

**几乎所有扣分都是"人物的脸变了"**：

| 类别 | 打分数 | 平均分 | 脸变形提及次数 |
|------|--------|--------|---------------|
| enhance | 8 | 6.9 | 4次 |
| creative | 6 | 4.3 | 2次 |
| wild | 7 | 5.0 | 5次 |

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 10 | 渲染日落金光氛围 | enhance | "很棒" |
| 10 | 增强热带海岛通透感 | enhance | — |
| 8 | 净化背景通透感 | enhance | — |
| 8 | 加入迷你厨师 | creative | — |

#### 典型反馈（大量重复）：
- "人脸全变了"(3分)
- "画面很美，但是人物的脸变了"(6分 ×4)
- "创意很好玩，但是人物脸变了"(5-6分 ×3)
- "idea有趣，但是人物的脸变了"(6分 ×2)
- "idea一般"(4分 ×2) — creative 缺乏互动

### V10 分析：OpenRouter vs Google 直连差异
- OpenRouter 转发时默认参数不同，导致人脸保真度大幅下降
- 修复：在 OpenRouter 图片编辑请求中显式设置 `temperature: 0.4, top_p: 0.9`（降低随机性）
- 文字请求保持 `temperature: 1.0, top_p: 0.95`

---

## V11 测试结果 (test-results/v11/) — OpenRouter + temperature 0.4
- **图片**：7E8B2F7E...tmp.JPG, F104D24E...tmp.JPG, IMG_5020.HEIC, DJI_20210912_113822_696.JPG, IMG_4985.HEIC
- **模型**：gemini-3-pro-image-preview via OpenRouter
- **参数调整**：`temperature: 0.4, top_p: 0.9`（图片编辑）
- **成功率**：30/30
- **平均分**：6.3（V10 5.4 → V11 6.3，提升）
- **≥8 分**：9/27
- **评分**：27/30（3个null）

### V11 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 10 | 焕发通透光感 | enhance | — |
| 10 | 营造史诗氛围 | enhance | — |
| 10 | 电影感夕阳剪影 | enhance | "非常好" |
| 8 | 秒变阳光明媚天 | enhance | — |
| 8 | 质感胶片电影风 | enhance | — |
| 8 | 通透高饱和蓝天 | enhance | — |
| 8 | 添加心动想法气泡 | creative | "非常可爱，有传递出好玩的感觉" |
| 8 | 偶遇鸬鹚渔翁 | creative | "蛮有趣的" |
| 8 | 打造电影感光影 | enhance | — |

#### 中分（5-7）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 7 | 增加胶片复古感 | enhance | "背景人物没去除" |
| 7 | 肩膀出现酷狗 | creative | "画面整体可以质感提升下更好" |
| 7 | 飞来一只彩鹦鹉 | creative | — |
| 7 | 添加超级英雄披风 | creative | "很有趣，如果能把画面中无关的路人去掉就更好了" |
| 7 | 加入群鸟模仿动作 | creative | "很有趣，如果能把画面中无关的路人去掉就更好了" |
| 6 | 召唤迷你熊猫师 | creative | "小熊猫比较low，跟鱼眼镜没什么关系" |
| 6 | 墨镜反射倒置城市 | wild | "人物改变表情后，跟原人物差很多" |
| 5 | 提升明亮通透感 | enhance | "变化比较小，背景人物没去除" |
| 5 | 加入呆萌熊猫 | creative | "整个熊猫感觉是硬加进去的" |
| 5 | 拱门变能量传送门 | wild | "比较无聊，感觉是画面blend了一个图层" |
| 5 | 手臂无限伸长 | wild | "prompt很有意思，但是没有执行的很好" |

#### 低分（≤4）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 4 | 器械爆出激烈电流 | wild | "idea有意思，人物改变表情后，跟原人物差很多" |
| 4 | 标语牌变攀爬猴 | wild | "idea有意思，人物改变表情后，跟原人物差很多" |
| 4 | 文件夹飞出纸鹤墙 | wild | "手中的文件夹是很小的一个点，不是视觉重点" |
| 3 | 热锅蒸汽变祥龙 | wild | "人物改变表情后，跟原人物差很多" |
| 3 | 头顶吊灯幻化气泡 | wild | "人物改变表情后，跟原人物差很多" |
| 2 | 换成通透晴天 | enhance | "prompt执行的很差，变成了个很无聊的换背景" |
| null×3 | 放入卡通跳舞菜 / 救生衣极速膨胀 / 唤醒后方山神 | creative+wild | "人物改变表情后，跟原人物差很多" |

### V11 核心洞察

#### V11最大问题仍是人脸变形
- Wild 类别几乎全军覆没：9个 wild 中 7个≤5分，全因"人物改变表情后跟原人物差很多"
- 写"surprised expressions"/"wide-eyed"/"pointing and laughing"直接导致人脸崩坏
- 温度调低(0.4)对 enhance 有帮助但对 wild 表情变化无效

#### enhance 非常稳定
- 10个 enhance 平均分 7.7，有 3个10分
- 主要扣分点：背景人物没去除(7→5分)、变化太小(5分)、执行差(2分)

#### V11 → V12 改进方向
1. 重写 wild 的人脸反应模板：禁止 "surprised expression"，改为只允许 "eyes glance slightly + eyebrows raise tiny amount"
2. 所有 editPrompt 强制包含背景路人去除
3. Wild 元素选择必须是画面中重要/显眼的物品

---

## V12 测试结果 (test-results/v12/) — 表情控制模板
- **图片**：DJI_20210912_113822_696.JPG, DJI_20210913_170203_470.JPG, IMG_1256.HEIC, IMG_4999.jpg, IMG_5020.HEIC
- **模型**：gemini-3-pro-image-preview via OpenRouter
- **成功率**：30/30
- **平均分**：7.3（V11 6.3 → V12 7.3，大幅提升！）
- **≥8 分**：23/29（V11 9/27 → V12 23/29）
- **评分**：29/30（1个null）

### V12 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 图片 | 原因 |
|------|-----|------|------|------|
| 10 | 沐浴金色阳光 | enhance | 街拍女 | "very very good" |
| 10 | 复古胶片质感 | enhance | 街拍女 | — |
| 8×21 | (详见 scores-v12.json) | 各类别 | — | — |

#### 中分（5-7）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 7 | 背景书籍升空 | wild | "表情控制进步了！背景里的人物也可以去掉" |
| 5 | 救生衣变充气沙发 | wild | "创意很好，人脸非常奇怪" |

#### 低分（≤4）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 4 | 加入小鸭队伍 | creative | "比较一般" |
| 3 | 焕发暖调金光 | enhance | "画面变化太多了" |
| 3 | 变出超级长舌 | wild | "有点吓人" |
| 3 | 变出无限高帽 | wild | "idea没有被执行出来" |
| null | 标志牌文字复活 | wild | "创意很好，人脸非常奇怪" |

### V12 核心洞察

#### 表情控制模板大获成功
- Wild 平均分从 V11 的 ~3.5 提升到 V12 的 6.0
- "eyes glance + eyebrows raise" 模板在大脸/中脸场景有效（激活帽子鳄鱼 8分 "表情控制的不错，人脸没崩"）
- Enhance 和 creative 已经非常稳定（各9/10 ≥8分）

#### 小脸是新发现的系统性问题
- 漓江远景（人脸占比最小）两个 wild 都因"人脸非常奇怪"扣分
- 同一张图的 enhance 和 creative 都是 8分（不涉及面部变化）
- 结论：小脸场景下即使 "eyes glance" 这种微调也会导致面部重新生成

#### 按脸部大小分布的成功率
| 脸部大小 | enhance | creative | wild |
|----------|---------|----------|------|
| 大（特写/半身） | 3,8,8,8,10,10 | 8,8,8,8,8,8 | 8,8,8,8,8,7 |
| 小（远景/合照） | 8,8,8,8 | 8,8,8,4 | 5,null,8,3 |

#### 其他扣分模式
1. **Wild/creative 也需要去背景路人**（V12反复提到"背景里的人物也可以去掉"）
2. **恐怖/不适方向**（超级长舌 3分 "有点吓人"）
3. **Enhance 变化过度**（暖调金光 3分 "画面变化太多了"）
4. **Wild 执行力**（无限高帽 3分 "idea没有被执行出来"）

### V12 → V13 改进方向
1. **P0 小脸保护**：所有类别的 editPrompt 增加小脸检测和保护模板；小脸场景下人物反应只用身体语言
2. **P1 背景净化扩展**：wild 和 creative 也必须包含去背景路人指令
3. **P2 恐怖方向**：wild 自检新增 Q4 "会不会让人不适？"
4. **P2 enhance 构图规则**：enhance 可以调整构图，但必须基于原图（"画面变化太多了"=3分）
5. **P3 执行力自检**：wild 新增执行可行性判断

---

## V13 prompt 改动（基于 V12 反馈）

### TIPS_SYSTEM_PROMPT 改动
1. 新增"第一步：判断人脸大小"：大脸(>10%)正常处理，小脸(<10%)触发保护模式
2. 小脸保护模板：要求面部 PIXEL-IDENTICAL，人物反应只用身体语言
3. 新增所有类别的背景净化指令
4. Wild 自检新增 Q4：变化会不会让人不适/恐怖
5. Enhance 自检新增：构图可调但必须基于原图
6. 移除硬编码禁止清单，靠自检框架覆盖

### enhance.md 改动
- 新增"小脸场景特殊处理"章节：小脸时不写面部美化指令，光影只作用于环境
- 新增构图规则：enhance 可以调整构图但编辑后必须认出是同一张照片

### creative.md 改动
- 新增"背景净化"章节：editPrompt 必须包含去背景路人
- 新增"小脸场景特殊处理"章节：小脸时新元素不紧贴人脸，互动用身体语言
- 移除硬编码禁止清单，改为靠自检框架

### wild.md 改动
- 新增"恐怖/不适方向"到避免列表（Q4 自检覆盖）
- 新增"执行可行性"自检
- editPrompt 增加背景净化指令
- 新增"小脸场景特殊处理"章节：小脸时用 body-only 反应模板，变化区域远离人物身体

### SYSTEM_PROMPT (chat) 改动
- 新增小脸保护规则

### batch-test.mjs 同步
- TIPS_SYSTEM_PROMPT 与 gemini.ts 保持一致

---

## V13 测试结果 (test-results/v13/)
- **图片**：DJI_20210913_170156_032.JPG, IMG_0428.jpg, IMG_8315.HEIC, IMG_7473.HEIC
- **模型**：gemini-3-pro-image-preview via Google
- **成功率**：24/24（第5张图 tips 生成失败 JSON parse error，4/5图完成）
- **平均分**：6.1（V12 7.3 → V13 6.1，下降！）
- **≥8 分**：13/23
- **评分**：23/24（1个null）

### V13 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 10 | 焕新晴朗蓝天 | enhance | — |
| 8 | 渲染金色夕阳 | enhance | — |
| 8 | 沐浴黄金时刻 | enhance | — |
| 8 | 营造暖光氛围 | enhance | — |
| 8 | 柔和胶片质感 | enhance | — |
| 8 | 提升阳光泳池质感 | enhance | — |
| 8 | 惊现水牛抢镜 | creative | — |
| 8 | 召唤酷炫海鸥 | creative | "在眼神变化的情况下，可以加入嘴型的变化" |
| 8 | 加入一只睡猫 | creative | — |
| 8 | 池边放置热带鸡尾酒 | creative | — |
| 8 | 树木变成棉花糖 | wild | — |
| 8 | 背景毛皮变活 | wild | "在眼神变化的情况下，可以加入嘴型的变化" |
| 8 | 池水变成发光生物荧光 | wild | — |

#### 中分（5-7）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 6 | 眼镜片变屏幕 | wild | "idea一般" |

#### 低分（≤4）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 4 | 唤醒帽上鳄鱼 | creative | "鳄鱼在女生脸边上比较吓人" |
| 4 | 建造沙滩铁塔 | creative | "铁塔的位置不好，比较无聊" |
| 4 | 漂浮热可可杯 | creative | "不明所以" |
| 3 | 增强明媚阳光 | enhance | "背景被换掉了，不符合enhance" |
| 3 | 巨化点赞拇指 | wild | "大拇指应该出现在右一男生的手上，但是现在出现在画面的右边" |
| 3 | 梯田化作抹茶 | wild | "idea一般" |
| 3 | 加入粉红火烈鸟浮排 | creative | "在原本就比较拥挤的画面加入一个火烈鸟，不是很有意思" |
| 3 | 眼镜反射海滩派对 | wild | "眼镜idea的确傻" |
| 1 | 营造暖金夕阳氛围 | enhance | "人物都变了" |
| null | 墨镜映射怪兽 | wild | "在眼神变化的情况下，可以加入嘴型的变化，可能是惊讶的嘴型" |

### V13 核心洞察

#### 回归分析
V13 从 V12 的 7.3 降到 6.1，原因：
1. 移除硬编码禁止清单后，眼镜反射(3分×2)和食物变化(3分)再次出现——自检框架Q2/Q3未能有效拦截
2. 新增的小脸保护/背景净化等内容增加了 system prompt 长度，可能稀释了自检框架的效果
3. 测试图片不同导致的自然波动

#### 用户最频繁反馈（4次）
"在眼神变化的情况下，可以加入嘴型的变化" — V12 的 "eyes glance + eyebrows raise" 模板保住了人脸，但用户希望更丰富的表情反应（嘴型变化）

#### 五个失败模式
1. **Idea质量差**（5 tips, avg 3.4）：眼镜反射×2、梯田→抹茶、火烈鸟拥挤、热可可不明所以
2. **执行/保真错误**（3 tips, avg 2.3）：背景被换、人物都变了、大拇指位置错
3. **恐怖/无聊**（2 tips）：鳄鱼吓人、铁塔无聊
4. **表情太死板**（4 mentions）：用户希望加入嘴型变化
5. **空间不合适**（1 tip）：拥挤画面硬加大元素

### V13 → V14 改进方向
1. **表情模板升级**：允许 "lips part slightly" 嘴唇微张，三种微变化组合（眼神+眉毛+嘴唇）
2. **Enhance 背景锚定**：新增自检 Q3 "背景还是原图的背景吗？"，editPrompt 强制包含 "Keep the original background scene intact"
3. **Wild Q2/Q3 强化**：Q2 明确"镜片反射=太小"，Q3 明确"变成食物/抹茶=表面视觉类比"
4. **Creative 空间感知**：画面拥挤度评估，拥挤画面用小巧元素
5. **Creative Q1 强化**：说不清原因="不明所以"=4分

---

## V14 prompt 改动（基于 V13 反馈）

### wild.md 改动
1. 表情模板升级：新增 "lips part slightly [in amusement/in surprise/into a grin]"
2. Q2 强化：新增 "改镜片反射内容=太小不够大(3分)" 示例
3. Q3 强化：梯田→抹茶/食物/饮品列为万金油套路，"形状像"类比为最低级联想
4. editPrompt 空间精度：要求用位置+外观精确定位变化物品，变化不能跑到其他区域

### enhance.md 改动
- 自检从两问升级为三问，新增 Q3："编辑后的背景还是原图的背景吗？"
- editPrompt 强制包含 "Keep the original background scene intact"

### creative.md 改动
- Q1 强化："不明所以"=4分 示例
- Q2 强化：鳄鱼脸边=4分 示例，动物在脸附近需注意
- 新增"空间感知"规则：拥挤画面不硬塞大元素
- 新增人物反应写法指导（大脸场景）

### TIPS_SYSTEM_PROMPT 改动
- enhance 自检新增 Q3 背景锚定
- wild Q2 新增镜片反射示例
- wild Q3 新增抹茶/食物套路示例
- 新增 enhance editPrompt 背景锚定指令

### batch-test.mjs 同步
- TIPS_SYSTEM_PROMPT 与 gemini.ts 保持一致

---

## V14 测试结果 (test-results/v14/)
- **图片**：IMG_0053.HEIC, DJI_20210913_170203_470.JPG, IMG_1256.HEIC, IMG_1227.HEIC, IMG_4336.HEIC
- **模型**：gemini-3-pro-image-preview via Google
- **成功率**：30/30
- **平均分**：7.4（V13 6.1 → V14 7.4，大幅回升！略高于V12的7.3）
- **≥8 分**：24/29
- **评分**：29/30（1个null）

### V14 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 10 | 提升：晴空通透感 | enhance | — |
| 10 | 提升：日落丁达尔 | enhance | — |
| 10 | 烤鸭突然复活 | wild | — |
| 8×21 | (详见 scores.json) | 各类别 | — |

#### 低分（≤4）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| null | 云中巨人拍照 | wild | "对表情轻微变化还是不太好，还是恢复回去比较好" |
| 2 | 种下巨型稻禾 | wild | "小脸人脸变化严重" |
| 3 | 羊驼模仿秀 | creative | "怎么把一个人物变成了羊驼"（执行错误：替换人物而非添加） |
| 4 | 加入围观小鸭 | creative | "一群鸭子要很惊吓才符合主题" |
| 4 | 日系通透明亮 | enhance | "人脸很大，整个画面变化比较小" |
| 4 | 变身雕刻凤凰 | creative | — |

### V14 核心洞察

#### V14 改善点（有效的改动）
1. **Enhance 背景锚定成功**：avg 8.0，9/10 ≥8。没有再出现"背景被换掉"或"人物都变了"
2. **眼镜反射/食物变化消失**：Wild Q2/Q3 强化完全拦截了这两类低分模式
3. **Creative 空间感知**：没有再出现"拥挤画面硬加大元素"
4. **Wild 整体稳定**：avg 7.6，大多数 wild tip 执行良好

#### "lips part slightly" 实验失败
- V14 尝试在表情模板中加入 "lips part slightly"（嘴唇微张）
- 用户反馈：**"对表情轻微变化还是不太好，还是恢复回去比较好"**
- 结论：嘴型变化仍然会导致面部重新生成，恢复到 V12 的 "eyes glance + eyebrows raise only" 模板
- **教训：面部表情的物理限制比预期更严格，只有眼神方向和眉毛微调是安全的**

#### 剩余问题
1. **小脸保护仍不完美**：2分 "小脸人脸变化严重"（种下巨型稻禾）——变化靠近人物身体时小脸仍会崩
2. **Creative 执行错误**：羊驼替换了人物而非添加（3分）——需要更强的"不要替换任何人物"指令
3. **Creative 情绪匹配**：小鸭子应该"惊吓"才符合看烤鸭主题（4分）——Q2情绪检查可强化
4. **Enhance 变化力度**：日系通透变化太小（4分）——Q1视觉冲击力检查已有但未生效

### V14 → V15 已执行的改动
- **恢复表情模板**：移除 "lips part slightly"，恢复到 V12 的 "eyes glance + eyebrows raise only"
- 在禁止列表中明确加入 "lips part slightly" 作为已验证的失败方向

---

## V35–V39 实验记录（杂物清除 + 美颜迭代）

### 根因发现：两套 prompt 系统
- **`batch-test.mjs` 有独立硬编码的 TIPS_SYSTEM_PROMPT**（含 4 处 "Remove ALL background pedestrians"），与 `.md` 文件独立存在
- `.md` 文件作为 `${templates}` 附在 user prompt 末尾，优先级低于硬编码指令
- **结论：改 `.md` 文件对批测试无效，必须同步改 `batch-test.mjs`**

### V35 实验（美颜过强 + 杂物清除无效）
- 美颜指令改为 "visibly / noticeably / err on the side of more" → 人脸变形到认不出（5分×2）
- 用户明确："眼睛不要修改了"
- 杂物清除无效 — 根因：.md 文件改了但 batch-test.mjs 未改
- 所有 6 tip 均 5 分或以下

### V38 实验（原则性杂物清除 v1，.md 已改但脚本未改）
- IMG_1452 杂物仍未清除 → 确认根因在 batch-test.mjs 硬编码
- IMG_1256（烤鸭厨师）无人脸问题，所有 tip 8-10 分，avg 8.3

### V39 实验（修复 batch-test.mjs 后首次测试）
**IMG_1452（咖啡馆母子）**：
- 全部 6 tip 均 8 分 ✅
- 用户反馈："桌子消除的特别好，很棒" × 6
- **结论：原则性杂物清除指令完全有效**

**IMG_1227（飞机合照）**：
- enhance 2 个均 3 分："人脸仍然很大 不ok"
- creative/wild 未评分
- 问题：enhance 光影处理时面部被放大/变形，与杂物无关
- 美颜指令 "retouch face to look naturally more flattering" 可能加剧了这个问题

### 已验证结论（新增）
- **原则性杂物清除（"professional photographer" 语言）是正确方向**：比枚举具体物品更有效，让模型自己判断
- **眼睛绝对不能改**：任何眼部修改都会导致面部重新生成（V35 验证）
- **美颜指令需要更谨慎**：大脸场景下 "flattering look" 指令也可能导致面部变形

### V40 实验（V-line 瘦脸首次测试）
- IMG_7514（两个成年人）：10/10 两张 ✅ — V-line 对有下颌线的成年人效果完美
- IMG_1452（母亲）：6/6 ❌ — "女生人脸变了"
- IMG_1227（小朋友）：6 ❌ — "小朋友的人脸变了"
- **规律：有下颌骨感的成年人 ✅，圆脸/年轻女性/儿童 ❌**
- 根因：没有明显下颌线时模型"无处可削"，重新生成整张脸

### V41 实验（自检原则：only if clearly defined adult jawline）
- 指令改为："If and only if the person has a clearly defined adult jawline: apply V-line slimming. For children or naturally round/soft faces, do NOT apply any face modification whatsoever."
- **IMG_1452: 8/8 ✅**（从 6/6 提升）
- **IMG_1227: 8/8 ✅**（从 3/6 提升）
- **IMG_7514: 8 ✅**
- avg 8.0，0 below threshold — 完全解决

### 已验证结论（新增）
- **瘦脸自检原则**：让模型自己判断是否有下颌线比枚举人群类型更有效
- **儿童/圆脸禁止任何面部处理**：包括 skin luminosity 等"轻微"处理也不做
- **V-line 术语**：对亚洲美颜概念理解好，在有骨感的成年人脸上执行稳定

---

## V34 prompt 改动（基于 V14 反馈 + 新需求）

### enhance.md 改动
1. **自然美颜**：新增 "slim face 5-8% + enlarge eyes 5-10%（保留瞳色和眼角形状）"，替换原来的 "slightly refine facial proportions"
2. **杂物清除扩展**：从 "Remove ALL background pedestrians" 扩展到 "Remove ALL distracting elements: pedestrians AND foreground/background clutter such as poles, trash cans, signs, wires"
3. **小脸马赛克修复**：将 "PIXEL-IDENTICAL" 措辞改为 "Leave ALL face areas completely untouched — Treat face areas as if they are masked off and invisible to you"

### creative.md / wild.md 改动
- **杂物清除**：同上，editPrompt 模板扩展至前后景杂物
- **小脸模板**：统一改用 "masked off" 语言，避免马赛克感

---

## V34 测试结果 (test-results/v34/)
- **图片**：DJI_20210912_113808_564.JPG, IMG_0428.jpg, IMG_4976.HEIC, IMG_0050.HEIC, IMG_6482.HEIC
- **模型**：gemini-3-pro-image-preview via OpenRouter
- **成功率**：30/30
- **平均分**：8.03（V14 7.4 → V34 8.03，历史最高！）
- **≥8 分**：24/30 = 80%
- **≤4 分**：0/30

### V34 评分数据

#### 高分（≥8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 10 | 沐浴黄金时刻 | enhance | — |
| 10 | 墨镜膨胀变巨 | wild | — |
| 10 | 图案活化飞出 | wild | "好玩~" |
| 9 | 同款墨镜配角 | creative | — |
| 9 | 摆放牛仔靴道具 | creative | — |
| 9 | 海报文字冲出狂奔 | wild | — |
| 9 | 展示框变为微缩舞台 | wild | — |
| 8 | 沉浸漓江夜色 | enhance | — |
| 8 | 偶遇鸬鹚渔翁 | creative | — |
| 8 | 遭遇猴子好奇 | creative | — |
| 8 | 惊现巨型救生衣 | wild | — |
| 8×13 | （其余）| 各类别 | — |

#### 低分（<8）：
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 7 | 打造电影感光影 | enhance | "人脸可以修得更好 现在略有保守" |
| 7 | 增强夜景氛围 | enhance | "人脸可以修得更好 现在略有保守" |
| 7 | 盘中虾米活了 | creative | — |
| 7 | 黄金时刻调色 | enhance | "男生的人脸可以更小，其它都非常棒" |
| 7 | 目睹竹筏发芽 | wild | "不怎么好玩，but its ok" |
| 6 | 雨衣极速充气 | wild | "透明球没有体现出来" |
| 5 | 炒饭变成火山 | wild | "火山不明显，感觉改变比较小" |

### V34 核心洞察

#### V34 改善点（有效的改动）
1. **均分历史最高 8.03**：V14 7.4 → V34 8.03，突破 8 分大关
2. **杂物清除扩展有效**：无任何评分提到背景/前景脏乱问题，说明新的 clutter removal 指令生效
3. **小脸马赛克**：没有出现马赛克投诉，"masked off" 语言比 "PIXEL-IDENTICAL" 更安全
4. **无场景物品的场景（IMG_4976 — Oklahoma 海报）**：所有 6 个 tip 均 8-9 分，无人脸约束下质量极高
5. **Creative 强劲**：avg 8.1，是三类中最高的

#### 面部美颜仍不足
- 用户反馈 2 次"人脸可以修得更好 现在略有保守"（enhance, IMG_0050）
- 3 次"男生的人脸可以更小"（IMG_6482 所有 3 个 tip）
- V34 的美颜指令（"slim 5-8%, enlarge eyes 5-10%"）模型执行时过于保守
- **结论**：需要更强的美颜措辞，或在 editPrompt 中更明确地指示比例

#### Wild 执行失败模式（仍存在）
- **透明材质难渲染**："透明球没有体现出来"（雨衣极速充气 6分）— 模型对透明/半透明材质执行能力弱
- **微小视觉变化**："火山不明显"（炒饭变成火山 5分）— 变化物品太小 / 视觉占比不够大
- **已有规则覆盖**：Q2"变化够大吗"应能拦截，但炒饭火山过了自检却执行不足 — 可能需要 "变化区域必须占画面 15% 以上" 的量化约束

### V34 → V35 改进方向
1. **美颜措辞加强**：在 enhance editPrompt 中将 "5-8% / 5-10%" 改为更强的方向，加入"visibly slimmer face"和"noticeably larger, more defined eyes"；同时明确"如果不够明显，宁可过一点"
2. **Wild 量化视觉占比**：新增约束"变化区域在画面中的视觉占比必须 ≥15%，否则Q2不通过"
3. **避免透明材质**：Wild 新增禁止方向"透明/半透明材质膨胀"（执行失败率高）

---

## V43 架构改动记录（2026-02-20）

### Tips 速度优化（最重要）
- **根本原因**：之前用 Gemini 图片生成模型（`gemini-3-pro-image-preview`）生成 tips 文字，该模型专为图片生成设计，用于文字生成极慢（~17-35s）
- **修复**：Tips 文字生成改用 Claude Sonnet (Bedrock)，速度提升至 ~10s
- **实现**：`agent.ts` 新增 `streamTipsWithClaude`，`/api/tips` 路由调用 Claude 而非 Gemini
- **架构**：保留 3 个并行 per-category 调用（faster first-tip）；Gemini 只用于图片生成

### Tips 预览图选择性生成（B 功能）
- 首次上传 → `previewMode: 'full'`（6 张预览图）
- Tip commit 后 → `previewMode: 'selective'`（1 enhance + 1 wild）
- CUI 生图后 → `previewMode: 'none'`（0 张）
- 点击 `none` 状态 tip → 触发按需生成，spinner 显示，生成完成后才可选中（不提前创建 draft）
- StatusBar 修复：移除 `teaserSnapshotRef` 干扰条件，手动触发生成正确显示"正使用nano banana pro"

### Agent 多图参考
- `generate_image` 工具在有 `originalImage` 时自动传入两张图给 Gemini（原图+当前版本）
- Claude 的 editPrompt 明确引用 Image 1（原图）做人脸保真参考
- `agent.md` 更新多图 prompt 模板和人脸问题处理策略

### 其他改进
- 对话历史从 4 条扩展到 30 条（适配 1M context 模型）
- agent 分析中输入框可输入
- 客户端压缩统一提升到 2048px（提升输出图片分辨率）
- 编辑页「+」按钮改为创建新项目（不再上传到当前项目）

### 已知问题
- Agent 多图人脸保真仍不稳定（有时有效有时无效，待深入调查）
- Tips 速度目标是 5s，目前 ~10s，还有空间（可考虑 Claude Haiku）

---

## Agent 架构迭代记录（2026-02-20 下午）

### 多图参考架构修复

**问题**：之前 generate_image 传两张图给 Gemini 时，顺序是 [原图, 当前版本]，Gemini 把第一张（原图）当成了输出构图基础，导致"基于原图重新创作"而非"在当前版本上修改"。

**修复**：
1. 传图顺序调换：[当前版本（主图/BASE）, 原图（人脸参考）]
2. 新增 `useOriginalAsBase` 参数：
   - `false`（默认）→ 传两张图，当前版本为 BASE，原图为人脸参考
   - `true`（"重新做"）→ 只传一张原图，从头创作
3. Agent 根据用户意图决策（工具描述里有自检 Q1）

**人脸还原正确写法**：参考原图时，要求原样复制（"copy face pixel-for-pixel"），不加任何美化/瘦脸。之前 enhance 里的 V-line 瘦脸逻辑不适用于"还原人脸"场景。

### Prompt 架构进一步清晰化

**职责分离原则**（已验证，写入 CLAUDE.md）：
- `agent.md` = 路由层：工作流判断、何时调哪个工具、用户意图识别
- tool description = 工具层：参数含义、图的角色、editPrompt 结构、人脸指令
- `generate_image_tool.md` 新增：generate_image 工具描述提取为独立 .md 文件

**所有 prompt 文件一览**：
| 文件 | 控制什么 |
|------|---------|
| `agent.md` | Agent 路由逻辑 |
| `generate_image_tool.md` | generate_image 工具行为（useOriginalAsBase、图的角色、editPrompt 结构） |
| `enhance.md` | enhance tips 规则 |
| `creative.md` | creative tips 规则 |
| `wild.md` | wild tips 规则 |

**Agent 最佳实践**（已验证）：
1. 工具描述自包含 — 不在 agent.md 里重复工具参数细节
2. 自检问题 > 规则清单 — 让模型自己推理意图，不靠关键词匹配
3. 意图决策变显式参数 — Claude 显式传 `useOriginalAsBase`，工具侧不猜意图
4. Context injection 优于重复说明 — `[图片分析结果]` 等注入优于在 system prompt 里复述

### HEIC 压缩修复
- **根本问题**：`sips` 是 macOS 专属命令，Vercel Linux 上不存在 → 线上 HEIC 上传直接 500
- **修复**：优先用 Sharp 直接读 HEIC（跨平台，libheif 内置支持），失败才 fallback 到 sips
- **额外优化**：所有压缩质量从 0.85 → 0.92（client canvas）/ 85 → 90（Sharp server）

### editPrompt 透明化
- CUI 每张生成图下方新增「📋 发给 Gemini 的 prompt」可折叠卡片
- Server 日志每次调用 generate_image 时打印 editPrompt
- editPrompt 通过 `tool_call` 事件捕获，关联到对应 image message

---

## 待开发功能

### 自适应 Tips 推荐（后续做）
根据用户行为动态调整 6 个 tips 的类别分布（当前固定 2 enhance + 2 creative + 2 wild）：
- **修图导向**：用户持续点击 enhance tips 或在 CUI 中说修图需求（"调色"、"变好看"、"光影"）→ 下一轮推 3-4 enhance + 1 creative + 1 wild
- **娱乐导向**：用户点 creative/wild 或聊天内容偏"好玩"、"脑洞" → 下一轮推 1 enhance + 2-3 creative + 2 wild
- **信号来源**：tip 点击历史（commit 了哪类）+ CUI 对话关键词 + 已生成图片的类别分布
- **实现思路**：在 tips 生成请求中加 `preferredCategories` 权重，调整给模型的类别数量指令

---

## 待解决问题

### Agent 多图人脸保真不稳定（已记录，待修）
- **现象**：通过 CUI 多轮对话修图，用户要求"人脸跟原图一致"时，有时有效（人脸保真），有时无效（人脸仍然变形）
- **当前实现**：`generate_image` 工具在 originalImage ≠ currentImage 时自动传入两张图给 Gemini（Image 1=原图，Image 2=当前版本），由 Claude 在 editPrompt 中引用
- **可能原因**：
  1. Gemini 对多图中的人脸参考图 (Image 1) 权重不稳定，有时忽略
  2. editPrompt 写法不够强制 — Claude 有时没有在 editPrompt 中显式引用 Image 1 的人脸
  3. 当 currentImage 已经是第 N 次生成结果时，人脸特征在 Image 2 中已经退化，Gemini 难以从 Image 1 恢复
- **待尝试方向**：
  - 在 `generateImageWithReferences` 里强制在 prompt 开头加人脸锚定句，不依赖 Claude 自己写
  - 探索 Gemini 的 `reference_image` / `subject_preservation` 参数（如有）
  - 对比只传原图（不传 currentImage）的效果

---

## V42 测试结果（Prompt 架构重构后首次全量测试）

### 架构变更说明（V42 前）
本次测试是 prompt 系统大重构后的首次验证：
- **`.md` 文件成为唯一真相来源**：enhance.md/creative.md/wild.md 包含所有规则
- **gemini.ts system prompt 极简化**：从 60+ 行 → 2 行（角色 + 格式）
- **batch-test TIPS_SYSTEM_PROMPT 极简化**：从 58 行 → 3 行
- **enhance.md 大更新**：合并 batch-test 中已验证的 6 方向强约束、editPrompt 第一句 = cleanup、jawline 瘦脸条件
- **creative.md**：恢复原版，将旧版 `"Remove ALL background pedestrians"` 升级为 `"FIRST: Clean up the scene..."` 第一句话约束
- **wild.md**：恢复原版（保留详细自检四问）

### 测试信息
- **图片**：IMG_0089.HEIC, IMG_0090.jpg, IMG_6482.HEIC, IMG_5073.HEIC, IMG_4976.HEIC
- **模型**：gemini-3-pro-image-preview via OpenRouter
- **成功率**：30/30
- **平均分**：7.3
- **≥8 分**：21/30 = 70%
- **≤5 分**：4/30 = 13%

### 分类均分
| 类别 | 均分 | 备注 |
|------|------|------|
| enhance | 7.2 | 9 tips（IMG_5073 仅生成 1 enhance） |
| creative | 7.4 | 10 tips |
| wild | 7.2 | 11 tips（IMG_5073 生成了 3 wild） |

### 高分（≥8）
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 10 | 书本形成龙卷风 | wild | — （类型D 功能极端化，执行完美）|
| 8 | 沐浴夕阳暖光 | enhance | — |
| 8 | 营造电影景深 | enhance | — |
| 8 | 召唤华丽孔雀 | creative | — |
| 8 | 指尖浮现光纹 | creative | — |
| 8 | 营造电影光影感 | enhance | — |
| 8 | 添加黄金时刻光 | enhance | — |
| 8 | 唤醒刺绣小鸟 | creative | — |
| 8 | 修复蓝天白云 | enhance | — |
| 8 | 融入米奇探头 | creative | — |
| 8 | 召唤迪士尼城堡 | wild | — （因为雨衣上有 Disney 图案，因果明确）|
| 8 | 披肩化为羽翼 | wild | — |
| 8 | 点亮黄金时刻 | enhance | — |
| 8 | 墨镜化身知识传送门 | wild | — |
| 8×6 | IMG_4976 全部 6 tip | 各类别 | 无人脸场景质量极高 |

### 低分（≤6）
| 分数 | Tip | 类别 | 原因 |
|------|-----|------|------|
| 1 | 营造日落金光 | enhance | "人物全变了" — 天气改造 Q3 失败，背景/人物整体重新生成 |
| 4 | 墨镜映出微缩世界 | wild | "眼镜idea不好" — 眼镜反射内容，禁止方向仍然出现 |
| 5 | 重绘为工笔画风 | creative | — 风格化重绘，因果公式不成立，太通用 |
| 5 | 雨衣充气膨胀 | wild | "这个idea没有被展示出来" — Q4 执行可行性失败 |
| 6 | 召唤幽灵管理员 | creative | "人物变化有点严重" — 面部保真失败 |
| 6 | 乘坐飞毯升空 | wild | "人物在飞毯上是截断的，人物抠像不建议这样的wild" — 变化覆盖人物身体 |

### 核心洞察

#### 有效的改动
1. **FIRST: Clean up 作为第一句话** — 所有 editPrompt 都包含了 cleanup，杂物问题基本消失
2. **Enhance 6 方向强约束** — enhance 方向准确，大多数 8 分，无方向偏差
3. **Creative 因果公式** — 多数 creative tip 有明确因果（米奇←雨衣图案、刺绣小鸟←袖子刺绣、Disney←雨衣）
4. **IMG_4976（无人脸）全 8 分** — 再次验证无人脸约束时质量极高

#### 失败模式

**1. Wild 禁止陷阱仍然突破**
- 墨镜映出微缩世界（4分）— wild.md 已明确列出"眼镜反射=3分"但模型仍生成
- 问题：禁止方向在 .md 中的位置不够突出，被模型忽略

**2. Enhance 天气改造 Q3 失败**
- 营造日落金光（1分）— 方向F（天气改造）中，背景和人物被整体重新生成
- 此图有人物，天气改造时面部被重新生成
- 教训：方向F的"复杂背景=危险"警告模型没有遵循

**3. Wild 人物截断**
- 乘坐飞毯升空（6分）— 变化区域覆盖了人物身体，导致人物被抠像/截断
- wild.md 有"变化不能覆盖人物身体"规则但在小脸章节，大脸场景未覆盖

**4. Creative 风格化重绘仍然出现**
- 重绘为工笔画风（5分）— IMG_0090 有中国服装，模型"合理推断"可做工笔画
- 问题：creative.md 旧版保留了"风格化重绘"方向，与因果公式相悖

**5. IMG_5073 tip 分布异常（1 enhance + 2 creative + 3 wild）**
- 正常应为 2+2+2，生成了 3 wild + 1 enhance
- 根因：gemini.ts system prompt 极简化后，分类约束减弱
- 待观察是否需要在 user prompt 中加 "2个enhance+2个creative+2个wild" 约束

### V43 改进方向
1. **Wild 禁止陷阱加强**：将 "⚠️⚠️⚠️ 眼镜反射=3分！" 移到 wild.md 更顶部，并在 user prompt 中也加一行快速提醒
2. **Enhance 方向F人物保护**：在 enhance.md 方向F 说明中加 "有人物的复杂场景禁止使用方向F" 更明确
3. **Wild 人物截断规则扩展**：从小脸章节移到 editPrompt 要求主章节，大脸也要遵守
4. **Creative 去掉风格化重绘方向**：从 creative.md 中删除"风格化重绘"作为推荐方向，因为它几乎总是不符合因果公式（除非非常特定的场景）
5. **Tip 分类约束**：在 user prompt 中补回 "必须生成 2 enhance + 2 creative + 2 wild" 的明确数量约束

---

## 架构变更记录

### OpenRouter Provider 支持 (V10+)
- `src/lib/gemini.ts`：新增双 provider 架构（`AI_PROVIDER=google|openrouter`）
- Google 路径：保留原 `@google/genai` SDK 代码不变
- OpenRouter 路径：用 `fetch` 调 `https://openrouter.ai/api/v1/chat/completions`
- 切换方式：`.env.local` 中改 `AI_PROVIDER` 即可
- Session 管理：Google 用 SDK Chat 对象，OpenRouter 用 messages 数组手动管理
- 图片格式：Google `inlineData` vs OpenRouter `image_url` (OpenAI vision 格式)
- `scripts/batch-test.mjs`：同样双 provider 支持

### V9 Bug 修复
- `scripts/batch-test.mjs`：flash 模型 category 缺失自动补全
- `scripts/regen-report.mjs`：新工具，从 results.json 重新生成报告
- `scripts/fix-categories.mjs`：一次性修复 results.json 中缺失的 category

---

## Tips 缩略图预览 + 两次点击交互（重大功能重构）

### 变更概览
重新设计 tips 的视觉样式和交互模型：从"点击即编辑"改为"预览→确认"两步流程。

### 新交互逻辑
1. **自动生成缩略图**：每个文字 tip 生成后，立即并发调用 preview API 生成对应的编辑预览图（6个并发）
2. **第一次点击 = 预览**：点击 tip 后，canvas 显示该 tip 的预览图 + "Preview" 徽章，tip 卡片显示选中态（fuchsia 边框），但不创建新 edit
3. **第二次点击 = 确认**：再次点击已选中的 tip，将预览图直接加入 timeline 作为新 snapshot（无需重新调 API），然后加载下一轮 tips
4. **非破坏性浏览**：切换预览不会产生新 edit，只是查看不同 tip 的生成效果

### 架构设计
- **无状态 preview API**：新增 `/api/preview` 端点，使用 `getAI().models.generateContent()`（一次性调用，非 session），避免污染聊天历史
- **Preview 图存储在 Tip 对象上**：`previewImage?: string` + `previewStatus?: 'pending' | 'generating' | 'done' | 'error'`
- **直接使用预览图提交**：commit 时直接将已生成的 preview image 加入 timeline，无需再次调 API，实现即时反馈
- **AbortController 取消机制**：上传新图片或 commit 时取消未完成的 preview 请求

### 修改的文件
- `src/types/index.ts` — Tip 类型新增 `previewImage` 和 `previewStatus` 字段
- `src/lib/gemini.ts` — 新增 `generatePreviewImage()` 函数（Google + OpenRouter 双 provider）
- `src/app/api/preview/route.ts` — **新文件**，preview 生成 API 端点
- `src/app/page.tsx` — preview 状态管理、并发生成队列、两次点击处理器、commit 逻辑
- `src/components/TipsBar.tsx` — 全新卡片布局（72x72缩略图 + 文字），选中态样式
- `src/components/ImageCanvas.tsx` — preview 显示模式、Preview 徽章、点击画布取消预览

### TipsBar 新布局
```
┌──────────────────────────┐
│ ┌──────┐  label          │
│ │thumb │  desc            │
│ │72x72 │                  │
│ └──────┘                  │
└──────────────────────────┘
```
缩略图状态：emoji占位符 → 旋转加载 → 预览图 → emoji回退(错误)

---

## 技术备忘
- HEIC 转换：macOS `sips` → JPEG + `sharp.rotate()` 修正 EXIF
- 图片缩放：max 1536px
- 批量测试输出：`test-results/v{N}/` (report.html + results.json + scores.json + images/)
- 评分服务器：`http://localhost:3333`，POST `/save-scores` 自动保存
- 评分数据也存在 localStorage（key: `scores-v{N}`）

---

## 九视图人脸一致性实验

### 实验目标
验证：用视频抽帧生成的九视图（9-view character sheet）能否提升 AI 编辑的人脸一致性。

### 流程
```
视频 → ffmpeg @2fps 抽帧 → ~20 参考帧
                                ↓
                  Gemini 生成九视图（3x3 character sheet）
                                ↓
                  [九视图] = 中间资产（可复用）
                                ↓
           目标图片 + 九视图 → Gemini 编辑
                                ↓
                          编辑结果图片
```

### Step 1: 生成九视图
- [ ] 用户提供 ~10s 自拍视频
- [ ] `bash scripts/extract-frames.sh <video>` 抽帧 @2fps
- [ ] `node scripts/generate-9view.mjs` 生成九宫格
- [ ] **人工检查九视图质量**

### Step 2: 用九视图辅助编辑（对照实验）
- [ ] `node scripts/edit-with-9view.mjs --target <image>`
- [ ] 3 个编辑 × 有/无九视图 = 6 张结果图
- [ ] 对比报告: `test-results/face-experiment/report.html`

### 观察记录
（实验后填写）

---

## 产品优化（UI/UX 功能迭代）

### 已完成的改动

#### 1. 切换回 Google API
- **文件**: `.env.local`
- `AI_PROVIDER=openrouter` → `AI_PROVIDER=google`

#### 2. ">" 提交按钮（继续编辑引导）
- **文件**: `src/components/TipsBar.tsx`
- 当 tip 处于预览状态（`previewingIndex === originalIndex`）且预览图已就绪时，tip 卡片右侧出现一个 `>` 按钮
- 按钮带 fuchsia 色闪光动画（`animate-glow`），引导用户点击提交
- 点击 `>` = 提交编辑（创建新 snapshot，加载新 tips）
- tip 卡片在显示 `>` 时右侧圆角取消（`rounded-r-none`），与按钮无缝衔接

#### 3. 闪光动画
- **文件**: `src/app/globals.css`
- 新增 `@keyframes glow` + `.animate-glow`：fuchsia 色 box-shadow 脉冲动画（1.5s 循环）

#### 4. 长按对比（Before/After）
- **文件**: `src/components/ImageCanvas.tsx`
- 新增 `previousImage` prop
- 长按 canvas > 200ms → 显示上一张图片 + 蓝色 "Before" 徽章
- 松手恢复当前图片
- 放大状态下（scale > 1）禁用长按
- **文件**: `src/app/page.tsx`
- 计算 `previousImage`：预览模式 = 当前 snapshot 原图，普通模式 = 上一个 snapshot

#### 5. 双指缩放 + 双击复位
- **文件**: `src/components/ImageCanvas.tsx`
- 双指 pinch 手势缩放（1x–5x）
- 放大后单指拖拽平移
- 双击（<300ms 间隔）恢复 scale=1, translate=0
- 放大时禁用左右滑动导航
- 切换图片时自动重置缩放
- 容器 `touch-pan-y` → `touch-none` 防止浏览器默认缩放干扰
- 新增 `skipClick` ref 防止手势结束后误触发 click 事件

### Tip 交互流程（已重构为 Virtual Draft 模型）

#### 核心概念
- **Snapshot**：已提交的编辑结果（存在 `snapshots[]` 数组中）
- **Draft**：虚拟的预览条目（不在 `snapshots[]` 中，通过计算追加到 `timeline`）
- **Timeline**：`[...snapshots.images, draftImage?]` — 用户看到的完整历史

#### 交互流程
1. 上传图片 → `snapshots[0]` = 原图，timeline 显示 1 个点（"Original"），无 timeline 指示器
2. 点击 tip A → 创建 Draft，timeline 新增 "Draft" 条目（虚拟追加），timeline 指示器出现（2个点 + "Draft" 标签）
3. 点击 tip B → Draft 图片切换为 tip B 的预览图（仍是 Draft 状态）
4. 点击 tip B 再次 → **COMMIT** → Draft 变为正式 snapshot，"Draft" 变为 "Edit 1"，加载新 tips
5. 滑动到 Original → Draft 保留，可随时滑回查看
6. 在 Original 上点击 tip → 更新 Draft 的 parent 为当前 snapshot，跳转到 Draft 位置
7. 点击画布（在 Draft 位置）→ 取消 Draft，回到最后一个 committed snapshot
8. 长按 Draft → 显示 parent snapshot 的原图（Before 对比）

#### 架构设计（Virtual Draft）
```
snapshots = [committed snapshots only]
draftParentIndex = number | null  （哪个 snapshot 正在被编辑）
draftImage = computed from snapshots[draftParentIndex].tips[previewingTipIndex].previewImage

timeline = [...snapshots.images, draftImage?]  （draft 是虚拟追加的）
isViewingDraft = isDraft && viewIndex >= snapshots.length
currentTips = snapshots[isViewingDraft ? draftParentIndex : viewIndex].tips
```

优势：
- `snapshots` 始终干净（只有已提交的）
- Draft 通过计算 timeline 自然存在，无需"删除 draft snapshot"操作
- 滑动导航不影响 draft 状态（draft 保留）
- 可在任意已提交 snapshot 上点击 tip 更新 draft

#### 相关文件
| 文件 | 改动 |
|------|------|
| `src/app/page.tsx` | `draftParentIndex` state, `draftImage`/`timeline`/`isViewingDraft` 计算, `commitDraft`/`dismissDraft`/`handleTipInteraction` |
| `src/components/ImageCanvas.tsx` | `isDraft`/`onDismissDraft` props, "Draft" 标签, 点击画布取消 draft |
| `src/components/TipsBar.tsx` | 无需改动（`showCommit` 逻辑兼容 draft 模型） |

### Bug 修复记录

#### iOS 长按上下文菜单
- **问题**：长按 canvas 触发浏览器原生长按工具条（拷贝、翻译等）
- **修复**：容器添加 `style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}` + `select-none` class

#### Chat 按钮遮挡 `>` 提交按钮
- **问题**：固定定位的 chat 按钮（z-20, bottom-right）覆盖了最后一个 tip 的 `>` 按钮
- **修复**：TipsBar 容器 padding 从 `px-3` 改为 `pl-3 pr-14`，留出右侧空间

#### 放大状态下双击复位失效
- **问题**：`scale > 1` 时 `isPanning` 在 touchStart 设为 true，touchEnd 在"结束 pan"分支直接 return，无法到达双击检测
- **修复**：pan 结束时检查手指实际移动距离（`panDx > 5 || panDy > 5`），如果几乎没移动则 fall through 到双击检测

#### 即时提交行为
- **问题**：点击已有预览图的 tip 仍进入预览模式，需要再次点击才能 commit
- **修复**：`handleTipInteraction` 逻辑改为：如果 `tip.previewStatus === 'done' && tip.previewImage` 则直接 `commitTip(tip)`，否则才进入预览等待

#### Draft 滑动消失
- **问题**：Draft 状态时滑动到 Original，Draft 条目消失（`handleIndexChange` 清除了 draft 状态）
- **修复**：`handleIndexChange` 不再清除 draft，仅 `setViewIndex(index)`。新增 `isViewingDraft` 派生值区分"draft 存在"和"正在看 draft"

#### 非 Draft 位置点击 tip 不生效
- **问题**：滑动到 Original 后点击 tip，无法更新 draft
- **修复**：`handleTipInteraction` 新增分支：当 `!viewingDraft` 且 draft 已存在时，更新 `draftParentIndex` 为当前 `viewIndex` 并跳转到 draft 位置

### 修改的文件清单
| 文件 | 改动类型 |
|------|---------|
| `.env.local` | API provider 切换 |
| `src/app/page.tsx` | `previousImage` 计算 + 即时提交逻辑 + 传递给 ImageCanvas |
| `src/components/ImageCanvas.tsx` | 长按对比、双指缩放、双击复位、缩放包裹层、iOS 菜单抑制 |
| `src/components/TipsBar.tsx` | `>` 提交按钮 + glow 动画 + 右侧 padding |
| `src/app/globals.css` | glow keyframes 动画 |

---

## 未来功能规划

### 1. Snapshot → 视频
- 用户编辑完多个 snapshot 后，一键生成叙事视频
- 技术验证：Veo 3 适合单段动画，Seedance 2.0 适合连贯叙事
- Gemini 可根据 snapshot 序列自动写分镜 prompt
- 脚本原型：`scripts/generate-video.mjs`（Veo 3 image-to-video）

### 2. 风格迁移系列
- 一张照片生成多种风格版本（吉卜力、赛博朋克、水墨画等）
- 现有 tips 架构天然支持，调整 prompt 方向即可
- 传播性强："一张照片 × N 种风格"

### 3. AI 扩图 / Outpainting
- 竖版 → 横版，或反过来
- 适合多平台发布（抖音竖版、小红书方版、B站横版）
- Gemini 图像编辑能力支持

### 4. 前后对比分享
- Original → 最终 Edit 做成滑动对比图/短视频
- 自带传播属性，适合社交分享
- 纯前端实现（canvas 合成），零成本

### 5. 批量处理
- 上传多张照片，应用同一套编辑风格
- 适合旅行照片、活动照片统一调性
- 复用现有 chat 编辑管线

### 6. 局部编辑（Inpainting）
- 手指圈选区域，只编辑选中部分
- 如"只改背景天空"、"只改衣服颜色"
- 需要 mask 绘制 UI，AI 侧 Gemini 支持

---

## Phase 1：用户认证（Supabase Auth）

**日期**：2026-02-17
**状态**：已完成

### 实现内容
- 集成 Supabase Auth（Google OAuth + Magic Link）
- `AuthProvider` 组件提供全局认证状态
- `useAuth` hook 暴露 `user`, `loading`, `signOut`
- Supabase SSR 配置：`client.ts`（浏览器端）、`server.ts`（服务端）
- `middleware.ts` 拦截未登录用户 → `/login`
- `/login` 页面 UI（黑底 + fuchsia 主题，Google + Magic Link 两种登录方式）
- 所有页面路由受认证保护

### 技术选型
- `@supabase/ssr` + `@supabase/supabase-js`
- Next.js middleware 做路由保护
- `getUser()` 而非 `getSession()` 验证 JWT（安全最佳实践）

---

## Phase 2：数据持久化（Supabase Storage + Database）

**日期**：2026-02-18
**状态**：已完成

### 实现内容

**数据库表设计**（需用户在 Supabase Dashboard SQL Editor 手动执行）：
- `projects` 表：用户项目，含 title, cover_url，RLS 保护
- `project_images` 表：多图预留
- `snapshots` 表：编辑快照，image_url + tips jsonb
- `messages` 表：聊天消息持久化
- Storage bucket `images`：公开读，认证写

**新增文件**：
- `src/lib/supabase/storage.ts` — `uploadImage()` 将 base64 转 Uint8Array 上传到 Storage，返回 public URL；`getPublicUrl()` 获取公开链接
- `src/hooks/useProject.ts` — 核心持久化 hook，封装 `loadProject`（加载快照+消息）、`saveSnapshot`（上传图片+插入行）、`saveMessage`、`updateTips`、`updateCover`、`updateTitle`。所有写入 fire-and-forget，零阻塞
- `src/app/projects/[id]/page.tsx` — 项目编辑器页面，mount 时加载历史数据并传入 Editor

**路由重构**：
- `/`（page.tsx）→ 自动创建新项目并重定向到 `/projects/{id}`
- `/projects/[id]` → 编辑器主页面
- middleware 保持不变（已支持 /projects/* 路由保护）

**Editor 改动**（最小化侵入）：
- 新增 props：`projectId`, `initialSnapshots`, `initialMessages`, `onSaveSnapshot`, `onSaveMessage`, `onUpdateTips`
- 初始 state 使用 initial 数据（刷新恢复）
- sessionId 改用 projectId（AI 会话与项目绑定）
- 在 5 个关键位置插入持久化回调：上传快照、chat 生成图片、commit draft、添加消息、tips 生成完成
- Tips 持久化时剥离 previewImage/previewStatus（只存 prompt 元数据）

**API 路由 auth**：
- chat、tips、preview、upload 4 个 API 路由均加入 `supabase.auth.getUser()` 校验，未登录返回 401

**gemini.ts**：
- session key 从随机 ID 改为 projectId，保证 AI 会话与项目绑定

### 预览图持久化（关键功能）

用户明确要求：**所有 preview 图片（tip 缩略图）都必须持久化到 Storage**，不只是 commit 的 snapshot。

**最终方案**：在 `updateTips` 中统一处理
1. `generatePreviewForTip` 每完成一个预览，调用 `onUpdateTips(snapshotId, tips)`
2. `updateTips` 遍历所有 tips，将 base64 `previewImage` 上传到 Storage，替换为 public URL
3. 已是 HTTP URL 的跳过，无 previewImage 的跳过
4. 上传路径：`images/{userId}/{projectId}/preview-{snapshotId}-{hash}.jpg`
5. 加载时，tips 中有 `previewImage` URL 的自动恢复 `previewStatus: 'done'`

**曾尝试但放弃的方案**：
- 独立 `savePreviewImage` 函数：race condition（preview 生成时 tips 元数据可能尚未入库）
- `onSavePreview` 回调从 Editor 传入：同样的 race condition

### 遇到的 Bug 及修复

| Bug | 原因 | 修复 |
|-----|------|------|
| UUID 格式错误 (22P02) | Editor 生成 `timestamp+random` ID，DB 列类型为 `uuid` | ALTER TABLE 改 `snapshots.id` 和 `messages.id` 为 `text` |
| React StrictMode 重复插入 (23505) | `onSaveSnapshot` 在 `setSnapshots` updater 内被调用，StrictMode 双执行 | 使用 `upsert` + `onConflict: 'id'`，并将回调移出 updater |
| Storage upsert RLS 违规 | 只有 INSERT 策略，`upsert: true` 需要 UPDATE | 新增 `"Auth users update own"` UPDATE 策略 |
| `onSavePreview is not defined` | 移除方案后残留引用在依赖数组和解构中 | 清理所有引用 |

### 核心设计原则
- **写入全部异步后台执行**：base64 在内存中运作，Supabase 写入不阻塞用户操作
- **Editor 零感知**：持久化回调全部可选（`?.` 调用），Editor 组件可独立工作
- **刷新恢复**：loadProject 从 DB 加载 snapshots + messages → 通过 initialProps 恢复 state
- **预览图全量持久化**：6 个 tip 的预览缩略图全部上传到 Storage，刷新后即时恢复

### 验证结果
- `npm run build` 通过，零 TS 错误
- 上传图片 → Storage 出现 `images/{userId}/{projectId}/snapshot-*.jpg`
- 6 个预览图全部上传到 Storage，DB `snapshots.tips` 中 `previewImage` 为 URL
- 刷新页面 → 所有 snapshots、messages、tips（含预览图）完整恢复
- 点击 tip 后 Draft 模式正常显示 Storage URL 的预览图
- 未登录访问 API → 401

### 前置条件（用户操作）
- 需在 Supabase Dashboard SQL Editor 执行 SQL migration 创建表和 Storage bucket
- `snapshots.id` 和 `messages.id` 需为 `text` 类型（非 `uuid`）
- Storage bucket 需添加 UPDATE 策略以支持 upsert

---

## 图片加载优化（2026-02-18）

### 问题
恢复项目时所有图片为 Supabase Storage URL，浏览器同时发起所有请求：
- Canvas 主图和 tips 缩略图竞争带宽
- Preview 生成 API 6 个并发请求占用带宽
- 滑动到相邻 snapshot 无预加载

### 改动

**1. Editor.tsx 相邻 snapshot 预加载**
- 新增 useEffect：监听 viewIndex/timeline 变化，用 `new Image()` 预加载 viewIndex±1 的 Storage URL
- 可见区域图片（canvas 主图、tips 缩略图）靠浏览器 `<img>` 原生优先加载，无需额外管理

**3. TipsBar.tsx 缩略图加载状态**
- Storage URL 缩略图显示 animate-pulse 占位符直到 onLoad
- 添加 `loading="lazy"` 延迟屏幕外缩略图加载
- 提取 `TipThumbnail` 组件管理独立 loading 状态

### 验证
- `npm run build` 通过，零 TS 错误

---

## v0.5 — Makaron Agent 骨架验证

### 总计划

引入 Makaron Agent：Claude Sonnet 4.6（via Claude Agent SDK + AWS Bedrock）作为 agent 大脑，Gemini 3 作为生图工具。目标是验证完整调用链：用户输入 → Claude Agent → generate_image tool → Gemini → 前端显示。

**阶段拆分：**
1. ✅ Phase 1: 后端 — 安装 SDK + 定义 Agent tools + API route
2. ✅ Phase 2: 前端 — SSE 解析器 + AgentStatusBar + Editor 集成
3. 🔲 Phase 3: 端到端验证 — 本地 dev 测试完整链路
4. 🔲 Phase 4: 迭代完善 — Highlight 模式、Chat 模式、更多 tools

### Phase 1 执行记录（2026-02-18）

**1.1 安装依赖**
- `@anthropic-ai/claude-agent-sdk@0.2.45` + `zod@4.3.6`
- SDK 导出：`query`, `tool`, `createSdkMcpServer`, `AbortError` 等

**1.2 新建 `src/lib/agent.ts`**
- `AgentContext` 闭包模式：tool handler 通过闭包访问当前图片，图片不进 Claude context
- `generate_image` MCP tool：调用现有 `generatePreviewImage()`, 图片存入 `ctx.generatedImages[]`
- `runMakaronAgent()` async generator：产出 `AgentStreamEvent` (status/content/image/tool_call/done/error)
- Agent 配置：`model: 'sonnet'`, `settingSources: []`, `maxTurns: 5`, `permissionMode: 'bypassPermissions'`
- 只暴露 `mcp__makaron__generate_image`，不给文件系统权限

**1.3 新建 `src/app/api/agent/route.ts`**
- SSE 端点，复用 `/api/chat` 的 auth + streaming 模式
- `maxDuration = 120`
- Request body: `{ prompt, image, projectId }`

### Phase 2 执行记录（2026-02-18）

**2.1 新建 `src/lib/agentStream.ts`**
- 前端 SSE 解析器，回调模式：`onStatus/onContent/onImage/onToolCall/onDone/onError`

**2.2 新建 `src/components/AgentStatusBar.tsx`**
- 最简状态栏：fuchsia 圆点 + 状态文本 + ">" 展开按钮

**2.3 修改 `src/components/Editor.tsx`**
- 新增状态：`isAgentActive`, `agentStatus`, `agentAbortRef`
- `handleAgentRequest(text)`: 取当前图片 → 调用 `streamAgent()` → 图片加入 timeline
- **关键路由逻辑**: `handleSendMessage` 中，非上传文本消息自动走 Agent 路径（有图片 + 有 projectId 时）
- 条件渲染：`isAgentActive` 时显示 AgentStatusBar，否则显示 TipsBar

**编译验证**
- `npm run build` 通过，所有 route 正确注册 (`/api/agent` 显示为 ƒ Dynamic)

### Phase 3 端到端验证（2026-02-19）

**问题 1: `CLAUDECODE` 环境变量冲突**
- SDK 内部 spawn Claude Code CLI 子进程，检测到 `CLAUDECODE` 环境变量后拒绝启动（嵌套 session 保护）
- 修复：在 `agent.ts` 模块顶层 `delete process.env.CLAUDECODE`
- Next.js dev server 需要 `env -u CLAUDECODE npm run dev` 启动

**问题 2: stdout 被 SDK 子进程捕获**
- 直接 console.log 在 Bash 中不显示，需要文件重定向 `> /tmp/log 2>&1`
- 不影响 SSE 流式输出（SSE 走 HTTP Response，不走 stdout）

**echo_test 测试（独立脚本 test-agent.mjs）**
- ✅ SDK 加载、MCP server 创建、Bedrock 认证、tool 调用全部成功
- Agent 正确调用 echo_test tool，返回中文确认
- 花费 $0.018，2 turns

**完整浏览器端到端测试**
- 测试消息："把照片调成日系清新风格"
- ✅ Agent 启动 → AgentStatusBar 显示 "Agent 启动中..."
- ✅ Claude 回复 "我来帮你把照片调成日系清新风格。" → 状态变为 "正在生成图片..."
- ✅ Gemini 生图成功 → 图片作为 Edit 3 加入 timeline
- ✅ Agent 完成 → TipsBar 恢复，新 tips 自动生成
- 总耗时约 60 秒（Claude 思考 ~10s + Gemini 生图 ~40s + tips ~10s）

**结论：v0.5 骨架验证通过，完整链路 Agent → Tool → Gemini → 前端 全部跑通。**

---

## v0.6 Makaron Agent — GUI/CUI 双模 + analyze_image（2026-02-19）

### 变更概述

v0.5 骨架验证通过后，本次核心改造：

1. **GUI/CUI 双模切换**：GUI = 图片画布模式，CUI = 全屏对话模式
2. **AgentChatView 全屏聊天**：参考 Claude App 风格，替代 ChatBubble 浮窗
3. **analyze_image 工具**：让 Sonnet 用原生视觉看图，不依赖 Gemini

### Phase B: GUI/CUI 双模 UI

**新建 `AgentChatView.tsx`**
- 全屏深色对话界面 (`fixed inset-0 z-40 bg-[#0a0a0a]`)
- Header：← 返回 + "Makaron Agent" + PiP 缩略图 (48×36)
- User bubble：fuchsia 右对齐，Assistant bubble：white/10 左对齐，markdown 渲染
- Inline image：assistant message 生成的图片直接在对话中展示，可点击切回 GUI 定位到对应 snapshot
- Tool status 卡片：agent 活跃时在底部显示，fuchsia 脉冲点 + 状态文字
- 底部输入栏：圆角 input + fuchsia send button，safe-area padding
- 动画：从右侧滑入 (slideInRight 0.3s)，退出时滑出 (slideOutRight 0.3s)，`isExiting` 状态控制

**Editor.tsx 改造**
- `viewMode: 'gui' | 'cui'` 替代 `chatOpen` / `lastSeenMsgCount` / `hasUnread`
- 移除 ChatBubble 引用和渲染，CUI 是唯一对话入口
- GUI 模式：ImageCanvas + TipsBar + AgentStatusBar + Chat FAB
- CUI 模式：`<AgentChatView>` 全屏渲染
- 切换触发点：
  - GUI → CUI：Chat FAB 点击 / AgentStatusBar "聊天"按钮 / 发消息触发 agent 自动切入
  - CUI → GUI：← 返回 / PiP 点击 / inline 图片点击（同时定位到 snapshot）
- `handleAgentRequest` 改造：
  - 自动 `setViewMode('cui')`
  - 多轮上下文：最近 6 条消息拼入 prompt
  - 生成图片挂到 assistant message 的 `image` 字段（CUI inline 显示）
  - 工具状态区分：`analyze_image` → "正在分析图片..."，`generate_image` → "正在生成图片..."

**AgentStatusBar 改造**
- ">" 按钮改为"聊天"文字按钮
- prop `onExpandChat` → `onOpenChat`

**globals.css**
- 新增 `slideInRight` / `slideOutRight` keyframes + `.animate-slide-in-right` / `.animate-slide-out-right`

### Phase C: analyze_image Tool

**agent.ts**
- 新增 `analyze_image` tool：返回 `image` + `text` content blocks
- 原理：MCP tool 返回 image content block → Claude Agent SDK 把图片作为 tool_result 传给 Sonnet → Sonnet 用原生视觉看图
- 不需要调 Gemini，零额外 API 成本（仅 Sonnet token 费）
- `allowedTools` 加入 `mcp__makaron__analyze_image`

**agent.md prompt 更新**
- 新增 Tools 章节：文档化 analyze_image + generate_image
- 新增 Workflow 章节：
  - 模糊请求（"变好看"、"帮我修一下"）→ 先 analyze_image 再 generate_image
  - 明确请求（"加蝴蝶在肩上"）→ 直接 generate_image
  - 问题（"这张照片怎么样？"）→ 只 analyze_image + 文字回复

### 构建验证
- ✅ `npm run build` 通过，无新增 TypeScript 错误
- ✅ `npm run lint` 无新增错误（仅 pre-existing warnings）

### 文件变更清单
| 文件 | 操作 |
|------|------|
| `src/components/AgentChatView.tsx` | 新建 — CUI 全屏对话 |
| `src/components/AgentStatusBar.tsx` | 修改 — ">" 改为"聊天" |
| `src/components/Editor.tsx` | 修改 — viewMode 双模, 移除 ChatBubble, 改造 handleAgentRequest |
| `src/app/globals.css` | 修改 — slide 动画 |
| `src/lib/agent.ts` | 修改 — 新增 analyze_image tool |
| `src/lib/prompts/agent.md` | 修改 — 新增 Workflow + Tools 章节 |
| `CLAUDE.md` | 修改 — Current Status + Architecture 更新 |

### 待做
- 端到端浏览器验证（CUI 滑入/滑出、PiP 切换、inline 图片点击定位）
- analyze_image 实际效果验证（Sonnet 看图后的 editPrompt 质量 vs 盲写）
- CUI 中上传图片的支持（当前仅 GUI 模式可上传）
- 建议师自动化（Agent 主动分析图片并建议）
- Vercel 部署兼容性验证

---

## v0.6 CUI 重设计 + Agent 流式 + 持久化修复（2026-02-19）

### 变更概述

本次在 v0.6 agent 骨架基础上做了大量 CUI 体验优化、bug 修复和架构完善。

---

### 一、CUI 界面重设计（Claude App 风格）

**AgentChatView.tsx 全部重写**
- Assistant 消息：去掉气泡，文字直接流出（无背景），字体 14.5px，行高 1.68
- User 消息：深色圆角 pill（`#222222`，右下角尖角），右对齐，最大宽度 82%
- 打字等待动画：三个跳动点（复用 `typing-dot` CSS 类）
- Empty state：fuchsia 星号图标 + "Tell me what you'd like to do with your photo"
- 输入栏：`#161616` 圆角容器，placeholder "Reply to Makaron…"，send 键随内容变 fuchsia
- Header：← 返回 + "Makaron"（居中）+ PiP 缩略图（右上角，点击返回 GUI）
- 移除复制按钮（用户反馈不必要）

**Markdown 支持升级**
- 引入 `react-markdown` v10 + `remark-gfm`
- 支持：标题、加粗/斜体/删除线、inline code、代码块、有序/无序列表、引用块、分隔线、链接、GFM 表格
- **CommonMark 特殊 bug 修复**：`**text:**在...` 中 closing `**` 前是标点（`:` `：`等），后跟非空白字符时不被识别为 right-flanking delimiter，导致 bold 不渲染。解决方案：`fixMarkdownDelimiters()` 预处理函数，把尾部标点移到 `**` 外面：`**建议:**` → `**建议**:`

---

### 二、AgentStatusBar 常驻 + 入口简化

- `AgentStatusBar` 从"仅 agent active 时显示"改为**始终显示**（有 snapshot 就显示）
- 默认 greeting 文字：`Hi! 想怎么编辑这张照片？`（`AGENT_GREETING` 常量）
- Agent 完成后 2s 自动重置回 greeting
- 按钮文字：`聊天` → `Chat`
- 圆点：只在 agent 运行时 animate-pulse，idle 时静止灰色 `bg-white/20`
- 去掉 GUI 右下角的 Chat FAB（bubble 按钮）

---

### 三、上传图片流程简化

- 上传图片不再触发 AI 分析（去掉 `streamChat` 调用）
- 不再自动切换到 CUI
- 直接：设置 snapshot → 保存 → 开始加载 tips
- 删除了 `handleSendMessage` 和 `streamChat` helper（所有对话现在全走 agent）
- 删除了 `sessionId` state（legacy chat session 不再需要）

---

### 四、iOS 右滑返回问题修复

- 问题：iOS 系统级右滑触发 `history.back()`，直接跳到项目列表页
- 修复：进入 CUI 时 `history.pushState({ makaronCui: true }, '')`，监听 `popstate` 事件拦截并改为 `setViewMode('gui')`
- 自定义返回按钮改为 `window.history.back()` 触发 popstate，保持 history 栈干净

---

### 五、Agent 真流式（token-level streaming）

- 启用 `includePartialMessages: true`（Claude Agent SDK 选项）
- 处理 `stream_event` 类型消息：`message_start` 重置 turn 计数，`content_block_delta` + `text_delta` 逐 token yield
- 完整 assistant 消息收到后：只处理 tool_call 块，跳过文本（已流式输出过）
- 效果：回复从"一次性出现"变为逐 token 流式

---

### 六、多 Turn 消息分气泡

- 问题：`analyze_image` 前的文字和分析后的回复合并在一个 bubble 里
- 方案：新增 `new_turn` 事件类型（`AgentStreamEvent`）
- agent.ts：`message_start` 触发时（turnCount > 1）yield `{ type: 'new_turn' }`
- agentStream.ts：新增 `onNewTurn` 回调
- Editor.tsx：`onNewTurn` 创建新的 assistant message，后续 content delta 写入新 ID
- 结果：分析前"让我先看看..."和分析后"这是一张..."分为两个独立气泡

---

### 七、Status 动态化（任务描述而非 editPrompt）

- 旧：hardcoded `setAgentStatus('正在生成图片...')` 或显示原始 editPrompt（英文技术描述）
- 新：agent.ts 在 tool_call 前 emit status 事件，内容为中文任务描述
  - `analyze_image` → `"分析图片"` 或 `"分析图片：<question>"` 
  - `generate_image` → `"生成图片中..."`
- Editor `onToolCall` 不再自己设 status（由 agent.ts status 事件驱动）

---

### 八、对话历史格式修复（"User: xxx" echo 问题）

- 问题：多轮上下文用 `User: xxx\nAssistant: xxx` 格式，模型把它当对话续写，回复里出现 `"User: 猫能不能站直起来"` 字样
- 修复：改为只包含前 4 条 user 消息，格式为列表：
  ```
  [User's recent requests for context]
  - "request1"
  - "request2"
  
  Current request: xxx
  ```
- 模型不再 echo 历史格式

---

### 九、Agent 消息持久化修复

- 问题：`handleAgentRequest` 里的 assistant 消息直接 `setMessages`，没有调 `onSaveMessage`，退出项目后对话消失
- 修复：
  - 用 `agentMsgIds[]` 数组追踪本次 run 创建的所有 assistant message ID（包括 `onNewTurn` 创建的）
  - `onDone` 时 `setMessages(prev => { toSave.forEach(m => onSaveMessage?.(m)); return prev; })`
  - `onError` 时同样持久化已有内容
- Inline 图片恢复：`useProject.ts` 加载消息时，`has_image === true` 的消息通过 `snapshot.messageId === message.id` 关联拿回图片 URL

---

### 十、MOCK_AI 精细化控制

- 问题：`MOCK_AI=true` 把 `generatePreviewImage` 也 mock 了，导致 agent generate_image 返回原图
- 修复：
  - 从 `generatePreviewImage` 函数中移除 MOCK_AI 检查
  - 把 mock 逻辑移到 `/api/preview/route.ts` 入口处（只影响 tips 缩略图）
  - `streamTips` 和 `chatStreamWithModel` 保持原有 MOCK_AI 行为
- 最终：`MOCK_AI=true` 时，tips + preview 缩略图走 mock，agent 生图走真实 OpenRouter API

---

### 当前状态（2026-02-19）

- AI_PROVIDER: openrouter（Google API 日配额用完，切换）
- MOCK_AI: true（tips/preview 走 mock，节省费用）
- 浏览器测试全流程通过：新建项目 → 上传图片 → Chat → 多轮对话 → 生图 → 退出 → 重进 → 消息和图片均正确恢复

### 文件变更清单
| 文件 | 变更 |
|------|------|
| `src/components/AgentChatView.tsx` | 全部重写 — Claude App 风格，react-markdown，fixMarkdownDelimiters |
| `src/components/AgentStatusBar.tsx` | 常驻显示，isActive prop，Chat 按钮 |
| `src/components/Editor.tsx` | 移除 streamChat/handleSendMessage，上传流程简化，CUI history 管理，onNewTurn，agentMsgIds 持久化 |
| `src/lib/agent.ts` | includePartialMessages 流式，new_turn 事件，status 任务描述化 |
| `src/lib/agentStream.ts` | onNewTurn 回调 |
| `src/hooks/useProject.ts` | 加载消息时恢复 inline 图片 |
| `src/app/api/preview/route.ts` | MOCK_AI 判断移到 route 层 |
| `src/app/globals.css` | typing-dot 动画（已有，复用） |
| `.env.local` | AI_PROVIDER=openrouter, MOCK_AI=true |

---

## v0.7 Skill 4 (Tips 建议师) + Skill 5 (GUI 感知)（2026-02-19）

### 目标
让 Agent 感知 GUI 状态（TipsBar 内容），并在关键时刻主动发声：
1. Tips 加载完后，agent 生成一句 StatusBar 预告（"试试..."）
2. 用户在 GUI commit tip 后，agent 在 CUI 自然回应 1-2 句
3. 用户在 CUI 发消息时，currentTips 自动注入 fullPrompt

### 架构变更

**新增两个 API 模式**（均走 `POST /api/agent`，`runMakaronAgent(tipReactionOnly: true)`）：
- `tipsTeaser: true` — 无需真实图片，传 tipsPayload（6 条 tip 摘要），返回 1 句预告
- `tipReaction: true` — 传 committedTip 对象，返回 1-2 句 CUI 消息

**新增 3 个 refs**（Editor.tsx）：
- `isAgentActiveRef` — 实时追踪 agent 是否活跃（避免 stale closure）
- `pendingTeaserRef` — agent 活跃时暂存 teaser，agent done/finally 后触发
- `isReactionInFlightRef` — 防重入，避免快速 commit 多个 tip 导致多个 reaction

**StatusBar 流程**：
- 开始 fetch tips：`正在发现有趣的可能...`
- tips 全部加载完：触发 tipsTeaser → StatusBar 显示 agent 生成的 1 句预告
- 若 agent 正在运行：暂存 pendingTeaserRef，等 agent done/finally 后 400ms 触发

**fullPrompt 注入**：`handleAgentRequest` 构建 prompt 时加入 `[当前TipsBar中的编辑建议]` 块

### agent.md 变更
末尾新增 `## GUI Structure Awareness` 章节：
- 描述 GUI 结构（Canvas/TipsBar/StatusBar/CUI）
- Tips as Skills 意图-分类映射表
- 何时推荐 TipsBar tip vs 直接生成
- tipReactionOnly 模式下的行为规则

### MOCK_AI 支持
`route.ts` 两个新分支均有 MOCK_AI 处理：
- tipsTeaser mock: `'试试把它变成微缩模型？特别适合这种场景。'`
- tipReaction mock: `'效果很棒！新图很自然。'`

### 文件变更清单
| 文件 | 变更 |
|------|------|
| `src/lib/agent.ts` | 新增 `tipReactionOnly` 选项（无工具，maxTurns=1）|
| `src/lib/agentStream.ts` | 扩展 body 类型（tipReaction, committedTip, tipsTeaser, tipsPayload）|
| `src/app/api/agent/route.ts` | 新增 tipsTeaser / tipReaction 分支 + MOCK_AI 处理；image 非空校验改为 tipsTeaser 可跳过 |
| `src/lib/prompts/agent.md` | 末尾新增 GUI Structure Awareness 章节 |
| `src/components/Editor.tsx` | isAgentActiveRef/pendingTeaserRef/isReactionInFlightRef；triggerTipsTeaser；triggerTipCommitReaction；fetchTipsForSnapshot 触发 teaser；runAutoAnalysis finally 排空 pending；handleAgentRequest 注入 tipsContext + onDone 排空 pending；commitDraft 触发 reaction |

---

## v0.8 CUI × Draft 交互修复 (2026-02-19)

### Bug 修复

**Draft 模式下 CUI 无响应**
- 根因：`handleAgentRequest` 用 `snapshotsRef[viewIndex]?.image` 取图，draft 时 `viewIndex = snapshots.length`（超出数组），取到 `undefined` 后直接 `return`
- 修复：当 `image` 取不到时，fallback 到 `draftParentIndex` + `previewingTipIndex` 对应的 `previewImage`（或父 snapshot 原图），并记录 `contextSnapshotIndex`
- 新增 `draftParentIndexRef` / `previewingTipIndexRef` 两个 ref，供 `useCallback` 闭包实时读取

**Draft 模式下 description 上下文错误（A 方案）**
- 根因：之前用 `contextSnapshotIndex`（父 snapshot）的 description，但实际发给 Agent 的是 preview 图，图文不匹配
- 修复：检测到 `contextSnapshotIndex !== viewIndexRef.current`（draft fallback）时，description 置 undefined，Agent 直接看图决策，不传错误描述

**Draft 模式下 CUI PiP 显示原图**
- 根因：`<AgentChatView currentImage={snapshots[viewIndex]?.image}>`，draft 时 viewIndex 越界
- 修复：`isDraft ? (draftImage ?? undefined) : snapshots[viewIndex]?.image`，PiP 正确显示 preview 图

### Tip Commit 后 CUI 体验优化

**commit tip 后显示生成图而非文字**
- 之前：assistant 消息显示 `已应用编辑：${tip.desc}` 文字
- 修复：`addMessage('assistant', '', tip.previewImage)`，直接内联展示 preview 图片

**tipReaction 推荐真实 TipsBar 内容**
- 根因：reactionPrompt 没有注入当前 tips，Agent 只能参考 system prompt 里的示例（"电影感光影"），每次都推荐光影变化
- 修复：`commitDraft` 把其余 5 条 tips 作为 `siblings` 传给 `triggerTipCommitReaction` → `streamAgent({ currentTips })` → route.ts 拼入 prompt「TipsBar 里还有这些可以试的」，Agent 只能从真实 tip 里推荐

### 文件变更清单
| 文件 | 变更 |
|------|------|
| `src/components/Editor.tsx` | 新增 `draftParentIndexRef` / `previewingTipIndexRef`；`handleAgentRequest` fallback draft image + 跳过 description；PiP 用 `draftImage`；commit 消息带图；`triggerTipCommitReaction` 接收并传递 `siblingTips` |
| `src/lib/agentStream.ts` | body 类型新增 `currentTips?: object[]` |
| `src/app/api/agent/route.ts` | 解构 `currentTips`；tipReaction prompt 注入 sibling tips 上下文；新增 eventCount 日志 |

---

## v0.7 产品优化 (2026-02-19)

### CUI 体验改进
- **浮动返回按钮**：header 从 flex-flow 改为 `absolute` overlay（`bg-black/40 backdrop-blur-sm`），不再有黑色条带遮挡 PiP 和消息内容
- **Enter 发送**：添加 `e.preventDefault()` + `!e.nativeEvent.isComposing`（中文 IME 安全）
- **CUI 字体放大 ~50%**：用户气泡 14px→21px，assistant 文字 14.5px→22px，输入框同步

### 预览图就绪通知（AI 生成）
- 所有 tip 预览图生成完毕后，AI 自动生成 1-2 句 CUI 通知
- 独立 `previewsReady` API 分支，传入 tips 列表让模型点评其中一个有趣的
- `previewsNotifiedRef` 防重复，`initialSnapshots` 预播种防已有项目重新通知

### 旧项目自动命名
- Editor 挂载时检测默认标题 (`Untitled/未命名/未命名项目`) + snapshot 已有 description → 触发 `triggerProjectNaming`
- 效果：打开旧项目会自动从图片分析内容生成中文项目名

### Bug 修复
- **StatusBar 卡住 "4/6"**：`useProject.ts` 从 DB 加载时，有 `editPrompt` 但无 `previewImage` 的 tip 改设为 `previewStatus: 'error'`（之前是 `undefined`，不计入 settled）
- **无法重试失败预览**：同上，'error' 状态 TipsBar 正确显示重试按钮

### 项目管理（新功能）
- 项目列表每行新增 `···` 按钮，点击弹出底部 action sheet
- **删除**：乐观更新（立即从列表消失），DB 删除在后台并行执行（messages + snapshots + project）
- **重命名**：inline 输入框，预填充当前标题，Enter / 保存

### UI 细节
- TipsBar 去掉 `pr-14` 右侧空隙（原为 ChatBubble 预留，现已移除）
- AgentStatusBar 点：始终有颜色 + 呼吸动画
  - Idle（打招呼）：violet-400，2.8s 慢呼吸
  - 生成修图建议：amber-400，2s
  - 生成预览图（nano banana pro）：purple-400，1.6s
  - Agent 思考中：fuchsia-400，1s 快呼吸
- 状态文字更新：`正在生成修图建议 Ready to Suprise` / `正使用nano banana pro生成图片 X/X`


---

## 人脸裁图 ref 实验 (2026-02-21)

### 实验目标
测试"人脸方形裁图作为 reference"是否比"原图整图作为 reference"对 Gemini 人脸还原效果更好。

### 方法
- 用 BlazeFace 检测原图所有人脸，裁出 512×512 方图
- 方案 A（对照）：`[编辑图, 原图整图]` → `test-face-restore.mjs`
- 方案 B（实验）：`[编辑图, 人脸裁图1, 人脸裁图2, ...]` → `test-face-crop-ref.mjs`
- 测试素材：餐厅合影（左边女性 + 右边老人），编辑图加了一只穿红色汉服的松鼠（creative tip）

### 测试素材
- 原图：`test-assets/face-crop-experiment/original.jpg`
- 编辑图（含松鼠）：`test-assets/face-crop-experiment/edited.jpg`
- 对照组结果：`result-fullimg-ref.jpg`
- 实验组结果：`result-crop-ref-4.jpg`（最终版）

### 结论
**人脸 identity 还原：裁图 ref 有效**
- 4 轮 prompt 迭代后，左边女性 side-eye 变形修复，人脸恢复自然
- 关键 prompt 改进：
  - 明确"AI 变形"而非 restore，用 OVERRIDE/REPLACE 强制语言
  - 图片前先用文字定义每张图角色（Image 1 = base，Image 2/3 = face reference only）
  - 位置明示（leftmost / rightmost person）

**构图/尺寸保持：Gemini 无法可靠控制**
- 输出从 1200×896 变成近方形（受 512×512 裁图影响）
- creative 元素（松鼠）构图有偏移
- 这是 Gemini 多图输入模式的固有限制，prompt 无法完全解决

**方案 A vs 方案 B**
| | 方案 A（整图 ref） | 方案 B（裁图 ref） |
|---|---|---|
| 速度 | 9.5s | 25s |
| 人脸还原 | 成功率低 | 成功率更高 |
| 构图/尺寸稳定 | 较好 | 差（受方图干扰） |

### 待探索方向
- 裁图 ref + sharp 后处理强制还原尺寸（Gemini 只负责人脸内容，sharp 负责精准定位合成）
- 或沿用 face-restore-auto 三步流程（blazeface → sharp 机械合成 → gemini 融边）

---

## v0.8 Tips 速度优化实验 + PiP 改版 (2026-02-21)

### Tips 速度优化实验（结论：回滚）

**compact .md 分层方案**（实验，已回滚）
- 思路：在每个 `.md` 文件加 `<!-- DETAILED -->` 分隔，API 调用只传精简区（~1500 chars），batch-test 传全文
- context 减少 54%（~6500 → ~3000 chars），理论首个 tip ~8-12s
- V43 batch-test 跑了一轮（compact 模板），用户评价"效果一般"，已回滚

**模型对比测试**
- `gemini-3-pro-image-preview`（原始）：tips 完成 22-40s/次
- `gemini-2.0-flash-001`：tips 完成 10-12s/次（快 3x），但用户反馈质量不好
- `claude-sonnet-4-5`（OpenRouter）：tips 完成 22-24s/次，质量不错但不如 gemini-3
- **结论**：保留 `gemini-3-pro-image-preview`，compact 模板和模型切换均回滚

**V43 测试结果**（compact 模板）
- 图片：IMG_1222.HEIC, IMG_4995.HEIC, DJI_20210913_170156_032.JPG, IMG_1259.PNG, IMG_4999.jpg
- 成功率：30/30
- 问题：梯田变蛋糕（wild 陷阱仍触发），镜片反射内容（wild Q2 不通过），整体效果一般

### generateImageWithReferences fallback 修复
- 旧：fallback 用 `images[images.length - 1]`（originalImage），错误
- 新：fallback 用 `images[0]`（currentImage = edit base），加 success/failure 日志

### PiP 画中画大改版

**外观 & 尺寸**
- 去掉 72px small 模式，只保留 116px / 200px，tap 循环
- 新增边缘收起功能（类 iPhone 画中画）

**收起/展开 UX**
- 两步收起：先 snap 到角落，再从角落往边缘推超过 `PIP_EXTRA_PULL(60px)` 才收起
- 收起方向：左边缘 / 右边缘均可
- 收起后只露出 28px peek + 方向箭头（左 `>` / 右 `<`）
- 展开：tap 或 swipe 均可触发
- 限制：只有"从边角位置出发的拖动"才能触发收起，防止误操作

**键盘适配**
- `e.stopPropagation()` 阻止 PiP 触摸事件冒泡，解决键盘弹起时画面跳动
- `visualViewport` 监听键盘高度，动态设 input bar `paddingBottom`，input bar 随键盘平滑上移（不 resize 容器）

**Bug 修复**
- 右边收起时漏加 `setPipHiddenEdge('right')`，导致收右边实际执行了左边动画

---

## Agent 指令接受修复 (2026-02-21)

### 问题
Makaron Agent 拒绝用户两类显式请求：
1. **改变人脸/表情**（如"让他笑"、"改表情"）— agent 引用 Face Preservation 规则直接拒绝
2. **加 caption/文字**（如"加字幕"、"做成明信片加文字"）— `generate_image_tool.md` 末尾硬写 `"Do NOT add any text"` 覆盖了用户意图

### 根本原因
- `agent.md` Face Preservation 用了绝对禁止语气（"NEVER request lip/mouth changes"），Claude 误解为"拒绝用户请求"而非"自主选择时避免"
- `generate_image_tool.md` 的 `"Do NOT add any text, watermarks, or borders."` 无条件附加到所有 editPrompt

### 修复
**`agent.md`**：Face Preservation 改为"Default Constraint"，明确区分：
- 自主选择时 → 遵守限制
- 用户显式要求时 → 直接执行，不拒绝

**`generate_image_tool.md`**：`"Do NOT add any text"` 加例外条款 —— 用户明确要求文字/caption 时省略这句

### 验证结果（日志确认）
- `skill=wild` → wild.md 注入 ✅
- `skill=enhance` → enhance.md 注入 ✅  
- `skill=creative` → creative.md 注入 ✅
- 用户要求改表情 → `skill=none`，agent 直接写 editPrompt 执行 ✅（不再拒绝）
- 用户要求加 caption/明信片文字 → editPrompt 包含文字指令，无 "Do NOT add text" ✅

---

## V44 Captions 首测 (2026-02-21)

### 测试配置
- **图片**：IMG_0089.HEIC（写真）、IMG_0050.HEIC（美食夜宵）、IMG_6470.HEIC（迪士尼情侣）
- **类别**：captions only（`--categories captions --count 3`）
- **成功率**：6/6
- **平均分**：3.5

### 评分详情

| 分数 | Tip名 | 图片 | 用户反馈 |
|------|-------|------|---------|
| 3 | 添加地砖诗意文案 | IMG_0089 | 说了等于没说，也不唯美。其实不如做一张海报 |
| 3 | 添加人物动作英文 | IMG_0089 | 说了等于没说，也不唯美。其实不如做一张海报 |
| 4 | 加一句'这个味儿对了' | IMG_0050 | 文案是有趣的，但字在画面中不有趣 |
| 4 | 写上'满足的夜晚' | IMG_0050 | 文案是有趣的，但字在画面中不有趣 |
| 4 | 写上乐园心情 | IMG_6470 | 文案是有趣的，但字在画面中不有趣 |
| 3 | 加上日期印记 | IMG_6470 | 记录感觉应该像明信片封底，或iPhone拍摄那种封底 |

### 核心洞察

#### 根本问题：文案好，但「视觉呈现」形式不对
所有评分都是 3-4 分，失败在同一个维度：**文字叠加（text overlay）这个形式本身就是错的**。

- 文案内容有趣（"今日份迪士尼在逃王子与公主"、"这个味儿对了"）→ 用户认可内容
- 但文字贴在照片上 = 廉价水印感，不是「设计」

#### 用户真正想要的是什么
1. **海报风格**：把照片做成整体设计作品（不是在照片上贴字）
2. **明信片封底**：像真实明信片一样有设计感的排版
3. **iPhone 照片封底**：类似 Apple 的 "Shot on iPhone" 简洁质感

#### "说了等于没说" 问题
写真场景的文案（"迷失在繁花地砖上"、"A gentle backward glance."）虽然语义上针对图片，但视觉上太「文学」——读者看了感受不到这句话和图片的化学反应。

### V45 改进方向

**核心重构：从「文字叠加」改为「版式设计」**

两个可行的子方向：
1. **海报模式**：在照片底部或四周加设计感边框+排版，文字是整个设计的一部分（不是浮在照片上）
2. **明信片/胶片模式**：模拟胶片底部信息栏（日期/地点/相机型号）或明信片封底排版

关键原则改变：
- 旧：让 Gemini 在照片上叠字
- 新：让 Gemini **重构画面版式**，文字是设计元素，不是贴纸


---

## Captions 迭代汇总 V44-V48 (2026-02-22)

### 分数趋势
| 版本 | 均分 | 核心变化 |
|------|------|---------|
| V44 | 3.5 | 首测，纯文字叠加，形式错误 |
| V45 | 4.8 | 改为4种模式（选模式思路，有提升但模型机械匹配）|
| V46 | 5.7 | 改为四问自检框架，照片也要配合文字变化 |
| V47 | 6.5 | 加Q5惊喜问，出第一个9分（Met博物馆海报）|
| V48 | 5.8 | 加地点约束，batch无地标照片导致略降 |

### 已验证结论

**高分公式**：具体地点名 + 画面强视觉设计 + 照片本身也配合调整
- 9分：Metropolitan Museum 展览海报
- 8分：DUMBO/Brooklyn 杂志封面、Rose Reading Room 杂志大标题、电影感字幕

**稳定失败模式**：
- 胶片时间戳无地点 → 3-4分（"没有地点很不好"）
- 气泡对白 → 4分（"很呆，美女配气泡很不搭"）
- 纯文字叠加没设计感 → 3分（"说了等于没说"）
- 中英混排 → 扣分（要统一语言）

**最关键洞察**：
- "文案要跟画面配，其实画面也可以变化，去迎合这个文案" → Part 1（照片变化）+ Part 2（文字设计）两部分都要写
- 选模式 < 自问原则：四问+Q5惊喜 比 预设4种模式更有效
- 具体地点名 >> 泛化描述（DUMBO vs "都市街头"）

### 当前 captions.md 状态（V48 版本）
- 前置检查：画面有无已有文字
- 五问自检（Q1故事、Q2角色、Q3位置逻辑、Q4文字价值、Q5惊喜）
- 执行分两部分：照片如何配合 + 文字如何设计
- 约束：照片变化克制、胶片戳必须含地点、语言统一、禁气泡

---

## Captions V49-V52 迭代记录 (2026-02-22)

### 分数趋势（完整）
| 版本 | 均分 | 核心变化 |
|------|------|---------|
| V44 | 3.5 | 首测，纯文字叠加 |
| V45 | 4.8 | 4种模式 |
| V46 | 5.7 | 四问自检框架 |
| V47 | 6.5 | Q5惊喜问，出首个9分 |
| V48 | 5.8 | 地点约束 |
| V49 | 6.1 | 隐藏角度前置步骤，6张图 |
| V50 | 5.5 | MSCHF/Dazed参考，photo迎合文案 |
| V51 | 6.1 | 海报3问自检+A24/Supreme/Dazed词汇 |
| V52 | 5.0 | metadata死规则（困难batch拉低） |

### V49-V52 新增验证结论

**最稳定高分方向：心声/旁白 (inner monologue)**
- "This moment, right here." → 8分
- "please let the toy gods hear me..." → 8分
- 特征：handwritten script, 一句话, 不显眼但精准, 放在有空间的地方

**A24 风格：概念强=8分，概念弱=3分**
- SUNDAY EDITION（聪明反讽）→ 8分
- SIAM DREAMS（空洞）→ 3分（用户："A24风格可能不要了"）
- 结论：风格是工具，概念才是核心

**Brutalist 过激 → 破坏原图**
- OKLAHOMA! 红字对角线 → "破坏了原图的内容" → 3分
- 约束：改动必须克制，主体场景必须可识别

**Metadata 死规则初步生效**
- ANAHEIM, CA（有据可查）→ 8分
- BANGKOK（猜测错误）→ 3分，"时间和地点都错了"
- 仍需强化：模型仍偶发猜测

**白字对比度问题**
- 白字放在白色背景区域 → "看不清" → 5分
- 需要在执行标准里加：文字颜色必须与放置区域有对比

### 下一步方向
1. 强化心声方向（最稳定高分）
2. 海报方向：概念 > 风格，弱概念+任何风格=3分
3. 加文字对比度自检
4. Metadata 规则继续强化

---

## 产品 UI 迭代（2026-02-22）

### 参考图上传功能（CUI 图片附件）

**功能描述**：在 CUI 聊天界面支持上传最多 3 张参考图，用于"把这个人加到图里"等合成需求。

**架构**：
- `AgentChatView`：输入框下方工具栏加图片按钮（圆形，与发送按钮统一风格），图片缩略图在工具栏内联显示，选图后客户端压缩（max 1024px, quality 0.85）
- `agent.ts`：`referenceImages[]` 存入 `AgentContext`，`generate_image` 工具执行时将参考图作为 Image 2/3 传给 Gemini（N 图模式）；Claude Sonnet 本身不看参考图，只通过 prompt 文字获知"有 N 张参考图已备用"
- `Editor.tsx`：`handleAgentRequest(text, attachedImages?)` → `streamAgent({ referenceImages })` → API → `runMakaronAgent({ referenceImages })`
- 参考图也出现在 `EditPromptCard` 的"传入图片"展示里（`toolCallImages` 包含 referenceImages）

**输入框布局（B 方案）**：
- 上行：textarea 全宽（placeholder 文字，多行自然生长）
- 下行工具栏：`[📷 圆形按钮] [缩略图 w-9 h-9...] [flex-1 spacer] [↑ 发送]`
- 图片按钮与发送按钮统一为 `w-8 h-8 rounded-full`，图片按钮激活时 fuchsia 半透明底

**已发消息气泡**：参考图显示为 `w-20 h-20 object-cover` 方形缩略图

### CUI 输入框浮层化（分割线去除）

- 去掉 `borderTop` 分割线
- 输入框改为 `position: absolute bottom: 0`，顶部加 32px 渐变淡出（`transparent → #0a0a0a`）
- 消息区域 `paddingBottom = inputBarH`（动态），最后一条消息能滚入渐变区域若隐若现
- 键盘弹出时：`bottom: ${kbInset}px` 代替原来的 paddingBottom 调整

### PiP 位置系列修复

**PIP_BOTTOM_OFFSET 动态化**：
- 用 `ResizeObserver` 监听 input bar 高度，`PIP_BOTTOM_OFFSET = inputBarH - 32 + 4`（减去渐变 paddingTop）
- `cuiInputBarH` ref 通过 `onInputBarHeight` callback 传给 Editor

**Race condition 修复**：
- 旧问题：`openCUI` 立即计算 `toRect`，但 CUI 未挂载，`cuiInputBarH.current` 是旧值
- 修法：`toRect` 移到第二个 `requestAnimationFrame` 里计算（此时 ResizeObserver 已触发，值准确）
- 效果：GUI→CUI 动画终点与真实 PiP 位置完全吻合，无跳动

---

## Captions V53-V60 迭代记录 (2026-02-22)

### 分数趋势
| 版本 | 均分 | 核心变化 |
|------|------|---------|
| V53 | 3.6 | 大改结构失败，回滚 |
| V54 | — | enhance+captions 综合测试（API不稳定）|
| V55/V56 | 5.1 | 新增固定句子(清场+V字脸)、高分公式参考、语言默认中文 |
| V57 | 5.8 | 海报/杂志3问自检、A24/Supreme/Dazed词汇 |
| V58 | 4.3 | **硬规则：caption不能改照片** |
| V59 | 6.6 | **最高均分**。高分公式重写，正面案例引导 |
| V60 | 5.3 | 发现"模板化"问题：每批都是海报+胶片戳 |

### V59 为什么好（6.6分）
- 高分公式按三个方向分别给正面案例
- 案例具体：冰淇淋旁奶油色手写（8分）、拱门红字标题（9分）
- 文字颜色从场景来（"感觉长在那里"）

### V60 发现的核心问题
**模板化**：每批固定输出"一个电影海报 + 一个胶片时间戳"，缺乏随机性
- 根本原因：模型学会了这两个"安全"组合，不再真正思考
- 已修复：在Q2加"防模板规则"——明确点名"标题设计师+记录者=最无聊的组合"

### 继续更新的方向（已识别，待验证）

1. **多样性问题**：需要验证防模板规则是否有效破除固化组合
2. **心声方向深挖**：V59的8-9分都在心声方向，可以加更多心声的位置/颜色自检case
3. **胶片戳年份问题**：V60仍有两个"缺年份"扣分，需要更强的提示
4. **"改了照片"问题**：V60的7分黑白剧照其实改了图片，说明边界仍模糊
5. **enhance开放方向**：修改了必选6方向→可选7方向，待跑一轮enhance测试验证

### 已验证的 captions 高分案例规律（截至V60）
- **心声贴着场景**：字色=物体颜色，字形=表面纹理 → 8-9分
- **大标题放留白区**：天空/拱门/深色背景，高度20%+，颜色强对比 → 8-9分
- **胶片戳三要素**：地点+月份+年份，缺一扣分 → 7-8分
- **两个tip角色必须不同**：海报+海报/胶片+胶片 = 无聊

---

## Captions V57-V60 分析 + V61 方向 (2026-02-22)

### 分数趋势（完整）
| 版本 | 均分 | 备注 |
|------|------|------|
| V44 | 3.5 | 首测，全失败 |
| V47 | 6.5 | 历史最高（当时）|
| V51 | 6.1 | 4个8分 |
| V53 | 3.6 | 大改版失败，回滚 |
| V59 | **6.6** | 历史最高，7个高分 |
| V60 | 5.3 | 模板化收敛，均分下降 |

### 稳定高分模式（验证次数多）
1. **心声贴着动作/表面**：文字颜色从物体来，形态贴着纹理走 → 8分（冰淇淋/砖墙/水面）
2. **精确地名 + 大标题**：BROOKLYN/THE MET/迪士尼 + 占高度20%+ → 8-10分
3. **胶片时间戳三要素齐全**：地点+月份+年份，橙色数字 → 7-8分

### 稳定失败模式
- A24/好莱坞海报模板（没有具体地名）→ 3-5分
- 胶片时间戳放标题/缺年份 → 1-5分
- 改变照片（B&W/letterbox/大幅调色）→ 1分
- 白字放浅色背景 → 1-3分
- 模板化（标题设计师+记录者 每张都一样）→ 用户说"像模板"

### 5个尚未解决的问题
1. **场景清场 vs 人脸保留冲突**：Clean up 有时破坏人脸（v58 1分）
2. **Metadata 注入缺口**：没有真实EXIF时，模型猜年份/地点 → 经常猜错
3. **模板化收敛**：总是 标题设计师+记录者 组合，缺乏多样性 → 已加防模板规则
4. **杂志封面风格总被拒**："很土"/"老气" 是常见反馈，但手写体总得高分
5. **场景类型判断缺失**：亲密日常照 ≠ 地标照，同一套模板不应该用在所有场景

### V61 改进方向（优先级排序）
1. 测试防模板规则效果（已加入）
2. 强化"文字渲染在场景材质上"这个方向（ice cream字体感=材质感）
3. 更明确的心声位置规则：动作延伸处=好；头顶=差
4. 考虑加入场景类型自检：是亲密日常？还是地标/产品照？不同类型对应不同推荐角色

---

## Tips 首屏加速 (2026-02-23)

### 背景
首个 tip 出现需要 20+ 秒，partial streaming 逻辑代码正确但体感没有生效。

### 根本原因（已确认）
`streamTipsByCategoryOpenRouter` 第 848 行用的是 `OPENROUTER_MODEL`（`google/gemini-3-pro-image-preview`，图像生成模型），而非文本生成模型。`TIPS_MODEL = 'google/gemini-2.0-flash-001'` 早已定义但从未被 OpenRouter 路径使用。图像生成模型用于纯文本生成时 TTFT 高达 5-15 秒，是主因。

### 修改内容
| 文件 | 改动 |
|------|------|
| `src/lib/gemini.ts` | 新增 `streamTipsByCategoryBedrock`（Vercel AI SDK + AWS Bedrock Claude Sonnet）；`TIPS_PROVIDER` 默认 `'bedrock'`；`TIPS_TEMPERATURE=0.9`；修复 OpenRouter `t0` 计时位置；移除 `analysisStep`（Sonnet 不需要显式分析指令） |
| `src/app/api/tips/route.ts` | 加 `X-Accel-Buffering: no` 防 SSE 缓冲 |
| `src/components/Editor.tsx` | 加 `console.time` 前端计时日志 |

Tips 模型可通过 `.env.local` 的 `TIPS_PROVIDER` / `TIPS_TEMPERATURE` 切换，方便 A/B 测试。

### 测试结果（Bedrock Claude Sonnet-4-5，本地 dev）

**后端计时（从 streamText 调用起，多次平均）：**
| 分类 | 首个 partial tip |
|------|----------------|
| wild | ~5.8s |
| creative | ~6.1s |
| enhance | ~5.1~6.4s |
| captions | ~6.0~6.6s |

**前端感知时间（含 Supabase auth + routing 约 3s 额外开销）：**
- 首个 tip 出现：**6.6~8.1s**（目标 10s ✅）
- 全部 8 个 tip 流式完成：~14~17s

**对比：**
- 修复前（gemini-3-pro 图像模型）：20+ 秒
- 修复后（Bedrock Sonnet）：首 tip 6.6~8s，稳定达标

### 关键结论
- 用图像生成模型做纯文本 tips 是主因，TTFT 极高且不稳定
- `streamText ready at +0~4ms`——Bedrock 连接建立极快，时间主要在 TTFT（~5-7s）
- 前端比后端多约 3s = Supabase auth check + Next.js routing 开销
- Partial streaming 代码本身一直是正确的，瓶颈完全在模型选择

### 后续：质量问题，回滚 gemini-3 (2026-02-23)

Bedrock Sonnet 速度达标（6-8s）但 tips **质量明显差**——idea 层面（label/desc）就不如 gemini-3，不只是 editPrompt 差。这是第二次验证同一结论（第一次试 Flash 也失败）。根本原因：gemini-3-pro-image-preview 是图像生成模型，天然理解"什么编辑指令能出好图"，通用语言模型没有这种 image editing intuition。

**两阶段方案 API 测试结果（gemini-3，OpenRouter）：**
| | TTFT | Total |
|---|---|---|
| 全量请求（当前） | 23.8s | 25.2s |
| Stage 1（仅 label+desc，短 prompt） | 9.9s ~ 15.6s | 10.4s ~ 16.3s |
| Stage 2（editPrompt，120行模板，2条并行） | 16.4s ~ 30.4s | 31.8s |

两阶段方案可以把首个 tip 卡片从 20+s 降到 10-16s，但 gemini-3 TTFT **抖动极大**（同样请求差 6s），且 Stage 2 editPrompt 要 32s 才全部就绪，用户点击时可能还没好。

**当前决策：回滚到 gemini-3（`TIPS_PROVIDER=openrouter`）优先保质量**，速度问题待更好方案出现再解决。两阶段方案保留为候选，需要解决 TTFT 抖动问题才有实用价值。

---

## v1.0 Snapshot 动画功能（2026-02-23）

### 功能描述
当项目有 ≥3 个 snapshot 时，timeline dots 末尾出现 ▶（生成视频）按钮。点击弹出底部 AnimateSheet（72% 屏高）。

### 技术架构
- **API 提供商**：PiAPI Kling 3.0 Omni（多图关键帧输入）
- **多图格式**：`images: [url1, url2, ...]` + prompt 中 `@image_1`、`@image_2` 引用
- **图片限制**：最多 4 张（均匀采样），必须是 Supabase Storage HTTP URL（不能 base64，会报 input too large）
- **Prompt 生成**：`/api/animate/prompt` → Gemini 分析所有图片 → 流式输出电影感故事
- **任务创建**：`POST /api/animate` → PiAPI 返回 taskId
- **轮询**：前端每 8s 调 `GET /api/animate/[taskId]`，完成后 Sheet 内显示视频播放器

### 已踩的坑
| 问题 | 根因 | 修复 |
|------|------|------|
| `task input is too large` | 把 base64（2-5MB）当 JSON 发给 PiAPI | 只用 `s.imageUrl`（HTTP URL） |
| `account credit not enough` | 测试脚本消耗了积分 | 充值 PiAPI 账户 |
| 7 张图 fetch failed | PiAPI 可能有图片数量限制 | 限制最多 4 张 |
| `/api/animate` 401 | 手机浏览器未登录，服务端 session cookie 不存在 | 手机需先在 /login 登录 |

### 验证结果
- ✅ 完整流程本地测试通过（vege_kyd@msn.com 账户）
- ✅ 生成效果：像素游戏角色从人物身体飞出，完全按故事 prompt 描述
- ✅ 生成时间：约 5 分钟（10s 视频，Kling 3.0）
- ✅ 费用：10s 约 $1.68，5s 约 $0.84
- ✅ 已部署到 www.makaron.app

### 待优化
- 视频保存到 Supabase Storage（当前只存 PiAPI 临时 URL，有效期不确定）
- Agent 脚本生成速度慢（Bedrock Sonnet 多图 TTFT ~2 分钟），考虑用 Gemini 替代或减少图片数量

---

## v1.0.1 Animate UX 重构（2026-02-24）

### 解决的 4 个核心问题
1. **GUI/CUI 切换重复发请求**：每次点"在 Chat 里看"都触发新的 Agent 脚本生成 → AnimationState 提升到 Editor 层，CUI 只切视图不触发 Agent
2. **CUI 返回 AnimateSheet 丢失**：两个视图状态断开 → animationState 在 Editor 持久化，sheet 重新挂载从 state 恢复
3. **Agent 看不到图片**：只收到 URL 无法分析 → animationImages 作为 content blocks 传入 user message，Agent 直接看到所有 snapshot
4. **重进项目无视频**：project_animations 表有数据但未加载 → loadProject 查询 completed + processing 状态的动画记录

### 架构改动
| 改动 | 说明 |
|------|------|
| `AnimationState` 接口 | 提升到 Editor.tsx，AnimateSheet 变为 props-driven |
| 脚本生成 | 从 Gemini `/api/animate/prompt` 改为 Agent（Bedrock Sonnet）后台运行 |
| 图片传递 | base64 → URL（Bedrock 服务端拉取，避免 5-10MB 客户端上传） |
| 视频 Timeline 条目 | `__VIDEO__` sentinel 追加到 timeline，canvas 渲染 `<video>` |
| AnimateSheet | 从 72dvh 全屏蒙版 → 33dvh 无蒙版底部 sheet 卡片 |
| snapshot.imageUrl | saveSnapshot 上传后通过 onUploaded 回调更新（解决新 snapshot 无 URL） |
| StatusBar 进度 | 脚本生成/视频渲染/下载状态实时显示 |
| 视频保存 | `/api/proxy-video` 代理绕过 CORS，iOS Web Share API 保存到相册 |

### 关键文件改动
- `Editor.tsx`：+AnimationState、timeline sentinel、条件渲染 sheet、handleDownload 视频支持、StatusBar 进度
- `ImageCanvas.tsx`：▶ 按钮右移恢复 24px、video 渲染 + poster + 居中播放按钮、跳过 zoom/compare
- `AnimateSheet.tsx`：33dvh 无蒙版、filmstrip 移到 prompt 下方
- `agent.ts`：animationImages → 多图 user message content blocks
- `agent.md`：Agent 只输出脚本不调 generate_animation tool
- `useProject.ts`：查询 project_animations（completed+processing）、onUploaded 回调
- `/api/proxy-video/route.ts`：新增，服务端视频代理下载

### 已踩的坑
| 问题 | 根因 | 修复 |
|------|------|------|
| AnimateSheet X 按钮关不掉 | `isViewingVideo` 为 true 时 sheet 始终显示 | 点 X 同时 navigate 回最后 snapshot |
| Canvas 黑屏 | 视频第一帧是黑色 | 用最后 snapshot 作为 `<video poster>` |
| 消息重复（"帮我把这些照片做成一段视频"出现两次） | AnimateSheet useEffect 和 Agent 竞态 | `animPromptInFlightRef` 同步 guard |
| 进入项目直接跳到视频条目 | prevAnimStatusRef undefined→done 触发 auto-navigate | 加 `prev &&` guard 只在真实状态转换时导航 |
| 新 snapshot 点 ▶ 报"需要至少 2 张图" | snapshot.imageUrl 未设置（上传是异步的） | saveSnapshot onUploaded 回调更新 imageUrl |
| 视频 CORS 下载失败 | storage.theapi.app 无 CORS header | `/api/proxy-video` 服务端代理 |
| Agent 脚本生成慢（2+ 分钟） | base64 图片上传 5-10MB | 改为传 URL，Bedrock 服务端拉取 |

### 验证结果
- ✅ ▶ 按钮在 timeline 右侧，24px fuchsia
- ✅ 点 ▶ 弹出 33dvh sheet 卡片，canvas 不被遮挡
- ✅ 视频作为 timeline 最后条目，canvas 居中播放按钮
- ✅ GUI↔CUI 切换状态不丢失，不重复生成脚本
- ✅ 重进项目保留视频 + 脚本
- ✅ StatusBar 实时进度
- ✅ iOS Save 弹出分享表

---

## Supabase 区域迁移：悉尼 → 东京（2026-02-24）

### 背景
国内访问 Supabase 悉尼（`ap-southeast-2`）延迟高（150-250ms RTT），整体体验慢。Free 计划 Nano 实例（共享 CPU，0.5GB RAM），升配只提升查询性能不减延迟，根因是物理距离。

### 方案选择
- 东京（`ap-northeast-1`）：国内延迟 40-80ms，Supabase 支持的离中国最近区域之一
- 新加坡（`ap-southeast-1`）：类似延迟，适合南方用户
- 最终选东京，Vercel Function Region 也对齐到 `hnd1`

### 迁移步骤
1. **新建东京项目** `sdyrtztrjgmmpnirswxt`（Free 计划，$0/月）
2. **Schema 迁移**：`apply_migration` 一次性创建 5 张表（projects, snapshots, messages, project_images, project_animations）+ RLS policies + Storage bucket
3. **数据迁移**：`postgres_fdw` 在新项目建外部表连接旧库，`INSERT...SELECT` 一次性拉取全部数据
   - projects: 166 行
   - snapshots: 423 行
   - messages: 1200 行
   - project_animations: 8 行
4. **URL 替换**：批量 `UPDATE ... replace()` 把 `cover_url`、`image_url`、`snapshot_urls` 中的旧 ref 替换为新 ref
5. **Storage 迁移**：Node.js 脚本（10 并发），从旧 public bucket 下载 → 上传到新 bucket
   - 2374/2374 成功（3 个 502/504 超时后重试成功）
   - 临时添加 anon upload policy，完成后删除
6. **Auth 用户复制**：直接 INSERT auth.users + auth.identities，保留原 user_id + 密码哈希，无需 user_id 映射
7. **Auth URL 配置**：Site URL = `https://makaron.app`，Redirect URLs 3 条（production + localhost + Vercel preview）
8. **环境变量切换**：`.env.local` + Vercel CLI `env rm/add`，指向新东京项目
9. **Vercel 部署**：`vercel --prod`，Function Region 改为 `hnd1`（东京）

### 关键技术点
- **`postgres_fdw` 跨库迁移**：比逐批 JSON 导出高效得多，一条 SQL 搞定
- **FK 约束处理**：先 DROP `projects_user_id_fkey`（新项目 auth.users 为空），数据导入后加回 `NOT VALID`
- **auth user 原样复制**：保留 `encrypted_password` 哈希 + 原 UUID，用户用原密码直接登录，数据 user_id 无需映射
- **Storage 临时策略**：迁移期间 `CREATE POLICY "Temp anon upload"` 允许匿名上传，完成后 DROP

### 结果
- ✅ 数据完整：所有表行数一致
- ✅ Storage 完整：2374/2374 文件
- ✅ 用户可用原密码登录
- ✅ Vercel + Supabase 同在东京，API 延迟大幅降低
- ⏳ 旧悉尼项目 `usirwprbadrxmeuubitt` 待确认后删除

---

## 2026-02-26 视频生成升级 Kling v3-omni + 项目页重设计

### 视频生成：PiAPI → Kling v3-omni 直连

**背景**：Kling 官方 API 已支持 v3-omni 模型，比 PiAPI 便宜 33%。

**API 验证过程**：
- 测试 `kling-v3` → 不支持（`model is not supported`）
- 测试 `kling-v3-omni` → ✅ 成功
- 测试 resolution 参数：720p ✅、1080p ✅（独立于 mode）
- 测试 mode 参数：std ✅、pro ✅（$0.112/s vs $0.14/s）
- 测试 duration：3-15s 任意值 ✅，不传 = 智能模式 ✅（`auto`/`intelligence` 不行）
- 测试 image 上限：≤6 ✅，7 = 上限，≥8 ❌（`max number is 7`）
- 测试 sound 参数：`sound: 'on'` ✅

**改动**：
1. `kling.ts`：model_name `kling-video-o1` → `kling-v3-omni`，mode 默认 `std`，加 `sound: 'on'`，duration 可选（undefined = 智能）
2. `animate/route.ts`：默认走 Kling 直连，`ANIMATE_PROVIDER=piapi` 切回 PiAPI（自动转换 `<<<image_N>>>` → `@image_N`）
3. `AnimateSheet.tsx`：时长选项 3s/5s/7s/10s/15s/智能，价格 $0.112/s
4. `Editor.tsx`：AnimationState.duration 改为 `number | null`，图片上限 4→7
5. 图片引用格式全部改为 `<<<image_N>>>`（animate.md、agent.md、agent.ts、Editor.tsx、prompt/route.ts）

**踩坑**：
- `<<<image_N>>>` 格式改了 animate.md 但 AI 仍输出 `@image_N` — 根因是 prompt 在 Editor.tsx `generateAnimationPrompt` 里构建，不走 animate.md
- Agent tool description（agent.ts）也写了 `@image_N`，需要同步改
- 「重新生成视频」时 AnimateSheet 关闭 — 因为 done→idle 时 showAnimateSheet=false 且 isViewingVideo=false，加了 done→idle 时 setShowAnimateSheet(true)
- 「重新生成视频」仍用旧 4 张图 — AnimateSheet idle effect 里从最新 snapshots 重新构建 imageUrls

### 项目页头部重设计

- Hero 区域用 `paddingTop: 20vh` 替代固定 `45dvh`，更多呼吸感
- 输入框：subtler border（白色 10% → focus 时 fuchsia glow），photo slot 用 ResizeObserver 动态正方形
- Create 按钮合进输入框右下角（无框纯文字），有内容提交/无内容开相册
- Textarea：0.85rem → 0.95rem，显式 Geist Sans 字体
- Placeholder："Got a pic? Let's glow it up.\nNo pic? I'll cook one up."

### Vercel Preview 环境变量

- 所有 13 个 env var 批量加到 Preview scope
- Preview 部署现可正常登录，不再需要固定测试域名

### 视频 Aspect Ratio 自动检测（2026-02-26 追加）

**问题**：横屏图片（4:3）生成的视频全变竖屏（9:16），因为 `aspect_ratio` 硬编码 `'9:16'`。

**方案探索**：
1. 不传 `aspect_ratio` → ❌ API 报错 `"Aspect ratio must be specified when no first image"`
2. 前端检测图片比例映射到 16:9/9:16/1:1 → 有效但 API 只支持 3 种比例，4:3 无法精确匹配
3. `image_list` 第一张设 `type: "first_frame"` → ✅ API 从图片自动检测实际比例

**验证**：韩式烤肉项目（4:3 横图），first_frame 方式生成视频 → 输出 **1108x828**（≈4:3），比例正确。

**改动**：`kling.ts` 第一张图加 `type: 'first_frame'`，不传 `aspect_ratio`。轮询间隔 8s → 4s。

---

## 2026-02-27 模型切换 gemini-3.1-flash-image-preview + niji prompt

### 模型切换：gemini-3-pro → gemini-3.1-flash-image-preview

**背景**：Google 发布 Gemini 3.1 Flash Image Preview（代号 Nano Banana 2），定位高效图片生成/编辑，速度快、适合高并发。

**改动**：
- `gemini.ts`：`MODEL` 从硬编码改为 `process.env.IMAGE_MODEL || 'gemini-3-pro-image-preview'`
- `.env.local` + Vercel Production/Preview：`IMAGE_MODEL=gemini-3.1-flash-image-preview`
- Tips 和生图共用同一模型（`OPENROUTER_MODEL = google/${MODEL}`）
- `Editor.tsx`：status bar 文字 "nano banana pro" → "nano banana 2"

**Tips 速度实测**：
- 本地（timing log）：首 tip TTFT ~3.4s，全部 8 条完成 ~10s（之前 pro 首 tip 20+s）
- 线上（浏览器实测）：上传新图后 ~5s 内 8 条 tips 全部出齐
- **速度提升约 4x**，用户确认质量满意

**gemini-3.1-flash-image-preview 新能力**（尚未接入）：
- 输出分辨率控制：512px / 1K / 2K / 4K（缩略图可用 512px 加速）
- 超宽比例：1:4, 4:1, 1:8, 8:1
- Thinking 级别：minimal / high（预览用 minimal 加速，正式用 high 提质）
- 图片搜索 Grounding：Google 图片搜索作为视觉参考
- 参考图上限提升：最多 10 物品 + 4 人物（pro 是 6+5）

**踩坑**：Vercel 环境变量用 `echo "value" |` 设置会在值末尾加 `\n` 换行符，导致 `AI_PROVIDER="openrouter\n"` 不匹配条件，tips 请求走错路径。修复：统一用 `printf 'value' |`。

### niji.md 二次元画风 prompt（Phase 1）

新建 `src/lib/prompts/niji.md`，定义二次元画风转换类别：
- 6 种画风方向：萌系 Moe / 透明感 Transparency / 鲜艳动感 Vibrant / 复古90年代 Retro / 地雷系 Jirai-kei / 半写实 PBR
- 三问自检：画风匹配、构图保留、辨识度
- 5 句固定句子：构图锚定、人脸映射、画风一致性、禁止混搭、收尾

**文生图 Batch Test（test-results/v62/）**：3 组场景 × 2 种画风 = 6 张，全部生成成功。E-地雷系的 "bandages, tears, gothic lolita" 被 Gemini 安全策略拦截，需柔化措辞。

**Phase 2（未做）**：接入产品（gemini.ts、types、TipsBar、batch-test）。

---

## 图片传输 URL 优先 + 桌面端 hold 对比修复（2026-02-27）

### 图片传输 URL 优先

**问题**：所有 AI API 调用都传 base64 data URL（~1-2MB/张），即使 Supabase Storage 上传完成后 snapshot 已有公开 URL。Agent 聊天还额外做 `ensureBase64`（fetch→blob→FileReader）+ `compressBase64`（canvas 重绘），造成客户端卡顿。

**改动**：
- `src/lib/gemini.ts`：新增 `toImageContent(image)` 统一构建 OpenRouter 图片内容（HTTP URL 直传，base64 fallback），替换 ~10 处手动 data URL 构建；新增 `ensureBase64Server(image)` 服务端 fetch URL 转 base64（Google SDK `inlineData` 需要）
- `src/components/Editor.tsx`：新增 `getImageForApi(snapshot)` 返回 `imageUrl || image`；移除 `ensureBase64`（不再需要）；`compressBase64` 保留仅在 agent 聊天且无 URL 时兜底 Vercel 4.5MB 限制
- 替换 7 个调用点：`generatePreviewForTip`、`fetchTipsForSnapshot`、`fetchMoreTipsForCategory`、`handleAgentRequest`（current + original）、`handleRetryPreview`、tip commit reaction

**效果**：
| 场景 | 改前 | 改后 |
|------|------|------|
| Tips（有 URL） | ensureBase64 + 2MB 上传 | URL ~100 bytes |
| Preview（有 URL） | ensureBase64 + 2MB 上传 | URL ~100 bytes |
| Agent 对话（有 URL） | ensureBase64 + compressBase64 + 1.8MB | URL ~200 bytes，零客户端处理 |
| 首次上传（无 URL） | base64 直传 | base64 直传（不变） |

**测试**：本地 dev server + Vercel preview 验证：
- Case 1：新上传（无 URL）→ 8 条 tips 全部出齐 ✅
- Case 2：已有项目重进 → tips 从 DB 正常加载 ✅
- Case 3：Agent 聊天（有 URL）→ "加个墨镜" 成功生图 ✅

### 桌面端 hold 对比松开取消 tip 选中

**问题**：桌面端 canvas 鼠标 hold 做 before/after 对比，松开后 tip 被取消选中。移动端无此问题。

**根因**：`ImageCanvas.tsx` 的 `handleMouseUp` 在 `isComparing` 结束时没设 `skipClick.current = true`，浏览器紧接着触发的 click 事件走到 `handleClick` → `onDismissDraft()` → 取消 tip 选中。移动端 touch 事件流不触发 click，所以无此问题。

**修复**：`handleMouseUp` 中 comparing 结束时加 `skipClick.current = true`，阻止后续 click 触发 dismiss。一行改动。

### Tips Preview 按分类加载 + Commit 后速度优化（2026-02-27）

**改动 1：按分类自动 Preview**

旧方案 `'selective'`（commit 后固定生成 1 enhance + 1 wild preview）→ 新方案 `autoPreviewCategory`：commit 时记住 tip 的分类，只自动 preview 该分类的 tips。用户点击其他分类 tab 时补充生成。

- `fetchTipsForSnapshot` 新增 `autoPreviewCategory?: string` 参数
- `TipsBar` 新增 `onCategorySelect` prop，tab 点击时调用 `generatePreviewsForCategory`
- `generatePreviewsForCategory`：找到该分类下 `previewStatus === 'none'` 的 tips，批量触发 preview
- TipsBar auto-scroll：tip 的 `previewStatus` 变为 `generating` 或 `done` 时自动滚动到该 tip

**改动 2：Commit 后 Tips 请求图片压缩**

**问题**：commit 后 tips 延迟远超首次上传。

**根因**：`tip.previewImage` 是 Gemini 生图原始输出 ~2-3MB base64。4 个 `/api/tips` + 1 个 `/api/agent` = 5 个并发请求各带 2-3MB，总上传 ~12-15MB。首次上传用客户端压缩后的 base64（~300-500KB），4 个请求共 ~1.5MB。

**关键认知**：Tips 分析（`/api/tips`）只看图写文字建议，不生图，600KB JPEG 完全够。Preview 生图（`/api/preview`）需要高清原图，否则人脸变形。两条路径的图片质量需求完全不同。

**修复**：commit 时 tips 请求的图片用 `compressBase64(committedImage, 600_000)` 压缩到 600KB。Preview 生图路径不动（仍用 `getImageForApi(snap)` 取原始 URL/base64）。

| 场景 | 改前 | 改后 |
|------|------|------|
| 首次上传 tips | ~300KB × 4 = ~1.2MB | 不变 |
| Commit 后 tips | ~2.5MB × 4 = ~10MB | ~600KB × 4 = ~2.4MB |

**改动 3：Error 状态 Tip 点击修复**

`handleTipInteraction` 原来只对 `previewStatus === 'none'` 触发生成。Error 状态的 tip 点击文字区域会静默失败（只有 emoji 区域的 `TipThumbnail` retry handler 有 `e.stopPropagation()` + `onRetryPreview`）。修复：生成触发条件加了 `|| tip.previewStatus === 'error'`。

**尝试后放弃：Commit 不跳转方案**

尝试了 commit 后停留在 draft 状态，后台加载新 snapshot 的 tips/preview，就绪后通知用户。实现了 `pendingNewSnapIndex`、`pendingNewSnapReady`、AgentStatusBar "See" 按钮、auto-jump vs notification 双路径。

**放弃原因**：增加了用户认知负担，多个 status 竞争覆盖（agent reaction 在 200ms 后启动会吞掉 commit status），实际体验不如直接跳转 + 快速加载 tips。**核心洞察：应该让新 snapshot 的 tips/preview 更快出来，而不是在旧 snapshot 里给用户找事做。**

---

## 模型对比测试（2026-02-28，v66-v69）

### 背景
从 `gemini-3-pro-image-preview` 切换到 `gemini-3.1-flash-image-preview` 后，需要量化比较两个模型在 creative/wild 场景下的创意质量、生图质量和速度。Flash 还支持 reasoning effort（minimal/high），需要验证 thinking 对生图的影响。

### 测试工具
新建 `scripts/batch-test-compare.mjs`，支持多模型对比：
- 三个模型：Pro、Flash Minimal（reasoning: minimal）、Flash High（reasoning: high）
- 两种模式：独立 tips（各模型各自出创意 + 各自生图）、共享 tips（一个模型出创意，同 editPrompt 给三个模型生图）
- OpenRouter API，串行执行避免限流
- HTML 报告：一行一张原图 + tip 信息，右边三列并排显示编辑结果，各自评分

### v66 — 独立 tips，并发执行
- **图片**：IMG_2987.HEIC, 48DA025C, IMG_7102.JPG
- **问题**：三模型并发请求 OpenRouter 导致大量 `fetch failed`
- **评分**：Pro 6.4 (12张) | Flash 4.6 (7张) | Flash High 4.3 (9张)
- **结论**：并发导致质量和成功率都差，之后改为串行

### v67 — 独立 tips，串行执行
- **图片**：48DA025C, IMG_1908.JPG, IMG_7141.HEIC
- **评分**：Pro **7.3** (11张) | Flash 5.3 (12张) | Flash High 6.8 (11张)
- **结论**：串行后质量大幅回升。Pro 创意最好，Flash Min 创意最差

### v68 — Flash High 出 tips → 同 prompt 三模型生图
- **图片**：IMG_4458.HEIC, IMG_3898.HEIC, 043D99A4
- **评分**：Pro **7.3** (12张) | Flash 7.2 (11张) | Flash High 6.7 (10张)
- **关键发现**：同一 prompt 下 Pro 7.3 ≈ Flash 7.2，生图质量几乎无差别。Flash High 反而更差（6.7），thinking 对生图无帮助

### v69 — Pro 出 tips → 同 prompt 三模型生图
- **图片**：同 v68（IMG_4458, IMG_3898, 043D99A4）
- **评分**：Pro 6.3 (12张) | Flash 6.2 (11张) | Flash High **6.6** (11张)
- **均分低于 v68**：说明这组图 Pro 出的 tips 不如 Flash High 出的（6.4 vs 7.1），但也可能是图片/随机性

### 速度详细数据

**Tips 生成（独立模式，v66+v67 逐张数据）：**

| 图片 | Pro | Flash Min | Flash High |
|------|-----|-----------|------------|
| IMG_2987 | 26.5s | 10.7s (fail) | 24.2s |
| 48DA025C (v66) | 29.3s | 10.0s | 25.2s |
| IMG_7102 | 117.2s | 9.6s | 30.5s |
| 48DA025C (v67) | 38.8s | 6.9s | 15.0s |
| IMG_1908 | 31.4s | 8.0s | 17.4s |
| IMG_7141 | 23.3s | 9.6s | 17.8s |
| **中位数** | **29.3s** | **9.6s** | **20.0s** |

**生图速度（串行数据）：**

| | Pro | Flash Min | Flash High |
|---|---|---|---|
| v67 avg | 24.7s | **19.4s** | 47.5s |
| v69 avg | 26.5s | **18.8s** | 50.9s |
| 中位 | ~26s | **~19s** | ~49s |

### 核心结论

1. **Tips 创意质量 >> 生图模型选择**：同图同 prompt，三模型生图质量几乎一样（Pro 7.3 ≈ Flash 7.2）。Tips 好坏才是决定分数的关键
2. **Flash Min 独立出 tips 最差**（5.3），thinking 太弱，创意质量不行
3. **Flash High thinking 对生图无帮助**：生图反而更慢（2.6x）更不稳定，质量不提升
4. **并发请求 OpenRouter 导致质量下降**：v66 → v67 串行后所有模型均分提升
5. **Pro 偶尔超时**（117s 离群值），Flash High 更稳定（15-31s）
6. **最优方案**：Tips 用 Pro（创意 7.3）或 Flash High（创意 6.8，速度更快）；生图用 Flash Minimal（19s，质量持平，速度最快）

### v70 — Tips Battle: Pro vs Flash High（余额不足，部分数据）
- **图片**：IMG_4999.jpg, IMG_4382.JPG, IMG_5073.HEIC
- **模式**：各模型独立出 tips，统一 Flash Min 生图
- **问题**：OpenRouter 余额 402 错误，第 2 张 Flash High 和第 3 张全部失败
- **有限数据**：Pro tips avg 25.5s, Flash High tips 91.9s（单次异常值）

### v71 — Tips Battle: Pro vs Flash High（重跑，充值后）
- **图片**：IMG_1908.JPG（双失败）, 14E9B12B, IMG_4999.jpg
- **模式**：各模型独立出 tips，统一 Flash Min 生图
- **评分**：Pro Tips **8.0** (7张) | Flash High Tips **8.0** (8张)
- **Tips 速度**：Pro 14.8s/28.0s | Flash High 27.0s/28.7s
- **生图速度**（Flash Min）：Pro tips 22.6s avg | Flash High tips 21.6s avg
- **关键发现**：两个模型创意质量完全持平（全 8 分），Pro tips 速度在这轮反而更快

### 全部测试最终结论（v66-v71）

| | Tips 创意质量 | Tips 速度 | 生图质量 | 生图速度 |
|---|---|---|---|---|
| Pro | 7.3-8.0 | 15-28s（偶尔 117s） | ≈ Flash | 26s |
| Flash High | 6.8-8.0 | 17-92s（不稳定） | ≈ Flash | 50s |
| Flash Min | 5.3 | 8s | 基准 | 19s |

1. **生图模型确认 Flash Min**：速度最快（19s），质量与 Pro 持平
2. **Pro 和 Flash High 创意质量持平**（v71 都 8.0），但 Pro 速度更稳定
3. **Flash High thinking 对生图无帮助**：反而更慢（50s vs 19s），质量不提升
4. **Tips 创意是 Flash Min 唯一短板**（5.3 分），切 Pro 或 Flash High 出 tips 可提升到 8.0
5. **并发请求 OpenRouter 会降低质量和成功率**，串行更稳

---

## 画笔标注工具栏：参考图附件（2026-03-01）

### 需求
用户在画笔标注时能附带一张参考图，实现类似"把这个男生加到红框位置"的操作。

### 实现

**新建 `src/lib/imageUtils.ts`**：从 AgentChatView 提取共享图片压缩函数 `compressImageFile(file, maxSize=1024, quality=0.85)`，AgentChatView 和 AnnotationToolbar 复用同一份代码。

**AnnotationToolbar 改动**：
- 新增 `attachedImage` state + `imageInputRef`
- 📷 按钮在工具行：框 icon 右边、slider 左边，样式与 brush/rect 一致（w-8 h-8 rounded-lg）
- 有附件时 📷 高亮（fuchsia 背景），输入行下方显示缩略图 + × 删除（复用 CUI 的 w-9 h-9 rounded-lg 样式）
- `onSend` 签名改为 `(text: string, refImage?: string)`，发送后清空附件

**Editor.tsx 改动**：
- `sendWithAnnotations(text, referenceImages?)` 新增可选参数，透传到 `handleAgentRequest(text, referenceImages, compressed)`
- AnnotationToolbar onSend wiring: `(text, refImg) => sendWithAnnotations(text, refImg ? [refImg] : undefined)`

**数据流**：AnnotationToolbar.onSend → sendWithAnnotations → mergeAnnotation + compressBase64 → handleAgentRequest(text, [refImage], annotatedImage) → streamAgent → agent generate_image multi-image mode

### 测试验证
- 📷 按钮位置正确，点击触发文件选择
- 上传后缩略图 + × 显示，📷 高亮
- × 删除后恢复默认状态
- `npm run build` 通过

---

## 视频功能端到端测试（2026-03-01）

### 测试环境
- 本地 dev server (`localhost:3000`)
- 测试账号：`test-claude@makaron.app`
- 项目："甜品梦境世界"

### 端到端流程测试

**单 snapshot 流程**（成功）：
1. ▶ / 生成视频 → VideoResultCard（显示已有视频）→ 生成新视频 → AnimateSheet
2. 选 3 秒 / 10 秒时长，费用实时更新（$0.34 / $1.12）
3. ✨ AI 生成 → Agent 流式写脚本（textarea 实时更新 + CUI 同步显示）→ "脚本已就绪"
4. 🎬 生成视频 → 提交成功 → AnimateSheet 自动关闭 → StatusBar "视频渲染中..."
5. 后台轮询 4s 间隔 → Kling API 返回 processing → 最终 completed

**多 snapshot 流程**（创建卡片 UI 验证通过）：
- 4 个 snapshot 显示为 @1 @2 @3 @4 缩略图
- 删除 @2 → 剩余自动重编号为 @1 @2 @3
- 时长切换 + 费用更新正常

### 发现并修复的问题

**1. AI 脚本生成偶发失败（已定位根因）**

错误信息（3 次尝试，2 种错误）：
- `Cannot connect to API: other side closed` ×2 — Bedrock 连接断开
- `Failed to download ...snapshot-...jpg: TypeError: fetch failed` ×1 — AI SDK 下载 Supabase URL 失败

排查过程：
- 独立 Node.js 测试并发 fetch 4 个 Supabase URL → 全部 200 OK（5.6s）
- 确认非 Supabase 系统性问题，是 **Bedrock 连接不稳定 + 偶发网络波动**
- 同一时段浏览器也有大量 `ERR_SSL_BAD_RECORD_MAC_ALERT`
- 重试后（同样代码、同样 `new URL()` 方式）脚本生成成功

结论：偶发问题，非代码 bug。AI SDK 已内置 3 次重试。

**2. VideoResultCard 缺少渲染计时器**（已修复）
- 新增 `ElapsedTimer` 组件，每秒更新显示 M:SS

**3. Lint 全面修复**（已修复）
- 6 errors + 43 warnings → 0
- `useSyncExternalStore`、render-time state adjustment、hooks deps 补全、未使用变量清理

### 部署
- Preview: `https://ai-image-editor-8ppv26dvj-vegekyd-sys-projects.vercel.app`
- 待线上验证：移动端 UI、多 snapshot 视频生成

---

## 视频卡片重设计（2026-03-01）

### 改动概要
6 项改动，涉及 4 个文件：VideoResultCard.tsx（大改）、AnimateSheet.tsx（中改）、Editor.tsx（中改）、ImageCanvas.tsx（小改）

### 1. VideoResultCard 紧凑化
- **移动端**：从 `maxHeight: 45dvh` 高卡片改为紧凑横向滚动条（≈160-180px，匹配 TipsBar 高度）
  - 顶部行：`"视频 (N)"` + `×` 关闭 + `"+ 新视频"` 按钮
  - 横向滚动：每个视频 120px 宽卡片（120×120 缩略图 + 状态 + 时长 badge + 相对时间）
  - Processing 卡片有"放弃"小按钮
- **桌面端**：保持 340px 右侧全高面板不变
- **新增 `onViewDetail` prop**：点击视频卡片打开 AnimateSheet detail 模式

### 2. AnimateSheet detail 模式
- 新 props：`mode?: 'create' | 'detail'`、`detailAnimation?: ProjectAnimation`
- Detail 模式：标题"视频详情"、只读缩略图（无删除按钮）、只读脚本、静态时长+状态显示、无底部按钮

### 3. 智能底部按钮（create 模式）
- 空 prompt → `"✨ 生成脚本"`（触发 AI 写脚本）
- 有 prompt → `"🎬 生成视频"`（提交生成）
- 正在生成脚本 → `"✨ AI 正在写脚本..."`（disabled）
- 正在提交 → `"提交中..."`（disabled）
- AI 重写按钮仅在已有 prompt 时显示（空 prompt 时用底部按钮代替）

### 4. 视频提交后立即显示 VideoResultCard
- `submitting → polling` 时：`setShowVideoResult(true)` + `setSelectedVideoId(taskId)`
- `showVideoResult` 渲染去掉 `isViewingVideo` 限制
- `isViewingVideo` effect 改为仅在从 video entry 导航离开时关闭

### 5. ImageCanvas __VIDEO__ fallback
- 当 `baseImage === '__VIDEO__'` 且无 `videoUrl` 时，fallback 显示最后一个真实 snapshot

### 6. 信息增强
- 每个视频卡片显示：状态（已完成/渲染中 M:SS/失败）、时长 badge（`3s`）、相对时间（`3分钟前`/`1小时前`）

### 部署
- Production: `https://www.makaron.app`（commit `a01beb8`）

---

## 视频卡片 v2 迭代（2026-03-01）

### 问题与修复

**VideoResultCard pill 化（完全重写为 TipsBar 风格）**
- 每个视频 pill 完全匹配 TipsBar 卡片：`w-[200px]` / `w-[176px]`，`h-[72px]` / `h-[64px]`，`rounded-2xl`
- 结构：缩略图（72/64px 正方形）+ 文字区（标题 + 状态）+ `>` 详情按钮
- 标题从脚本第一行提取（最多 14 字，不足时 fallback `"视频 N"`）
- 时长 badge 在缩略图右下角（终于加进来）
- 状态行：已完成/渲染中 M:SS/失败/已放弃
- `>` 详情按钮镜像 TipsBar commit button 样式
- `+ 新视频` 镜像 TipsBar `更多` 按钮（虚线圆角矩形）

**选中状态修复**
- 外层 `<div>` 持有 `border-fuchsia-500 ring-1 ring-fuchsia-500/50`，整个 pill（包括 `>` 按钮）同时高亮
- 原来只有左侧 `<button>` 有 ring，`>` 按钮不高亮

**视频结果与 TipsBar 等高**
- 问题：TipsBar 有分类栏（`py-2` + 11px 字 ≈ 32px），VideoResultCard 没有，导致高度不一致
- 修复：底部加 `视频 · N 个` 行，`py-2 text-[11px]`，高度对齐

**`+ 新视频` 按钮加宽**
- 从小方块（`w-[52px]`）改为横向宽按钮（`flex-row px-4 minWidth:90px`）

**桌面端统一到底部（不再是右侧面板）**
- VideoResultCard 去掉右侧 340px 面板模式，桌面端和移动端都是底部横向 pill 条
- 在 Editor 底部 bar 中替换 TipsBar（`isViewingVideo ? <VideoResultCard> : <TipsBar>`）

**无 × 关闭按钮**
- 视频入口时 VideoResultCard 永远显示，不需要关闭
- `showVideoResult` state 废弃，改为直接用 `isViewingVideo`

**AnimateSheet 在 VideoResultCard 之上**
- z-index: 202 > VideoResultCard z-30，详情/创建页覆盖在 pill 条上方

**提交后自动导航到视频入口**
- `submitting → polling` 时设 `pendingNavigateToVideoRef.current = true`
- 下一个 render（timeline 更新后）effect 执行 `setViewIndex(videoTimelineIndex)`

### 最终 commits
- `a01beb8` 初始重设计
- `6af03df` pill 化 + 无关闭 + z-index
- `9efa832` 完全匹配 TipsBar 设计 + 桌面统一
- `076f8de` 选中高亮整个 pill
- `959682e` 高度对齐 + 新视频按钮加宽

---

## 视角旋转 Camera Rotate（2026-03-04）

### 背景
用户希望实现 Qwen Image Editing 的视角旋转功能，类似参考项目 `camilocbarrera/-Qwen-Image-Edit-2511-Multiple-Angles-Playground`（Next.js + React Three Fiber + fal.ai）。UI 为 3D 虚拟相机控制面板，用户调整方位角/仰角/距离后 Generate 新视角图片。

### 调研结论
- **Qwen-Image-Layered**（图片分层模型）：20B 参数，无托管 API，阿里云 DashScope 也没上架，暂不可用
- **Qwen Image Editing**（阿里云 DashScope）：有 API 但没有视角旋转功能，只有 colorization/super_resolution/expand/stylization
- **fal.ai 托管 LoRA**：`fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA`，通过 HuggingFace Inference SDK 调用，无需单独 fal.ai 账号
- **HuggingFace Inference Providers**：1 个 HF_TOKEN 即可，fal.ai 是推理后端之一，计费走 HF 账户。需预充值 credits

### 实现
**新文件**：
1. `src/lib/camera-utils.ts` — Azimuth（8 方向 0-360°）+ Elevation（4 级 -30~60°）+ Distance（3 级 0.6~1.4）= 96 组合。`buildCameraPrompt()` → `"<sks> front view eye-level shot medium shot"`
2. `src/components/CameraControl3D.tsx` — React Three Fiber 3D 场景：gridHelper 地面 + planeGeometry 图片纹理 + box+cylinder 相机模型 + 3 个球形把手（绿=azimuth，粉=elevation，橙=distance）。拖拽用 window pointermove/pointerup。`dynamic` SSR-off 加载
3. `src/components/CameraPanel.tsx` — 浮动面板（复用 AnnotationToolbar 的 #1a1a1a 样式 + 桌面端拖拽逻辑）：3D 预览 200px + 3 组 slider + 8 方向按钮 + prompt 预览 + Cancel/Generate
4. `src/app/api/rotate/route.ts` — 接收 image（URL 或 base64）+ prompt，转 Blob，调 `InferenceClient.imageToImage({ provider: 'fal-ai' })`，返回 base64。`maxDuration=300`

**修改**：
5. `Editor.tsx` — 画笔旁加相机图标按钮（互斥：开相机关画笔，反之亦然）。`showCameraPanel` + `isRotating` state。`handleCameraGenerate` 回调：调 API → commit 新 snapshot → 拉 tips

**新依赖**：`three` + `@react-three/fiber` + `@react-three/drei` + `@types/three` + `@huggingface/inference`

### 踩坑记录
1. **R3F `<line>` 与 SVG 冲突**：JSX `<line>` 解析为 SVG line 而非 Three.js Line。改用 `<primitive object={new THREE.Line(...)} />`
2. **`<cylinderGeometry rotation>` 不存在**：rotation 属性属于 `<mesh>` 不属于 geometry
3. **R3F event 类型**：Handle 的 `onPointerDown` 回调类型是 R3F 内部类型，不是 DOM Event。用 `any` + `e.nativeEvent` 取 clientX/clientY
4. **Vercel TypeScript 严格模式**：`Buffer` 不直接赋值给 `BlobPart`（SharedArrayBuffer 类型不兼容）。改用 `new Uint8Array() as BlobPart`
5. **变量名冲突**：`const arrayBuf` 在输入处理和结果处理各声明一次，Turbopack 报错。重命名为 `imgBytes` / `resultBuf`
6. **前端传 URL 而非 base64**：`getImageForApi()` 优先返回 Supabase URL，API route 原来只处理 base64。加了 `if (image.startsWith('http'))` fetch 转 buffer

### 测试结果
| 环境 | 状态 | 速度 |
|------|------|------|
| CLI 直测（node 脚本） | ✅ 出图正确，视角变化明显 | ~148s（冷启动） |
| localhost E2E（Playwright） | ✅ 全流程通过 | ~25s |
| Vercel preview E2E（Playwright） | ✅ 全流程通过 | ~15s |
| 用户手动测试 | ⚠️ 报告 Generate 按钮无反应，排查中 |

### 待解决
- 用户手动点击 Generate 按钮无反应（已加 console.log 排查，待用户反馈）
- 速度不稳定（15s~148s），取决于 fal.ai instance 是否 warm
- 未做 i18n（按钮文字仍为英文 Cancel/Generate）
- HF_TOKEN 仅配了 preview，production 需要时再加

---

## 项目列表页性能优化（2026-03-08）

### 背景
Chrome DevTools Performance Trace 发现项目列表页加载 31.2MB Supabase 图片数据（每张封面 ~1.7MB），导致首屏慢、滚动卡顿。

### 优化方案：Supabase Image Transformations
- 使用 `/render/image/` 路径替换 `/object/`，加 `width=400&height=400&resize=cover&quality=50`
- Supabase 服务端生成 400x400 正方形 WebP 缩略图
- `getThumbnailUrl()` 函数（`src/lib/supabase/storage.ts`）封装 URL 转换
- 首屏 4 张卡片加 `fetchPriority="high"`

### 前提条件
- Supabase Pro 计划
- Dashboard → Storage → Settings → 开启 Image Transformations（否则 `height`/`resize` 参数返回 403）

### 性能对比
| 指标 | 优化前 | 优化后 | 变化 |
|------|--------|--------|------|
| Supabase 传输总量 | 31.2 MB | 2 MB | -94% |
| 单张缩略图大小 | ~1.7 MB | ~16 KB | -99% |
| LCP | 1,553 ms | 1,091 ms | -30% |
| LCP 图片下载 | 76 ms | 6 ms | -92% |
| CLS | 0.01 | 0.00 | 完美 |
| 图片格式 | PNG/JPEG | WebP（自动） | 自动优化 |
| CDN 缓存 | 无 | Cloudflare HIT | 二次访问秒开 |

### 踩坑记录
1. `?width=400&quality=75` 直接加在 `/object/` URL 上无效，Supabase 忽略参数返回原图
2. `loading="lazy"` 导致滚动时才开始加载，用户体验反而变差，已去掉
3. Image Transformations 即使是 Pro 也需要在 Dashboard 手动开启
4. `resize=cover` 默认行为是居中裁切，完美匹配 1:1 卡片的 `object-fit: cover`
