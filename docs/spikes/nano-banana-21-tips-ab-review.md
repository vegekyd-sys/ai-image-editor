# Nano Banana 2 Lite vs 2.1：Tips、成人非露骨编辑与 IP 测试

日期：2026-10-07（北京时间）。分支：`codex/nano-banana-21`。

## 结论

- 2.1 值得作为更重视保脸、保构图的 Creative / Wild 预览候选。此批 Tips 成功 10/10，Lite 8/10；2.1 平均完成时间更长，不能宣称提速。
- 没有发现审核放宽：礼服编辑均通过，泳装样本均被拦截；皮卡丘、路飞均通过，Marvel 雷神均被拦截。供应商返回通用审核原因，不能断定雷神是因版权被拒。
- 1K 成功 Tips 单次成本，2.1 比 Lite 高约 8.8%；计入 Lite 的两次付费但未交付失败后，本批 2.1 每张交付图片的有效成本反而更低。
- 图片生成选 OpenRouter 更划算：本批 2.1 1K Tips 平均 $0.03992，fal 当前公布基础价 $0.08/张。未在 fal 生成，不推导其审核、质量或速度。
- 尚未修改生产 Tips 默认路由；2.1 接入仍在独立 worktree，未合并、未部署。

## 当前路由及实验合同

仓库 `src/lib/gemini.ts` 中预览默认是 `google/gemini-3.1-flash-lite-image`，也就是以前说的 mini。2026-10-07 只读拉取 Vercel Production 环境后确认 `TIPS_PREVIEW_IMAGE_MODEL`、`TIPS_PREVIEW_THINKING` 均未覆盖，因此代码默认 Lite + low reasoning 适用。

`/api/preview` 普通 Creative / Wild 优先 Lite；`isNsfw=true` 或 Enhance 优先 Qwen Spicy；透明背景走单独路由。这里直接测两款 Gemini，避免将应用层兜底算成模型成功，没有调用 Spicy。

- 20 组 × 2 模型 = 40 次付费提交，无应用层自动重试、无模型兜底，并发 4。
- 5 张历史 Tips 测试原图，各取 1 条 Creative 和 1 条 Wild，共 10 组。
- Tips 复用 `ai-image-editor-tips-wan27-ab/test-results/v1/text-v1/results.json` 中 Gemini 作者的第一条提示词；原图与 editPrompt 冻结，不重新生成 Tips 文字。
- 成人非露骨编辑：旧礼服截图、旧白色泳装样本各做换背景和普通站姿，共 4 组，明确保持衣物及覆盖范围。
- IP：皮卡丘、路飞、Marvel 漫画雷神各做文生图、加入同一图书馆照片，共 6 组。
- 全部 1K。Lite 沿用现有 Tips chat/completions 的 system prompt + low reasoning；2.1 调用已接入的原生 Image API request builder。它是产品路径对比，适配器及系统提示词并不相同，不能把所有差异仅归因于底层模型。
- 记录完整响应耗时、request ID、usage.cost、token 明细、HTTP / finish reason、原图与提示词 SHA256；生成图片做完整解码并记录尺寸。
- 成功表示返回可解码图片；视觉编辑是否完成另行检查。每格单次采样，不是长期失败率估计。

## 结果

| 类别 | Lite 出图 | 2.1 出图 | Lite 平均成功耗时 | 2.1 平均成功耗时 | Lite 平均成功费用 | 2.1 平均成功费用 |
|---|---:|---:|---:|---:|---:|---:|
| Creative | 5/5 | 5/5 | 14.33s | 21.93s | $0.03661 | $0.04030 |
| Wild | 3/5 | 5/5 | 14.18s | 17.30s | $0.03679 | $0.03955 |
| 礼服换背景、姿势 | 2/2 | 2/2 | 16.94s | 15.41s | $0.03659 | $0.03807 |
| 泳装换背景、姿势 | 0/2 | 0/2 | — | — | 无返回 usage | 无返回 usage |
| IP 文生图 | 2/3 | 2/3 | 9.13s | 15.57s | $0.03502 | $0.03620 |
| IP 加入照片 | 2/3 | 2/3 | 10.60s | 15.23s | $0.03594 | $0.03803 |
| 总计 | 14/20 | 16/20 | 13.39s | 18.03s | $0.03632 | $0.03899 |

两款在皮卡丘、路飞的两个任务均通过；雷神两个任务均被审核拒绝。Lite 雷神返回 `content_filter`、cost=0；2.1 返回 `PROHIBITED_CONTENT`，没有 usage。不因缺失 usage 推定所有拒绝完全不收费。

Lite 两次 Wild 失败为 `finish_reason=length`，不是审核拒绝：T 恤气球费用 $0.071077，帽子气球费用 $0.0713925，都没有交付图片。usage 各记录 2240 image tokens。本批按当前未指定 max_tokens 的产品请求合同测得，未追加付费修复重试；没有证明换更高 max_tokens 是否解决。

Tips 合计：Lite 8/10、成功均价 $0.03668、平均 14.27s；2.1 10/10、成功均价 $0.03992、平均 19.61s。包含失败费用，Lite 总支出 $0.43589 / 8 张 = $0.05449/交付张；2.1 $0.39922 / 10 张 = $0.03992/交付张，低约 26.7%。这只是此次批次结果。

40 次提交返回的已知费用合计 $1.274809；部分拦截没有 usage，故这是可核对的已报告费用，不能当作完整账户账单。

## 视觉检查

以下是人工查看产物后的观察，未替用户打分。HTML 提供未预填的偏好评分，可在浏览器保存和导出。

- 微型工厂、全息城市：2.1 更贴近原图脸、衣服、手势和桌面；Lite 重画姿势并清空较多环境。2.1 的工厂位置仍未精确落在指尖，细小招牌文字也不能仅凭缩略图判定正确。
- 浣熊侦探：两者可用，2.1 抓书的动作更贴近提示词；Lite 的浣熊更醒目。
- 书籍小人国：Lite 的改造更明显，但重构书架、人物眼神及头部；2.1 更保守，微观效果不够醒目，不能仅因保脸判定全面胜出。
- 微型猴子：两者可用，2.1 原始石柱背景更稳定，Lite 改动背景更多。
- 甜点之手：2.1 更明确地将手指变成甜点；Lite 更像叠在手上的冰淇淋块，两者仍需检查手部细节。
- 卤味评委：Lite 清理后大片背景变黑；2.1 保留摊位结构更多。2.1 的小鼠较小，视觉冲击弱一些。
- 熊猫合照：两者保留主体；2.1 熊猫张嘴更贴近提示词。
- 两个气球 Wild：2.1 交付完整效果，帽子气球存在角度与表情变化；Lite 未交付。
- 礼服换背景：2.1 去除了手机界面，并遵循木栏杆要求；Lite 保留底部社交 UI，栏杆材质也不符。站姿两者均完成，但新增身体细节不应视为身份或体型完全保真。
- 皮卡丘文生图：两者可识别、完整。加入照片时，两款都没有满足“约同人物高度”，生成成较小的皮卡丘。
- 路飞文生图：两者可识别、动画风格可用。加入照片时 Lite 保持漫画式路飞，2.1 转为真人化角色；若目标是动漫 IP 合照，这一例 Lite 更符合产品直觉。

建议将 2.1 作为保脸、复杂编辑的候选，尤其关注 Wild 的交付可靠性；不要据此直接替换所有预览或宣称它更快。敏感图片继续现有 Spicy 路由，本批没有证明 2.1 能替代它。最终偏好可通过 HTML 并排产物评审。

## 当前价格

实时来源：[OpenRouter models API](https://openrouter.ai/api/v1/models)、[Lite 模型页](https://openrouter.ai/google/gemini-3.1-flash-lite-image)、[fal 2.1](https://fal.ai/models/fal-ai/nano-banana-2.1)、[Google pricing](https://ai.google.dev/gemini-api/docs/pricing)。fal 价格同时经认证的只读 `/v1/models/pricing` 核对，原始非敏感价格保存在 artifacts `prices.json`。

| 供应商 / 模型 | 输入 / 百万 token | 文字输出 / 百万 token | 图片输出 / 百万 token | 单张基准 |
|---|---:|---:|---:|---|
| OpenRouter Lite | $0.25 | $1.50 | $30 | 1K 图片输出约 $0.0336，另加输入/文字 |
| OpenRouter 2.1 | $1.50 | $7.50 | $30 | 1K 约 $0.0336；2K $0.0504；4K $0.0756，另加输入/文字 |
| OpenRouter 旧 NB2 | $0.50 | $3.00 | $60 | 1K 图片输出约 $0.0672，另加输入/文字 |
| fal 2.1 / edit | — | — | — | 公布基础 $0.08/张 |

2.1 的 2K / 4K 数字依 Gemini API pricing 的 1680 / 2520 token 估算；4K 官方不同页面曾存在 token 数冲突，未本轮实测，最终以 usage.cost 为准。未验证 fal 高分辨率附加费用，不能宣称所有分辨率固定 $0.08。以上为供应商费用，不含 Makaron Credits 加价或支付/充值费用。

## 复现与产物

- 生成：`node --env-file=.env.local --import tsx docs/spikes/nano-banana-21-tips-ab.cjs`。
- 渲染报告：`node docs/spikes/nano-banana-21-tips-report.cjs`，不调用供应商。
- 本地目录：`test-results/nano-banana-21-tips-ab-v1/`（git ignored）：`report.html`、`results.json`、`summary.json`、`prices.json`、各组 `*-compare.jpg` 与原尺寸产物。
- 生成脚本 checkpoint 每个提交，重复运行会跳过已提交/失败/完成请求，防止不确定结果重复收费。
- 实验只增加脚本及报告，不改变当前生产默认模型。
