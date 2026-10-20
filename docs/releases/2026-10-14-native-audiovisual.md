# 2026-10-14 音画一体路径发布

用户授权：合入 dev，验收后与 dev 已有优化一起上线。

## 发布范围与版本

- 数字人 Skill、目录和启动 manifest 去掉 Studio recipe，普通新视频直接生成原生音画。
- 字幕与音画方式独立选择；可编辑/确定性文字直接叠加，保留视频原声，不启动 Studio。
- Studio Assets 接受实际验证过的内嵌音轨，伪造 `hasAudio` 或无声文件仍拒绝。
- 同批包含 dev 的 ZIP Skill 安装响应共用逻辑及输入一致性优化（`871f675d`）。
- 补齐四语言更新说明，CLI Skill/README 的新路径指引。
- 合入提交：`7d8e93d9`；实际生产运行时提交：`f2c8ba1b0a111a9ab70ed28447d872e422c01c08`。
- Vercel：`dpl_4AF7Tyq7dkgn97SDqgji5dqPMkVW`，READY、production，主域名 `www.makaron.app`。
- CLI/npm latest：`makaron-cli@0.17.1`。
- npm tarball SHA-1：`d4cb08f56db50c9c9326bd72693d7c34cc72488a`。

## 验收

- 合并后的完整 Vitest：2,469 通过、1 跳过、0 失败，共 2,470 项。
- TypeScript、CLI smoke、完整构建及服务端依赖打包检查通过。
- ESLint 无错误；其他文件的已有 warnings 保留。i18n、Agent startup、视频参考合同和公开 Skill discovery 检查通过。
- 本地/Preview/Production 的 AI_PROVIDER 一致；没有新增必需 env 或修改生产配置。
- 主域名加载正常，12 项健康服务全部通过；内置浏览器已查看线上更新说明。
- 发布前检查 tarball；registry 的版本、latest、hash/integrity 与预期相同。
- 从 registry 在新目录安装 0.17.1，七个发布文件与检查过的 tarball 完全一致，version/help/chat help/video help 及线上 Avatar discovery 通过。
- 网站公开 bundled Skill 与 registry 全新安装的 Skill 相同。

## 真实生产 Agent 和媒体

数字人恢复成功 run：`c611b5da-e123-4a12-a08d-0524e1dfe07d`。
工具记录是三个指引读取 + 一次 `generate_animation`，选择 Eco、25 秒、`generate_audio: true`。
0 Studio、0 独立配音。最终 ready，实际 MP4 为 H.264 720×1280、25.041667 秒画面及 AAC 音轨。
ASR 覆盖全部五段讲解及结尾。ASR 会把 hood/four-eighty 等转写错误；不能仅据此重做配音，也不能承诺模型逐字完美。

字幕 run：`4ff9c373-4ff5-49a5-95fd-c1ff1959f553`。
ASR 后直接写合成代码、一次 `run_code`、三次预览、发布设计和物化导出。
0 Studio、0 新视频生成、0 独立配音。
导出 job `9742702e-7cd7-43db-8b9c-1154a6b34976` completed，渲染约 22.3 秒。
最终 ready，720×1280、25.066667 秒画面及 AAC 音轨；字幕、型号和末帧中文公司名已查看。
与原生源音频对齐后的波形相关性为 0.99945，AAC 偏移约 42.7ms，原声内容保留。
两条最终 MP4 已下载、探测，并在内置浏览器解码/播放验证。

## 审核恢复及边界

首次生产 run `83ce3e5c-521f-4a8d-9848-5d13a30815be` 返回供应商 `content_policy_violation`。
工具正确使用原生音频，但该尝试没有视频，未计作交付。
实际用量记录为 726 credits 扣费、726 credits 退款、净扣 0。

首次 Agent 提示额外加入了未使用厨刀的负面描述，且约 3,424 字符。
恢复请求使用此前测试成功的上半身参考并简化提示；实际 Agent 脚本约 1,269 字符，仍保留完整五段英文讲解。
恢复成功没有关闭审核或重复提交原任务。
参考裁切与提示同时变化，不能认定某个词、人物或厨刀是唯一审核触发因素，也不能承诺供应商审核零失败。

既有 Wan 实验回执通过生产 API 复查显示供应商完成，但 CDN 在本机/内置浏览器遇到证书错误，未作为已播放的替代模型交付，没有关闭证书校验。
原生字幕准确性、口型及产品内部细节仍需要成片审阅；本次验收证明路径与交付，不代表广告的品牌发布审核。

原 session 只查询，所有生产实测使用新建所属项目；无数据库迁移、生产数据修复或原项目覆盖。
发布后的本记录是文档补充，未改动已验收的运行时代码或 npm 包。
