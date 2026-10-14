# 音画一体生成：独立修复与实测

日期：2026-10-14（Asia/Shanghai）  
分支：`codex/studio-native-audiovisual`  
状态：代码、真实生成、真实 Agent 及字幕云端导出验收完成，已合入 dev；生产发布按 release 流程独立验收。

## 结果

普通数字人广告直接生成完整音画；字幕只决定是否追加文字后期，不再决定整个生产路径。
实际通过项目的 Seedance 2.5 **Eco** 路径取得六条可播放的有声视频（五个受控样本及一次真实 Agent 生成）。
原生字幕和后期字幕各取得完整 25 秒、720×1280 样本。

真实 Agent 已验证两条路径：

| 场景 | 实际调用 | 最终结果 |
| --- | --- | --- |
| 新数字人视频 | 读三个指引 → 一次 `generate_animation(seedance-2.5-eco, generate_audio: true, 25s)` | 25.041667 秒画面及 AAC 音轨，五句口播完整 |
| 已有原生音画加可编辑字幕 | ASR → 一次 `run_code` → 两次预览 → `publish_draft` → `materialize_media` | 云端导出 completed，720×1280、25.066667 秒画面，有声 MP4 与可编辑设计已保存 |

两条实际工具记录中均为 **0 Studio、0 单独音频生成**。字幕路径也为 0 视频生成。
字幕导出经 AAC 重编码，与原视频音频对齐后波形相关性 0.99945；编码偏移约 42.7ms。
独立本地字幕对照还复制了原 AAC，解码 PCM 完全一致。
这些是已下载、探测和查看的 MP4，不是排队状态或仅保存的合成代码。

## 原 session 的问题

来源：用户提供的项目 `0ace911f-a165-4216-b3b8-2f87d2e9973e`。
要求是 25 秒 TT04S 英文讲解广告，含人物/产品参考、口播、音乐、字幕、型号与公司名。
原 session 做了三次 Seed Audio、三次 ASR，再以 Eco 生成无声底片。
两次视频请求都显式设置 `generate_audio: false`，脚本还禁止人声、音乐和音效。
原始底片及 720p 文件均无音轨；合成源码虽保存，却未执行合成和最终导出。

找到并修复的触发点：

1. Avatar Skill 的 `studioRunRecipe`、`studioRunProfile` 以及目录/启动 manifest 中的 `Studio Run recipe: avatar-spokesperson` 仍把数字人带进 Studio。已移除并重建 manifest；数字人归入 video-generation。
2. Avatar、Explainer、Cinematic 及 Studio 音频/生产指南要求先配音、做无声底片，覆盖了原生音画能力。已统一共享合同，去掉仅因口播、多镜头、字幕或超过 15 秒就拆分的要求。
3. 可编辑字幕被误扩展成画面和声音也必须分别生成。现在单素材字幕直接合成、预览、发布及导出，无需八阶段文档。
4. Studio Assets 原先只有独立 audio/music 才满足 `audioRequired`。现在实际验证过的有声视频也可满足要求，避免因资产结构强行重做声音。
5. 原 session 中参考素材角色被写反。共享指南要求结合当前 Media Index 和实际图像绑定人物/产品，不能复用旧文本标签作为身份依据。

共享合同位于 `src/skills/_shared/native-audiovisual.md`。工具参数合同仍由工具描述拥有，不新增用户关键词分类器或另一套固定时长路由。

## 审核排查与恢复

初始四个直接供应商基线均返回 `content_policy_violation`：

| 样本 | task ID | 结果 |
| --- | --- | --- |
| 原参考、25 秒、原生字幕 | `task-unified-1791952852-ttb0yuap` | 审核失败 |
| 原参考、25 秒、后期字幕底片 | `task-unified-1791952853-pzc13qtw` | 审核失败 |
| 仅产品参考、10 秒、原生字幕 | `task-unified-1791953192-w26h0xzy` | 审核失败 |
| 仅产品参考、10 秒、后期字幕底片 | `task-unified-1791953192-zksdya75` | 审核失败 |

初次以失败任务的报价预留推算已达预算并停止，是错误处理。预留不是结算，失败退款不能按成功费用累计。
用户明确要求继续修复后，改用项目实际 `createVideo/getVideoStatus` Eco 流程继续做对照。
没有把未提供逐笔账单的估算冒充实际净支出；当前回归 harness 不再使用旧的失败预留停止规则。
原始供应商 harness 已改为仅查询既有回执，新生成统一走实际应用流程。

| 实际应用路径样本 | 控制变量 | 结果 |
| --- | --- | --- |
| Eco 5 秒纯文本厨房 | 无图片、最简提示 | 成功、有声、720p |
| Eco 5 秒产品参考 | 加入原产品参考 | 成功、有声、720p |
| Eco 25 秒简洁完整脚本 | **原人物与产品参考不变**，保留五句英文口播/音乐/原生字幕 | 成功、有声、720p |
| Eco 25 秒人物上半身裁切、原生字幕 | 仅裁去原人物下部手/厨刀，保持紧凑脚本 | 成功、有声、720p |
| Eco 25 秒同裁切、后期字幕底片 | 同参考/脚本，改为不生成文字，仍生成全部声音 | 成功、有声、720p |
| Wan 3.0 Prime：最简及两种完整字幕条件 | 兼容替代模型 | 三条供应商完成，但输出 CDN 在本机证书链失败，其他标准 TLS 环境返回 403；未计入可播放交付 |

这证明普通内容可在 Eco 路径恢复，**不证明某个词或厨刀就是唯一审核原因**。
原人物未裁切也能成功；仅产品参考在旧提示下也曾失败。提示形式与实际路由同时发生变化，生成及审核亦有随机性。
供应商只返回通用错误，没有可追溯到某个词/帧的审核详情。恢复无需关闭审核，也不以绕过审核作为产品逻辑。
Avatar Skill 已要求检查真实输入/错误、减少无关限制、在用户授权恢复时测试兼容模型，并保留原 task ID，避免原样循环重试。

受控样本的精确提示和参数（参考 URL 已替换为占位符）见 `benchmarks/studio-native-audiovisual/cases.example.json`。

## 字幕及音画质量比较

| 项目 | 模型原生字幕 | 原生音画 + 后期可编辑字幕 |
| --- | --- | --- |
| 声音 | 五句口播、同一女声和背景音乐，无需独立配音 | 保留同类原生音画及原声，不重新配音 |
| 英文文字 | 实际出现 `range hot`、`ft hard-working`、尺寸/型号拼写错误 | 使用规范原文、ASR 真实时间；完整显示尺寸、功率及质保文案 |
| 精确品牌/公司名 | 不稳定，中文公司名错误或遗漏 | `TT04S` 及 `中山市沪颖电器有限公司` 可准确显示和修改 |
| 成本/步骤 | 一次生成即可，但错字无法确定性修正 | 一次音画生成，只追加文字合成；没有 Studio 和配音链路 |

对要求精确广告文案的这类任务，推荐原生音画 + 轻量文字后期。普通成片需求仍可以尝试原生字幕。
比较使用两条受控生成视频，非同画面的严格配对；也没有拿旧 session 的失败无声底片宣称音质全面胜出。
ASR 会把 hood、four-eighty 等误识别；独立视频审阅确认尺寸发音，并未仅凭 ASR 错字重新花钱配音。
真实 Agent 样本转写覆盖全部五句及结尾，但 `Oil drains` 实际转写为 `Oil drips`，尚不能承诺模型逐字不差。

原生生成仍有质量边界：人物口型并非逐帧完美；滤网/电机内部有生成式细节和虚构产品字样。
路径修复和有声交付已验收，不能据此宣称这条广告已达到品牌发布验收标准。

## 运行时验证

`hasAudio` 是可选资产字段，不需要数据库迁移。
服务端在 Assets validate、单项和批量写入路径探测实际 MP4/MOV 的 `moov/trak/mdia/hdlr` 音频轨。
伪造字段、负载里的 `soun` 字符串、截断文件、无法读取或无音轨均不能冒充音频证据。
容器存在音轨仍不等于声音质量合格，需要查看/播放成片。

- 最新完整 Vitest：2,469 通过、1 跳过、0 失败，共 2,470 项。
- TypeScript、变更模块/脚本 ESLint、Agent startup 合同与 diff 检查通过。
- 真实原 session 无声 MP4 被正确拒绝为有声资产；本地真实 MP4 及字幕渲染验证音轨传递。
- 真实 Agent 生成 run：`cc9498b1-72f0-4d84-acde-15c21e335f35`。
- 真实字幕 Agent run：`d85893b2-e207-4bc4-9791-f01a471e85b3`。
- 字幕云端导出 job：`cff8f53d-5510-4095-bcce-7d47f43d2d9c`，completed，渲染 49.867 秒。
- 本地 Agent 的代码来自独立 worktree，使用真实服务和新建的所属测试项目；原 session 仅查询。
- 内置浏览器已经显示对照页面、解码和播放有声视频；文字预览和末帧公司名已查看。

## 复现入口

凭据从现有私有环境加载；原始响应、媒体 URL 和用户数据留在忽略的 `.tmp/`。
新生成前按当前授权确认实验范围和实际模型报价，不把失败预留当作实扣。

```sh
npx vitest run __tests__/studioNativeAudio.test.ts __tests__/studioRun.test.ts
node --import tsx benchmarks/studio-native-audiovisual/verify-media.ts .tmp/native-media-acceptance
# cases.example.json 替换为真实参考 URL，放入私有目录的 cases.json。
# diagnosis.json 提供测试账号 userId、所属 projectId 及 jobs: []。
node --env-file=.env.local --require ./md-loader.cjs --import tsx benchmarks/studio-native-audiovisual/run-cases.ts submit private-dir
node --env-file=.env.local --require ./md-loader.cjs --import tsx benchmarks/studio-native-audiovisual/run-cases.ts poll private-dir
node --import tsx benchmarks/studio-native-audiovisual/render-captions.ts private-dir eco-tt04s-crop-post
node --import tsx benchmarks/studio-native-audiovisual/verify-agent.ts private-dir
node benchmarks/studio-native-audiovisual/serve-review.mjs private-dir 3189
```

`run-cases` 在 POST 前持久化每个 label，文件锁阻止并发覆盖；状态查询不重新生成，下载错误保留供应商回执。
`verify-agent` 只验收已有工具记录、完成状态及真实媒体，不发起新的生成。
`render-captions` 产出可编辑设计、字幕、普通预览与属性修改预览；叠字后原声 PCM 一致。

本次没有合并、网站发布、CLI/NPM 发布或修改生产配置，也未覆盖原项目数据。
