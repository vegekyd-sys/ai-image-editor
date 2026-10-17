# DeepSeek Flash 1017 / 默认 GPT-6 Luna：5 对 60 秒 TikTok

## 模型与隔离

- 官方 [2026-10-17 更新](https://api-docs.deepseek.com/updates/) 为 DeepSeek-V4.1-Flash-1017，调用名仍为 `deepseek-flash`，接口及价格不变。官方明确该别名升级到最新版本；运行返回的通用别名不能独立证明供应商内部 checkpoint。
- worktree：`/Users/tianyicai/.codex/worktrees/deepseek-flash-tiktok-1017/ai-image-editor`；分支 `codex/deepseek-flash-1017-tiktok`；基线 `b59cdeeee2805b0169900b6c6fbb3275066b7ce1`。
- 基线已有 `deepseek-flash` 目录、原生 DeepSeek SDK、图片输入、high thinking、跨轮 reasoning 回传补丁、计费及 CLI 参数；本次新版兼容原接口，无需新增模型 ID 或调整生产默认。
- 创作请求使用 worktree 内 CLI 0.17.3，通过现有正式 Makaron 服务执行；代码兼容测试在独立 worktree 进行。这不是候选代码部署或生产默认切换。
- DeepSeek Chat 工具烟测：run `044bef26-fb3f-42e8-87fe-209152ba2e20`，读取 TikTok Skill 后正常完成，服务端运行约 5.1 秒，实际计费模型 `deepseek/deepseek-flash`，3 Credits。
- 默认模型烟测：run `95cfe622-67bb-4611-aeae-0a770636c2c9`，实际模型 `gpt-6-luna:codex-subscription`，约 9 秒，套餐覆盖 0 Credits。正式对照使用 `--agent-model auto`，以使用这个账号当前实际默认路径。
- 现有模型目录、偏好、选择器、DeepSeek wire contract 共 41 项测试通过；CLI smoke 通过。

## 实验合同

- 用户授权 Scene CLI 使用公司账户检索，客户由执行者选择；全部视频创作、修正、预览和导出通过 `makaron chat` 内部工具完成。外层脚本只编排 CLI、记录状态并检查最终媒体。
- 5 个客户分别为振丰玩具、富阳云绒、广州市帛卉化妆品有限公司、云南互祺食品、亦馨家居竖屏。每个客户检索一套约 60–75 秒实拍范围。
- 同一对使用同一 manifest、同一提示词、同一 Skill、独立新项目；要求 59–61 秒、9:16、英文 TikTok、有声音、来源真实。两边自主创作，不使用对手输出作为输入。
- 两模型提交次序按题交错。任务同时运行时共享服务负载，不将观察时长解释为纯模型推理速度。
- 时间分别记录素材检索、CLI 新建项目与导入、Agent、异步导出、首次可用 MP4；修正单列，首轮失败保留。全程 wall-clock 及时间戳保存在实验 artifacts。
- 预算两边合计初始约 5 美元，上限 10 美元；目录积分按代码合同 1 Credit = 0.01 美元计预算，套餐覆盖的 Agent 使用单列。积分目录价值不等于供应商实扣美元；Scene 检索成本若未返回则列为未知。
- 外层验收检查实际下载文件：时长、尺寸、音轨、全帧解码、响度、开头/主体/结尾及字幕画面，再展示配对播放器。模型自评与完成状态不自动算视觉验收。

## 运行方法与证据

脚本：`benchmarks/deepseek1017-tiktok.py`。原始 manifest 带媒体访问能力，保存在 ignored 的 `artifacts/deepseek1017-luna/`，不提交到 Git 或共享记忆。

```sh
python3 benchmarks/deepseek1017-tiktok.py retrieve
python3 benchmarks/deepseek1017-tiktok.py submit 01
python3 benchmarks/deepseek1017-tiktok.py poll
```


## 第一轮端到端实测结果

计时为 CLI 提交开始（含新建项目、素材导入）至首次观察到可用 MP4，不把 Agent 的 ended_at 当成 MP4 完成时间。约有 35 秒轮询误差。Scene 检索为共同前置步骤，单列且只执行一次；它不是某一路模型自己检索的耗时。修正累计时间包含外部检查和等待间隔，单次Agent时间另存，不能将其与首轮制作时间混为一谈。

| 客户 | 共用素材检索 | DeepSeek 首轮 | 默认 Luna 首轮 | 观察 |
|---|---:|---:|---:|---|
| 振丰玩具 | 1分22秒 | 7分14秒 | 22分19秒 | DeepSeek字幕更大、首版音量偏轻；Luna画面较亮但字幕较小。 |
| 富阳云绒 | 0分53秒 | 21分25秒 | 31分32秒 | Luna开场先展示纤维成品；DeepSeek按碎片到纤维推进。 |
| 帛卉化妆品 | 0分57秒 | 失败（14分34秒，无MP4） | 31分50秒 | DeepSeek首轮达到执行token上限；接续后取得MP4。 |
| 云南互祺食品 | 1分07秒 | 15分08秒 | 22分51秒 | DeepSeek首版存在多处素材空档；首修仍残留两处；继续候选修复。 |
| 亦馨家居 | 0分41秒 | 16分46秒 | 30分10秒 | DeepSeek包装更突出，Luna偏工艺叙事；DeepSeek在MP4完成后额外等待，宿主通知收尾并发出停止请求。 |

首轮 DeepSeek 4/5 取得 MP4，Luna 5/5 取得 MP4。DeepSeek 已出片题普遍更快，但食品首版画面有空档，且存在工具图片回传缺陷，因此不能把速度差直接解释为模型能力的完整差异。

## 可播放文件

| 客户 | DeepSeek 首版 | Luna 首版 |
|---|---|---|
| 振丰玩具 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/69abd802-6c3f-410f-ae9b-52790d1b1398/media/remotion-zhenfeng-factory-contrast-60s-9x16-4f887328.mp4) | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/e92bda7b-ab55-45c5-b6b5-4fc5ab331071/media/remotion-zhenfeng-toys-60s-tiktok-ed2fb634.mp4) |
| 富阳云绒 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/3b264f03-cf9b-40ba-9b9f-9740e512af2d/media/remotion-fuyang-yunrong-shards-to-cloud-60s-9x16-b64df64a.mp4) | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/5e61faf6-f7f0-4e03-bd03-6552dfa88dae/media/remotion-fuyang-yunrong-follow-the-fiber-60s-a1fa5250.mp4) |
| 帛卉化妆品 | 首轮未交付 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/a188e26f-2285-44c4-886b-59112435d44f/media/remotion-bohui-skincare-factory-tiktok-c6e77ca0.mp4) |
| 云南互祺食品 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/c6129bce-0bab-4454-9333-32eb4a9926f7/media/remotion-branch-to-box-60s-9x16-a4d99e80.mp4) | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/9b0b1a69-82a8-4f2a-95b6-a56707a79be8/media/remotion-yunnan-huqi-orchard-to-box-tiktok-a2386f90.mp4) |
| 亦馨家居 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/00a0a4a1-7b66-492c-8b04-44834626fba8/media/remotion-yixin-factory-60s-tiktok-07c1a188.mp4) | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/2cefa10a-4d1a-41ef-a514-94383f950af3/media/remotion-yixin-home-factory-little-surprises-60s-tiktok-014374a6.mp4) |

所有首版和后续已下载版本均为实测约60.053秒、1080×1920、H.264/AAC，完整视频帧解码通过。抽查了钩子、主体、结尾和疑似空档，并测量响度；这不等于已经独立完整听审每条语气、配乐和连续动作。

## 修正与真实质量门槛

- 玩具 DeepSeek：首版 −27.2 LUFS、true peak −7.5 dBFS；保留首版，复用原音轨归一化后实际MP4为 −16.1 LUFS、true peak −1.4 dBFS。无需新配音。该修正22 Credits。
- 化妆品 DeepSeek：首轮因 `execution_token_budget_exhausted` 失败（135 Credits）；同模型原项目接续12 Credits完成，可编辑合成、音轨和ASR均复用。
- 食品 DeepSeek：首版35.5–37.0、45.2–46.0、48.5–50.3、57.5–58.0、59.5–59.97秒疑似空档，实帧确认至少36秒只有背景；首修37 Credits后仍在36.3667–37.0、49.4–50.3秒存在空档。合成帧预算自评通过不能替代实际MP4验收。候选链路二次修复28 Credits后，实际MP4完整解码、全片blackdetect无空档，36.7秒与49.7秒实帧均有真实素材。该run保留一次失败旧导出，后续成功导出不能被汇总failed状态掩盖。
- 家居 DeepSeek：MP4约16分46秒已ready，但Agent继续等待；宿主提供真实完成状态通知并通过CLI发出停止请求，最终状态回读为completed。这一干预与首片耗时单列，不能当成完全自动收尾。
- 首轮视频目录扣费：DeepSeek626 Credits，Luna216 Credits（Luna Agent由Codex套餐覆盖，媒体正常计费）；上述三条后续修正71 Credits；模型路由烟测3 Credits；候选读图测试6 Credits。加上食品第二次修正28 Credits，最终合计950 Credits（Makaron目录价值9.50美元）。Scene检索未返回供应商成本，无法从CLI确认该部分账单；目录价值不等于供应商实扣美元。

## 已复现的接入缺陷与候选修复

`@ai-sdk/deepseek@3.0.42` 在 tool 输出为 `content` 时执行 `JSON.stringify(output.value)`，把 `preview_frame` / `read_file` 的PNG/JPEG作为base64文字发送，缺少真正的 image_url。模型虽支持用户消息图片，工具图片仍会丢失视觉语义，并放大上下文。首轮多个任务自述“只能拿到图的数据”，与这条wire缺陷一致；具体耗时/失败中有多少由此造成尚未量化。

修复位于 `src/lib/deepseek-tool-vision.ts`：只对DeepSeek Flash，把工具图像移至完整tool响应批次之后的原生用户图片消息，保留工具ID、文字、来源与推理历史，不把base64写进文本。正常化为幂等操作，不修改原消息，不改变其他模型。候选未合并或部署生产。

- 42项相关测试通过；真实SDK请求控制组复现base64文字，修复组原生image_url，所有tool响应保持在图片前。
- `tsc --noEmit --incremental false`通过；CLI smoke通过。
- 候选服务只监听本机127.0.0.1:3117。所有真实试验仍通过 `makaron chat`。
- 真实工具读图验证：运行时crypto随机生成图片，工具只返回路径，经read_file观察，再发布PNG由宿主读取像素核验。第一次四等宽带含相邻同色，模型位置读错；第二次四色不重复随机排列，模型“绿、黄、蓝、红”与像素一致。通道成立不代表模型视觉判断完全可靠。两次合计6 Credits。
- 首轮10个任务不冒充修复后完整对比。是否用候选重跑DeepSeek五题，已询问是否将会话上限从10美元提高到15美元，尚未得到授权，因此未开始完整复跑。

## CLI 证据完整性修复

长失败JSON在 `process.exit(1)` 时会截断于pipe缓冲区。候选改用 `process.exitCode=1` 让stdout排空，保留非零退出语义；新增 `responses get --events --json` 供活动/失败任务保存带时间戳的完整工具证据。支持 `--after <seq>` 获取后续事件页；两条Luna任务超过1000事件，已补齐分页，避免把服务端单页上限误当成完整日志。256KB失败JSON的普通查询和wait查询、游标透传和无效游标拒绝回归通过。该本地CLI候选未发布npm，也未替换全局安装。

## 后续版本与最终交付

| 客户 | 后续 DeepSeek MP4 | 增加的执行 | 验证 |
|---|---|---|---|
| 音量修正 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/69abd802-6c3f-410f-ae9b-52790d1b1398/media/remotion-zhenfeng-factory-contrast-60s-9x16-loud-v3-9b2b5c96.mp4) | 378秒Agent / 22 Credits | 完整解码通过，-16.1 LUFS |
| 首轮失败接续 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/2645d07e-70f7-414d-8c42-8f2090ecc633/media/remotion-bohui-bottle-fill-60s-en-ebc5d121.mp4) | 169秒Agent / 12 Credits | 完整解码通过，-15.7 LUFS |
| 食品空档最终修正 | [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/c6129bce-0bab-4454-9333-32eb4a9926f7/media/remotion-branch-to-box-60s-9x16-v3b-15f10771.mp4) | 690秒Agent / 28 Credits | 完整解码通过，-16.4 LUFS |

最新配对播放器：`http://127.0.0.1:8797/`，默认展示后续可用版本，保留首版链接与首片计时。所有10条当前可用片均已下载、完整解码、测量音轨并抽查画面；连续音乐/语气听审未由宿主独立完成。最终素材范围也未逐镜证明全部严格保持在建议范围内，不能把模型自述作为该项验收。

家居DeepSeek自行制作代理片并自述排除一条损坏本地副本；Luna使用同一输入完成了相关素材，不能据此宣称Scene原始素材不可用。1080×1920是实际输出编码尺寸，不证明所有底层代理均为原生1080。

结论：当前线上链路下DeepSeek出片速度更快、部分大标题和强调更适合手机；Luna首轮5/5有MP4，但内部修正与QA耗时明显较长、部分字幕偏小。DeepSeek首轮4/5有MP4，另有食品空档、工具图片回传缺陷和家居收尾干预。因此该轮足以比较实际产品路径，不能证明修复后的DeepSeek整体质量优于Luna。修复后完整5题复跑尚未获额外预算授权，不作替代模型结论。
