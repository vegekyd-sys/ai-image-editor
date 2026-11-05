# GPT Image 2.6：原 2.5 测试集复测

核心 13 题、26 次显式型号配对，以及原来的 10 个共享 editImage / 3 个真实 makaron chat 均已复测。独立 Preview 已可体验。GIF 云端完整链路通过；SVG 真生成与原生 Codex 图片型号确认仍未通过，不标记完整升级验收完成。

- [真实应用 Preview](https://ai-image-editor-5av7aovby-vegekyd-sys-projects.vercel.app)。deployment `dpl_8nmdbjnDehV4LH9CJ2PeW5SMBFXz`，READY / preview，部署代码 `fdc8f136`，业务代码 `b1dcd2fd`。
- [逐张交互报告](http://127.0.0.1:3049/)；[离线 HTML](comparison.html)；[固定测试集及复跑方法](../../testcases/gpt-image-regression/README.md)。报告服务仅绑定本机。
- worktree `/Users/tianyicai/.codex/worktrees/gpt-image26-candidate/ai-image-editor`，分支 `codex/gpt-image26-candidate`。后续测试/报告提交不改变已部署业务代码。
- 未 push、合入、生产上线或发 NPM，未占共享 git-dev alias。共享 DB 仅补两条缺失的 2.6 精确价格，沿用相应 2.5 倍率；旧价格与默认不变。存储原本无 MIME 限制，未改配置。云端使用新建专用测试项目。

## 找回的 session

当前标题（read_thread 现场确认）：**验证 Nano Banana Lite 图生图**。
ID `01a0839a-5924-7620-beb6-fb0e59b5e837`；核心验收 turn `01a08a72-2a6c-7d53-80c2-365bbe5663d7`，2026-09-10。

原 worktree `ai-image-editor-image25` 已移除，`.jsonl.zst` 归档还在。恢复了 [原测试脚本](history/original-run-matrix.ts.txt)、13 张结果查看副本、素材来源、逐项耗时/成本与三个 Agent 用户指令。[查看副本索引](history/capture-index.json)。不提交原 session 全文或私人人像。

公开人像与可乐重新从原 URL 下载，旧原件 SHA 不存在，不能声称与旧文件字节相同。历史查看副本可能缩放/重编码。**本轮双方输入字节、顺序、提示词完全相同**，SHA 已固定。复杂抠图固定使用历史公共广告查看副本；已透明产品再抠图保持原来有限覆盖。

## 模型配对结果

fal / Flare / quality low；2.6 reasoning high，2.5 端点不发送 reasoning 字段。使用仓库请求构造器、交替型号顺序、每格一次、单次付费 POST、原 ID 查询、无隐藏 fallback。历史 Agent 会扩写提示词，直接配对用原始用户指令，真实 Agent 路径另列。

26/26 成功，无审核拒绝。中位数 **21.580 → 16.099s，约快25%**；均值21.730 →15.877s，约快27%；13/13 格2.6更快。总图片费用 **$0.1377 → $0.3238，约2.35倍**。后台产品验收有少量时间重叠；每格一次只是样本描述，不能推断稳定排名、P95或SLA。

| 场景 | 历史2.5秒 | 本轮2.5秒 | 本轮2.6秒 | 本轮$ 2.5 / 2.6 |
|---|---:|---:|---:|---:|
| 自然语言可乐广告 | 24.9 | 21.9 | 20.6 | $0.0137 / $0.0301 |
| 中文咖啡信息图 | 18.3 | 21.2 | 11.9 | $0.0073 / $0.0293 |
| 可口可乐电商详情页 | 33.1 | 24.3 | 17.9 | $0.0126 / $0.0255 |
| 中英文字海报 | 29.3 | 20.8 | 16.1 | $0.0044 / $0.0173 |
| App UI 静态概念图 | 30.0 | 23.0 | 11.8 | $0.0037 / $0.0142 |
| 网站首页静态概念图 | 22.8 | 21.6 | 12.8 | $0.0036 / $0.0142 |
| 原创动漫插画 | 16.7 | 17.0 | 14.1 | $0.0044 / $0.0172 |
| 导演分镜图 | 26.3 | 29.0 | 21.7 | $0.0122 / $0.0228 |
| 普通人像保真编辑 | 22.3 | 19.3 | 18.8 | $0.0170 / $0.0311 |
| 人物＋品牌产品双参考 | 24.3 | 27.8 | 18.0 | $0.0250 / $0.0378 |
| 商品抠图与原画布 | 21.2 | 22.6 | 16.4 | $0.0140 / $0.0305 |
| 复杂广告透明抠图 | 21.7 | 18.8 | 13.8 | $0.0136 / $0.0288 |
| 透明底文生图 | 19.3 | 15.3 | 12.4 | $0.0062 / $0.0250 |

已查看全部成图、配对联系表、透明样本深浅底。2.6 材质/排版有改善，贴纸未见历史宽光晕；电商仍偏广告，海报/UI有未要求小字/日期，人像商品有细节重绘，复杂抠图尺度改变。**严格保真与复杂抠图仍不判通过**。[逐项视觉评语](visual-review.json)。历史2.5两项透明质量失败保留在固定集。

## 原调用路径的复现

原十项共享 editImage 全部完成，旧 openai 入参／透明自动路由实际均为2.6 Flare / fal。合计$0.2358，中位17.61s。透明机器人贴纸单次 **78.853s**，保留慢样本，未用直接配对的12.42s替换。应用原画布适配继续执行。逐项receipt在application/。

三个原用户指令在真实云端 Preview、现有专用测试身份、新建项目复现；实际 Agent 为DeepSeek Flash，所有图片为2.6 Flare。

| 场景 | 历史完整Agent | 本轮完整Agent | 图片调用 | 积分：图片 / Agent |
|---|---:|---:|---:|---:|
| 可乐广告 | 54.9s | 88s | 2 | 9+7 / 3 |
| 咖啡信息图 | 43.1s | 20s | 1 | 8 / 2 |
| 继续广告抠图 | 49.6s | 75s | 1 | 7 / 2 |

广告先生成2K，再根据检查修正文字；不能只挑最后一张或把两次费用算一次。Agent模型、扩写/检查、分辨率与历史不同，**不是严格端到端提速A/B**。[run与账本](preview-product-proof.json)。CLI返回的项目链接部分仍为生产域名，报告使用实际调用的Preview域名；本轮不是生产验收。

## 云端GUI、CLI与格式

- PNG：真实Preview生成、持久化、Editor显示、Save下载、重开通过，0 page errors。[证据](preview-ui.json)。IAB先打开并互动；认证Save自动化使用项目Playwright，正常SSR session cookie作测试前置，未部署auth bypass。
- GIF：云端CLI显式2.6 Flare / low / high，9帧、960×960、160ms，17credits。通过产品DualWriter放入新建格式项目，存储字节不变。GUI可见动画、原文件下载、重开及手机尺寸检查通过，0 page errors。[GUI证据](preview-formats-ui.json)、[存储证据](preview-format-project.json)。
- SVG：前轮三次真实生成均422，本轮未重发相同已知失败请求。GUI/保存/下载/CLI传输成功用的是**明确标注合成fixture**，不算模型真生成，仍blocked。
- 质量×推理矩阵、Sunburst、mascot沿用[前轮扩展报告](../gpt-image26-upgrade/README.md)。本轮补原2.5集，没有用新海报代替旧题。
- 候选默认2.6 Flare、quality low、reasoning high；2.5新选项移除，旧请求迁移，历史标注保留。生产默认尚未改变。

## 原session其他验收的覆盖对照

| 原测试 | 当前证据／限制 |
|---|---|
| 核心13场景、10共享、3 chat | 本轮实测；固定提示词与公开素材保留 |
| 各档位、变体、mascot | 前轮实测；xhigh/max reasoning不支持，保留422 |
| GET查询/下载恢复、单次POST | 保留现有恢复测试，本轮重新通过；不对拒绝内容改写撞审核 |
| 原生订阅图片能否锁定Flare/Sunburst | 旧2.5统一回传gpt-image-2-codex/auto，本就不是有效版本A/B；2.6原生锁定仍未确认，前轮一次POST网络结果未知且未重发 |
| 管理员Codex Subscription使用新图片 | 前轮隔离真实Subscription Agent→fal 2.6通过；生产relay仍ECONNRESET，本轮云端为DeepSeek，不算云端订阅验收 |
| 私人人像审核、Segmind | 原私有照片未恢复，不换素材冒充，不新接供应商；保留原失败 |
| Nano Banana Lite/Gemini额外对照 | 属历史其他供应商研究，不算2.6已覆盖 |
| 原全站发布、生产域名、NPM registry | 当前仅Preview，未宣称生产或NPM完成 |

## 验证、费用与阶段

原命令中现存12个原测试文件，加2.6测试，共13文件/133项通过。原openaiImageSize.test.ts已不存在，补跑当前imageModelCapabilities和gptImageFormats覆盖尺寸/格式，2文件/84项通过。TypeScript通过。前轮222项较广检查及CLI/四语像素验收仍可查；重叠测试不累加。

本轮配对$0.4615+共享工具$0.2358；云端图片48credits（含GIF），Agent7credits。云端精确供应商console费用未取到，不把积分当发票：按已核实倍率2与$0.01/credit向上取整，图片成本上界$0.24，文字暂估约$0.035。连同前轮已完成调用估算 **约$2.3**，在既有$10总额内。历史422无费用字段与原生订阅未知结果仍保留未知。[轻量汇总](cost-summary.json)。

阶段：code_ready、preview_deployed、核心媒体与GIF live_verified；完整升级live_verified=false（SVG、原生订阅型号/云端relay未通过）。报告与Preview可审查，合入/生产/NPM待用户决定。

原始输出保留本地 paired/ 与 application/；分支保存逐项receipt、SHA、900px审查缩略图、历史查看副本与固定输入。交互报告缩略图可随分支复用，点击查看本机原始文件。
