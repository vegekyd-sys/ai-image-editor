# Seedance 2.5 Flash 与 Makaron 当前视频模型的费用比较

2026-11-13，独立候选分支 `codex/seedance25-flash`。结论：Flash 是比普通 Seedance 2.5 便宜的原生生成选项；不是 Makaron 最便宜的视频模型。720p 的供应商价格约为当前默认 Kling 4.0 Flash 的 2.55 倍，暂不更换默认。

下表统一 **5 秒、无参考视频**。成本来自当天真实调用 Makaron `quoteVideo`、读取当前共享计费表得到的估算；不是供应商账单。除 Eco 自动超分外均是对应原生输出。积分含现有2倍倍率和向上取整，Agent/素材分析另计。不同模型能力和画质不能仅按价格判定。

| 模型 | 输出档 | 配置成本估算 / 5秒 | Makaron积分 |
| --- | --- | ---: | ---: |
| fal H3 Turbo | 768p | $0.200 | 40 |
| Wan 3.0 Standard | 720p | $0.300 | 60 |
| Kling 4.0 Flash（现默认） | 720p | $0.470 | 94 |
| Seedance 2.5 Flash | 480p | $0.600 | 120 |
| Seedance 2.5 Eco | 480p生成后超分720p | $0.726 | 146 |
| Kling 4.0 | 720p | $0.785 | 157 |
| Seedance 2.5 Flash | 原生720p | $1.200 | 240 |
| Seedance 2.5 Native | 原生720p | $1.625 | 325 |

[Flash官方价格](https://evolink.ai/seedance-2-5-flash)与[Kling Flash官方价格](https://evolink.ai/kling-4-0-flash)当天实际浏览器正文已分别保存。Flash 480p $0.12/秒，720p $0.24/秒，音频不另收费。5秒720p比Eco超分720p贵约65%；相较普通Seedance当前配置便宜约26%。

**普通 Seedance 2.5 存在既有价格配置差异**：[当前EvoLink公开价格](https://evolink.ai/seedance-2-5)约为480p $0.138/秒、720p $0.296/秒；Makaron Native计费表仍为$0.275/$0.325。以供应商公开费率比较，Flash分别便宜约13%/19%，不能把旧计费配置差异全算成Flash降价。本次未改旧模型价格。

Flash带视频不能直接用$0.075/$0.15乘输出时长：参考生成按 `输出 + max(ceil(参考视频总秒), 输出)`；编辑按 `2 × ceil(源视频秒)`。例如720p输出5秒、参考3秒，计费10秒，共$1.50；480p编辑真实4.064秒源，进位后按10秒×$0.075，共$0.75。

## 效果与速度的已知证据

官方mascot同图、同提示词、4秒480p，Flash 190.6秒/$0.48，普通2.5 209.7秒/$0.55任务回执（公开报价$0.552）。单样本约快9%、便宜13%，两者都保留身份，不能宣布画质胜出。Flash720p另一次499秒包含查询网络中断；不能承诺Flash稳定更快。文本细节保持和严格局部编辑存在失败样例，见主报告。

## 可复查证据

- `evidence/seedance25-flash-20261113/current-five-second-quotes.json`：实际产品报价器结果。
- `official-price-observation.txt`、`kling-flash-price-observation.txt`：带观测时刻的供应商正文。
- `provider-receipts.json`、`product-billing-acceptance.json`：原任务精确model ID与usage.cost.usd。
- [主报告](seedance25-flash-20261113.md)与本机可播放报告 `http://localhost:3048/report.html`。
