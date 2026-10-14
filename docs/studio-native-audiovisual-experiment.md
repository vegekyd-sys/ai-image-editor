# 音画一体生成：独立候选修复与实验

日期：2026-10-14（Asia/Shanghai）  
分支：`codex/studio-native-audiovisual`  
状态：候选修复已提交并通过本地验证；未合并、未部署。真实质量 A/B 被供应商审核拦截，不能据此宣布原生字幕或后期字幕质量胜出。

## 问题与边界

复现来源是用户提供的项目 `0ace911f-a165-4216-b3b8-2f87d2e9973e`。
原请求是 25 秒 TT04S 英文数字人口播广告，包含参考人物、参考产品、口播、音乐与可编辑字幕。

原 session 实际做了三次 Seed Audio、三次 ASR，再以 Seedance 2.5 Eco
生成无声底片。两次视频请求都显式设置 `generate_audio: false`，脚本同时
禁止旁白、说话声、音乐和音效。原始底片及 720p 文件都没有音轨。
合成源码已保存，但没有执行合成和最终导出。不能把时间线中的底片视为成片。

原因不只是模型选择：

1. 数字人/Explainer/Cinematic 适配器与 Studio 的通用音频要求，覆盖了视频生成指南中的原生音画合同。
2. Studio Assets 仅接受独立 audio/music 作为音频证据，即使视频本身已经包含声音，也不能满足 `audioRequired`。
3. 字幕可编辑性被扩展成了画面、声音、口型都必须分开制作。超过 15 秒的旧路由阈值进一步扩大了 Studio 的使用范围。

## 修复后的生产选择

音画生成方式与字幕制作方式分开决定。

| 用户要的结果 | 生成与后期 |
| --- | --- |
| 模型单次时长范围内的新视频 | 一次 `generate_animation`，同一脚本包含全部镜头、对白、表演、音乐和音效 |
| 成片字幕/标识，无可编辑要求 | 可以同次指示模型生成；检查实际字形、拼写、阅读性和语音同步 |
| 明确要求确定性/可编辑文字 | 仍先生成完整音画，仅不烘焙文字；转写真实视频，再叠文字，保留原生声音 |
| 代码动画、独立音频、明确替换配乐 | 保留单独音频工具和 Remotion 路径 |
| 源素材剪辑、复杂拼接或明确要求 Studio/Remotion | 保留相应生产工具；生成片段进入合成时保留其原生声音 |

共享规则放在 `src/skills/_shared/native-audiovisual.md`。
数字人、Explainer、Cinematic、Studio 生产和音频指南以及 TikTok 包装引用这一规则。
不通过用户提示词关键词检测或新的固定模板来决定路线；尊重用户/App 的模型选择及模型实际时长限制。
不因为 Skill 名称、镜头数量、口播、字幕或超过 15 秒就启动拆分制作。

### 运行时改动

- 视频资产支持可选 `hasAudio`；经过验证的内嵌音轨满足 Studio 的音频要求。
- 在所有 Studio Assets 的 validate、单项写入和批量写入路径，读取实际 MP4/MOV 的 `moov/trak/mdia/hdlr`，验证其音频轨。
- 无法读取、损坏、无音轨或仅在文件负载中出现 `soun` 字样，都不会被当作音频存在。
- 旧的独立 audio/music 资产继续可用，不需要数据库迁移或修改已有项目数据。
- 叠字幕时保留视频声音，不因平台源素材默认静音策略重新配音或重复叠音。

音轨存在只证明容器中有声音；不能代替人声可懂度、口型、产品一致性或字幕质量验收。
这次没有新增异步后期自动编排器，也没有改动 Agent 回合完成语义；需要后期的中间任务仍应保留 task ID 和明确的 continuation action。不能把生成排队、素材返回或代码保存当作最终 Delivery。

## 真实供应商实验

用户授权总预算不超过 $10。使用 EvoLink Seedance 2.5 reference-to-video，
480p、9:16、`generate_audio: true`、默认审核开启。
480p 是本次预算内的生成质量样本规格；未付费放大到 720p。

公开供应商单价为 $0.138/输出秒；音画字幕同次生成不额外收费。
价格来源：[EvoLink Seedance 2.5 公开价](https://evolink.ai/seedance-2-5)。
这些是直接供应商估算，不是 Makaron 用户 Credits 报价或已经结算的实扣费用。

| 实验 | 控制条件 | task ID | 预算预留 | 结果 |
| --- | --- | --- | --- | --- |
| 25 秒原生字幕 | 原人物及产品参考、完整五句口播，音画字幕同时生成 | `task-unified-1791952852-ttb0yuap` | $3.45 | `content_policy_violation` |
| 25 秒后期字幕底片 | 同参考、口播与镜头；保留原生音画，不生成文字 | `task-unified-1791952853-pzc13qtw` | $3.45 | `content_policy_violation` |
| 10 秒原生字幕 | 仅产品参考、虚构成年讲解者、相同短口播和镜头 | `task-unified-1791953192-w26h0xzy` | $1.38 | `content_policy_violation` |
| 10 秒后期字幕底片 | 同短样本条件；保留原生音画，不生成文字 | `task-unified-1791953192-zksdya75` | $1.38 | `content_policy_violation` |

25 秒两条在北京时间 12:40 提交；10 秒两条在 12:46 提交。
后两条是独立受控短实验，不能视为人物身份一致性或完整 25 秒口播的验收。
每组只改变文字生成要求；模型结果本身仍具有随机性，不能当作严格像素配对实验。

累计按全额预留计 $9.66，余下不再发起生成。没有假定失败任务已退款，也没有使用
不确定的退款继续试错。没有产出可下载的成功视频，所以没有 ASR、口型或字幕质量评分；
没有把供应商完成状态、预测能力或合成信号样本冒充生成质量证据。

四条请求都经过数分钟处理后返回同类审核错误。仅凭此不能确定是参考图、人物、
提示词还是供应商审核误判；仅使用产品参考仍失败，也不足以把根因归到原人物图中的厨刀。

## 本地验收

- 全量 Vitest：2,469 通过、1 跳过、0 失败（共 2,470 项）。
- TypeScript `tsc --noEmit`、变更辅助模块/实验脚本 ESLint、Agent startup manifest 合同、`git diff --check` 通过。
- 新增回归覆盖：原生视频音轨满足 Assets、没有声音仍拒绝、伪造 `hasAudio` 拒绝、无法读取拒绝、真实 track handler 与普通字节串区分、截断及大尺寸 box。
- 本地生成 3 秒测试信号 MP4，叠加字幕时复制原生音轨。叠加前后分辨率和时长相同，解码 PCM 完全一致。
- 用原 session 的真实 25.041667 秒无声 MP4 验证新的音轨校验，正确拒绝将其声明为带声音的视频。

本地测试信号只用于验证音轨传递和文本叠加，不是 Seedance 音画/字幕的质量样本。
没有运行真实 Agent 重新完成原始 25 秒交付；目前不能声称修复已得到生产端到端验收。

复现命令（运行 `submit` 前必须重新核实预算与供应商价格）：

```sh
npx vitest run __tests__/studioNativeAudio.test.ts __tests__/studioRun.test.ts
node --import tsx benchmarks/studio-native-audiovisual/verify-media.ts .tmp/native-media-acceptance
# 凭据从本机现有环境加载，private-dir/input.json 提供参考 URL 与预算。
node --import tsx benchmarks/studio-native-audiovisual/experiment.ts submit private-dir
node --import tsx benchmarks/studio-native-audiovisual/experiment.ts poll private-dir
node --import tsx benchmarks/studio-native-audiovisual/experiment.ts transcribe private-dir
```

`submit` 在 POST 之前持久化预算预留；同 variant 不重复提交；失败和不确定的提交也占用预算。
脚本的实验价格常量来源于当天公开价，未接入供应商实时账单系统。
私有原始响应、参考 URL 和本地运行日志保存在 worktree 的 `.tmp/`，不进入 Git。

## 结论与仍需完成的验收

可以落地的工程修复是：完整生成音画，字幕方式独立选择；Studio 不再要求为满足
音频资产结构而拆出配音，也不在后期字幕处理中丢掉原生声音。

还不能落地为质量结论的是“原生字幕已经可以全面替代后期字幕”。需要解决当前供应商
审核阻断后，取得成功样本，实测完整口播、数字读法、口型、字幕拼写/阅读性/同步与
产品外观，再决定字幕默认策略。上线前也需要当前代码下真实 Agent 的完整交付验收。

本候选没有修改生产配置、定价、数据库或原 session；没有发布网站或 CLI/NPM。
