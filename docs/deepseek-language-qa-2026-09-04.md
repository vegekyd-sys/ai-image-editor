# DeepSeek Agent 语言实测报告

日期：2026-09-04（Asia/Shanghai）。结论：**纯图片首条回复会跟随应用语言；正常聊天多数符合预期，但自然语言切换仍有失败。图片分析成功本身尚未验收。**

## 环境与方法

- 测试对象：`codex/wan-h3-language-fixes` 的未合入精简版，测试快照 `e09b0af90fc656d3f242674d80cfc58be78d38af`。该快照仅供本地 runner 使用，没有移动 feature/dev 分支或部署。
- 本地服务：`http://localhost:3042`；独立 runner：`/Users/tianyicai/ai-image-editor-runner-language-qa`。原有 dirty runner 保留。
- CLI：实际执行 `makaron chat --agent-model deepseek-v4-pro`，再用 `makaron responses get` 取回最终结果。服务端记录确认模型 `deepseek-v4-pro`、provider `deepseek`，不是用其他模型代测。
- 使用正常项目持久化历史，不注入伪造的 assistant 历史。3 个 CLI 测试项目、16 条实际回复；人工按回复正文判断语言，不用“含汉字”来区分日文/中文。
- 浏览器：实际选择 DeepSeek，上传同一张本地照片，输入框始终为空，点击创建。覆盖四种应用语言，以及无语言偏好记录的英语浏览器首次进入。
- 测试会在共享后端保存测试项目、消息和上传图，并产生正常模型调用费用。没有改生产配置、人工余额、数据库 schema 或部署。

## 1. CLI：15/16 条符合预期

| 场景 | 预期 | 实际 | 结果 |
| --- | --- | --- | --- |
| 中文首次发言 | 简体中文 | 简体中文 | PASS |
| 中文后 `ok` | 中文 | 中文 | PASS |
| 中文后连续第二次 `ok` | 中文 | 中文 | PASS |
| 中文对话后完整英文追问 | 英文 | **中文** | **FAIL** |
| 上一条后再次中文追问 | 中文 | 中文 | PASS |
| 中文要求一个英文标题 | 英文标题 | `Rain on the Counter` | PASS |
| 英文标题后 `ok` | 中文会话 | 中文，引用英文标题 | PASS |
| 英文首次发言 | 英文 | 英文 | PASS |
| 英文后“好” | 英文 | 英文 | PASS |
| 英文对话后日文追问 | 日文 | 日文 | PASS |
| 日文后 `ok` | 日文 | 日文 | PASS |
| 日文对话后西班牙文追问 | 西班牙文 | 西班牙文 | PASS |
| 西班牙文后 👍 | 西班牙文 | 西班牙文 | PASS |
| 中文明确要求以后一直回英文 | 英文 | 英文 | PASS |
| 明确英文偏好后再中文追问 | 英文 | 英文 | PASS |
| 繁体中文首次发言 | 繁体中文 | 繁体中文 | PASS |

失败原例：

> 用户：How would you frame the opening shot and light the cafe window? Please keep it to two sentences; discussion only, no tools or media generation.
>
> Agent：开场用一个低机位固定镜头，隔着被雨点打花的玻璃窗往里拍……

这说明“有了文字，回复必然跟随这一条文字语言”仍不是可靠保证。后续中文追问虽通过，但因为上一步没有真正切成英文，不能把它算作独立验证成功的英文→中文切换。

16 次 run 均 completed，输出类型均仅 text。服务端 run 创建→完成耗时 6.13–14.39 秒，中位数 9.27 秒；不是纯模型推理时延。中文 `ok` 的一次状态读取返回 401，重新读取同一 run 得到 completed；没有重新提交该消息，不能把此读取故障算作语言失败。

这是一轮小样本，15/16 不是稳定性承诺，也不能与前一轮 Terra 的不同历史 fixture 直接排名。

## 2. 浏览器：无输入文案，回复语言 5/5 正确，图片分析 0/5 成功

| 浏览器 / 应用语言 | 首条可见 Agent 正文 | 语言 | 图片分析 |
| --- | --- | --- | --- |
| 浏览器中文，应用英文 | I'm not able to see the photo right now… | PASS：英文 | FAIL |
| 应用日文 | ごめん、この写真うまく読み込めなくて確認できなかった… | PASS：日文 | FAIL |
| 应用简体中文 | 抱歉，我这边没法看到这张照片，可以再发一次图片给我吗？ | PASS：简体中文 | FAIL |
| 应用繁体中文 | 我暫時看不到這張照片的內容，沒辦法幫你描述。 | PASS：繁体中文 | FAIL |
| 新英语浏览器，无保存的 locale | I can't see the photo right now—the image didn't come through on my end… | PASS：英文 | FAIL |

最后一个场景使用独立浏览器 context：`navigator.languages = ["en-US"]`，没有 localStorage locale、没有原有 locale cookie，也没有 URL locale 参数。页面自动得到 `html lang=en` 并写入 `locale=en` cookie。只保留登录会话与 DeepSeek 选择等非语言设置。

实际上传请求核对（不是用英文“请分析”模拟空文案）：

```json
{"prompt":"","analysisOnly":true,"analysisContext":"initial","agentModel":"deepseek-v4-pro","image":"<真实上传图片 URL>","projectId":"<测试项目>"}
```

浏览器截图：

- [英文应用首条回复](../test-results/deepseek-language/screenshots/deepseek-language-en-image-only.png)
- [日文应用首条回复](../test-results/deepseek-language/screenshots/deepseek-language-ja-image-only.png)
- [简体中文首条回复](../test-results/deepseek-language/screenshots/deepseek-language-zh-image-only.png)
- [繁体中文首条回复](../test-results/deepseek-language/screenshots/deepseek-language-zh-hant-image-only.png)
- [英语浏览器默认语言](../test-results/deepseek-language/screenshots/deepseek-language-en-browser-default.png)

首个英文项目 `feb49cb5-519d-4ae8-817a-8f7368307ec5`；日文 `4a4a543e-2913-45cd-8ec4-dc688e7893ca`；简体 `1eedfbf5-e4aa-4490-9a11-d3b747c9be52`；繁体 `ed11c380-af79-4d25-a7b2-ba260a6958cc`；英语浏览器默认 `868a850e-f60c-4f04-a8ed-4795eebefbfd`。

首个英文上传自动触发了 Tips 预览生成请求，随后通过应用已有设置 `mkr_auto_tips=off` 关闭，后续没有主动请求媒体生成。Tips 文本仍正常加载。报告不将 Tips 文本或预览当成 DeepSeek 图片分析成功证据。浏览器有第三方资源的 `ERR_BLOCKED_BY_ORB`，一次切页时服务端出现 Tips stream controller already closed；核心分析 POST 为 200，但 200 不能代表看图成功。

## 3. 图片分析失败定位

DeepSeek 是文本 Agent，单图分析走 `analyze_image → Gemini gemini-3-flash-preview`。

对同一张上传图的只读检查：HTTP 200、JPEG、117,576 bytes、1080×1440，Sharp 解码成功。直接执行同一个 `analyze_image` 实现则返回：

```text
HTTP 400 / FAILED_PRECONDITION
User location is not supported for the API use.
```

因此当前本地调用链的阻碍是 Google 看图接口的地域限制。不是图片没上传，也不是 DeepSeek 应当直接收到图片但遗漏了。没有改代理、密钥或线上 provider；这不等于证明 Production 同样失败，线上看图成功路径仍未验证。

额外 UX 问题：真实故障发生在服务端看图接口，用户却看到“重新上传图片”的建议，容易误导重复上传。

## 4. 当前语言逻辑的准确描述

- 首次应用语言：URL locale → 已保存的应用选择 → locale cookie → 浏览器语言 → 默认值。
- 单图无文案：前端使用 `analysisOnly=true`；后端读应用 cookie（没有时读 Accept-Language），把输出语言明确传入轻量分析 prompt。因此应用英文即使浏览器是中文也会回英文。
- 普通聊天：保留正常历史，由 LLM 按一条语言原则判断；精简版普通聊天没有把应用 locale 当成额外 fallback 指令。这轮说明短确认语基本正常，但自然切换不是全通过。
- CLI chat 要求非空文案，也没有应用 locale 选择，不能用 CLI 验证纯图片首条分析。多图/视频无文案使用不同路径，本报告不外推到那些场景。

## 证据与重跑

- [完整 CLI 请求、run ID、回复与时间](../test-results/deepseek-language/cli-results.json)
- [CLI 测试脚本](../scripts/qa-deepseek-language-cli.mjs)
- [单图分析故障探针](../scripts/qa-deepseek-image-analysis.ts)

本轮只新增测试和报告，没有进一步修改产品语言逻辑，没有合入 dev、没有上线。
