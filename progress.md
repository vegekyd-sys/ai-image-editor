# Tips 优化进度追踪

## 项目目标
通过人机协作循环，迭代优化 tips 的 prompt 系统，直到每个测试结果都能让用户打出 8 分以上（"wow"感）。

## 架构概览
- Tips 系统：`TIPS_SYSTEM_PROMPT`（短指令）+ `.md` 模板文件（`enhance.md`, `creative.md`, `wild.md`）
- 生成流程：图片 → Gemini 生成 6 tips（2 enhance + 2 creative + 2 wild）→ 逐 tip 编辑图片
- 测试脚本：`scripts/batch-test.mjs` — 随机选图、生成 tips、编辑、生成交互式报告
- 模型：`gemini-3-pro-image-preview`

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

