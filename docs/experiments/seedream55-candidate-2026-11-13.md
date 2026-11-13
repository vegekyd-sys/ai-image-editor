# Seedream 5.5 / EvoLink 候选实测

2026-11-13 北京时间；候选 `B-20261109-seedream55`；分支 `codex/seedream55-candidate-b20261109`。

**三组主测试共六张真实图片全部成功，并核实相同输入、相同 prompt、1024×1024 PNG 和项目保存结果。本次单样本对比中，Seedream 局部编辑保持更好、费用更低；GPT 更快。完整画面与透明素材各有取舍，不能据此判定全场景胜负。未合入 dev、push、部署或发布 NPM，默认模型保持原值。**

- [交互对比页](../../evidence/seedream55-live-20261113/comparison.html)，支持透明素材浅底 / 深底 / 棋盘格、原始 PNG 和完整 prompt。
- [固定原图与编辑结果](../../evidence/seedream55-live-20261113/qa/local-edit-source-and-pair.png)、[浏览器实拍](../../evidence/seedream55-live-20261113/qa/browser-comparison.png)。
- [冻结测试集](../../evidence/seedream55-live-20261113/manifest.json)、[回执与保存证据](../../evidence/seedream55-live-20261113/summary.json)、[像素指标](../../evidence/seedream55-live-20261113/measurements.json)。

## 实际执行与候选边界

在原 worktree `/Users/tianyicai/.codex/worktrees/a0f3/ai-image-editor` 继续。保留旧候选备份分支 `codex/seedream55-before-resume-20261113`，将 dev 的 `7fadfde6` 同步进入候选以保留现有图片拒绝处理，再将候选供应商切到现有 EvoLink 账号。没有将候选合回 dev。旧报告与旧样本保留为历史结果。

真实链路为本地候选 `makaron chat → generate_image → provider → 项目快照保存 → 重新读取快照和下载图片`，不是适配器脚本直接生成后冒充产品验收。六张成功图片的快照重读结果与本地下载 SHA-256 全部一致；保存的模型/provider、prompt 和输入图也分别核对。两个测试项目均核实 `is_public=false`。本次未做完整登录 GUI 项目重开；浏览器展示的是读取实际成品的评估页。

共享 `token_rates` 尚无候选行，因此本地 Next 进程通过外部 preload 在成功的只读价格查询结果中追加隔离 fixture（markup=2）。**未写共享价格表、共享环境变量或业务默认值。** provider 请求、项目保存、现有扣费调用仍为真实操作。这个边界证明候选本地链路可用，不代表生产已开放。

| 项目 | Seedream | GPT |
| --- | --- | --- |
| Makaron ID | `seedream-5.5` | `gpt-image-2.6-flare` |
| 实际 provider | EvoLink | OpenAI direct |
| 精确 provider model | `doubao-seedream-5.5` | `gpt-image-2.6-flare` |
| 共同输出 | PNG、1K 档、1:1；实际 1024×1024 | 同左 |
| 模型独有控制 | `prompt_priority=standard` | quality=low、reasoning/complexity=high |
| 回退与重试 | 一次付费 POST，保存 task 后只查询原任务 | 本组每项一次 POST；无 provider/model 恢复 |

三组 mascot prompt 与原冻结测试集一致；前两组两模型收到同一品牌参考图。局部编辑都收到旧冻结原图，SHA-256 为 `bbd9051dad42a91ab512b9b1ade7b2582e69545331fa02a0cbe6415fe44bb9fa`，不是分别编辑自己的生成图。已将每次实际上传图重新下载核对字节；六次保存 prompt 均与 manifest 逐字相同。

## 实图结论

完整画面：GPT 的深色产品卡更突出，光带与门的连接更饱满，整体偏高饱和宣传插画。Seedream 更柔和，巫师与光带偏玻璃材质、留白较多。两者都实现身体与 Spark 互动、角色及帽子完整入画。只在本组图上判断风格，不给出通用质量排名。

透明素材：两个输出都是可解码的原始 RGBA PNG，透明空白真实存在，无去背景工具。Seedream alpha 0–255，77.35% 像素完全透明；GPT alpha 0–254，56.27% 完全透明。Seedream 留白充分、角色较小，GPT 角色更大更浓，偏离“sidekick”尺度更多。两者深浅底边缘均已查看，存在发光外沿；不能把半透明像素多直接当作透明材质更好：GPT 大量像素 alpha 为 252/253，接近不透明，Seedream 主体大多 alpha=255。玻璃外观与材质 alpha 应分别评价。

固定原图局部编辑：两个模型都把帽子改成橙色。本例 Seedream 的未编辑区保持更好：

| 排除固定帽子矩形后的指标 | Seedream | GPT |
| --- | ---: | ---: |
| 平均绝对 RGB 误差（0–255） | 0.701 | 3.251 |
| RMSE | 1.753 | 6.291 |
| 三通道完全一致的像素 | 40.18% | 0.49% |
| 最大通道差 ≤8 的像素 | 99.91% | 87.62% |
| 最大通道差 >16 的像素 | 0.035% | 3.741% |

区域为 `[710,290,989,477)`，其外 996,403 像素。没有对齐、重采样或颜色归一化；矩形不是精确帽子分割，指标只支持这张图的局部编辑判断。两者均未达到像素完全不变。

## 时间与费用

| 测试 | Seedream 供应商 / run | GPT 供应商 / run | Seedream 标价 | GPT 用量账本 | 产品 credits：Seedream / GPT |
| --- | --- | --- | ---: | ---: | ---: |
| 完整画面 | 27.086s / 52s | 10.299s / 29s | $0.0224 | $0.038303 | 6 / 9 |
| 原生透明 | 23.274s / 43s | 12.885s / 31s | $0.0224 | $0.038398 | 6 / 9 |
| 固定原图编辑 | 22.617s / 48s | 8.700s / 38s | $0.0224 | $0.033722 | 6 / 8 |

供应商阶段由适配器记录，含提交、轮询和结果读取；run 时长含 Agent 等本地产品处理，不是浏览器可见首帧或用户点击到显示的耗时。调用没有并发压测，样本顺序和缓存状态可能影响结果。

[EvoLink 当前公开价格](https://evolink.ai/seedream-5-5)：1K/1.5K 输出 $0.016，每张输入 $0.0064；本组三张各含一张输入，因此精确标价为 $0.0224/张。三个完成任务均通过原 task ID GET 再核对，回执各记 `credits_used=1.5232`，`usage.cost.usd=0.023`（展示精度三位），供应商 credits 共 4.5696。标价合计 $0.0672，回执展示美元合计 $0.069，不能把展示精度差异伪称额外已确认收费。GPT 三张实际 ledger 合计 $0.110423；两家的资金账单尚未独立对账。

主测试产品扣费 44 credits；补充失败样本 Agent 共 4 credits，合计 48 credits=$0.48。受控路由预检三项消耗推理，根据当前缓存/输入/输出费率估算 $0.017934，执行媒体操作数为 0。加上历史保守累计 $0.275951，当前产品 credits 加预检估算口径约 **$0.773885**，低于 $5 目标 / $10 上限。图片 supplier 成本单列，不重复加到产品 credits。拒绝请求没有产品图片扣费；供应商最终拒绝收费状态尚未凭资金账单确认。

## 保留的失败与未完成项

补充 Pokémon 组的完整画面与原生透明素材均无图片：两个模型各两次，四次请求均逐项停止。EvoLink 两个已接受 task 最终 `failed/content_policy_violation`，明确涉及第三方内容权利；OpenAI 两次 HTTP 400 `moderation_blocked`，moderation stage 为 output、category 为 other。不能把两家错误都归因为同一种策略，也不能从 Agent 的 `completed` 状态推出出图成功。

该组共同源图未能建立，因此后续两项局部编辑未执行，没有替换角色、改 prompt 规避或切模型。总分母为十次已提交图片调用、六张实际成功输出；另两项计划因依赖失败跳过。主 mascot 对比分母为三组、每模型三张，全部成功。原始失败记录继续保留。

## 验证与当前阶段

255 项相关测试（12 文件）、TypeScript、CLI smoke/upload、i18n guard、Skill build/sync 均通过；受控 Skill 路由预检 3/3 通过且媒体操作为 0。针对改动文件 ESLint 无错误，保留 `agent-tools.ts` 上游已有 unused locale 警告。真实浏览器已确认图片加载和透明深底切换。

当前阶段：**候选本地实图验收完成，可评审；生产未开放。** 后续若决定上线，仍需按发布流程处理真实共享候选价格行、发布权限及完整生产/CLI 验收，本次不执行。
