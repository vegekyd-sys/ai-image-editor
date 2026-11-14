# 云端部署包优化与实测（2026-11-13）

## 范围与结果

独立 worktree：`/Users/tianyicai/.codex/worktrees/cloud-deploy-footprint/ai-image-editor`，
分支 `codex/cloud-deploy-footprint`，基线 `7fadfde6`。本任务只部署独立 Preview，
没有修改共享环境变量、占用 git-dev alias 或部署生产。图片恢复提交保持为祖先。

这次减少的是服务端文件追踪和源码上传范围，不修改媒体模型、收费、编辑器、字体选择或导出内容合同。
CLI 参数/help/模型能力不变，无需 npm 发版。3D 独立候选不包含在本分支中，不能把本报告当成该候选的功能验收。

## 实现

- Next 构建配置自动注入 `MAKARON_BUNDLE_LOCAL_RENDERER` 常量。仅当 Vercel 构建且所选后端不是 `local` 时，编译器裁掉本地 renderer 的动态导入；本机 Next、直接 TS/CLI worker 和显式 local 后端继续保留原实现。无需新增共享 env。后端选择变化需要重新构建。
- 云端 API 不再携带本地 Remotion bundler、Webpack、TypeScript/Rspack 构建依赖。保留 FFmpeg、Sharp、Sandbox/Lambda SDK、完整 Google Fonts 模块及校验运行时。
- 补齐实验、测试证据、宣传片源码、内部文档等追踪排除。源码上传保留 prebuild 需要的中文 CLI 文档，以及内置和公开 Skill 图片。
- 修复 `.vercelignore` 的目录项匹配：CLI 50.15.1 文件树中，`evidence/` 等规则过滤了子文件，却留下目录项；`--archive=tgz` 使用 tar-fs 再递归该目录，把忽略的文件重新带入。用匹配目录本身的根目录规则排除，并测试必要素材/嵌套 API 不受误伤。最终上传清单无目录项。
- postbuild 继续校验 CRC32C 和 FFmpeg；新增所有 API 的 220,000,000 字节 trace 预算以及本地编译工具禁入门禁，缺失清单文件直接失败，不静默低估。

## 同环境 Linux 对照

均在 Vercel iad1、30 核/60 GB、Linux x64，构建侧 CLI 65.14.0、本机 CLI 50.15.1、同一 pnpm lockfile。
每次使用 `--force` 禁用构建缓存，同一构建后计量脚本，不使用共享分支 alias。
耗时从本地准备上传开始至 CLI 完成，包含打包/传输/依赖安装/构建/发布等待。
文件上传的内容哈希缓存不能视作已禁用；上传量另列。每个配置只做一次，不能据此承诺稳定性能收益。

| 上传方式及版本 | 最大 API trace，十进制 MB | 上传量（CLI 显示） | 总耗时，秒 |
| --- | ---: | ---: | ---: |
| 压缩上传，基线 | 271.084 | 70.5 MB | 134.676 |
| 压缩上传，仅首轮编译器/trace 优化 | 189.617 | 70.5 MB | 120.250 |
| 普通上传，基线 | 236.015 | 526.8 KB（增量） | 87.774 |
| 普通上传，最终优化 | 189.617 | 29.9 KB（增量） | 101.927 |
| 压缩上传，最终优化，显式禁用 LARGE_FUNCTIONS | 189.617 | 24.5 MB | 105.616 |

对 3D 会话使用的压缩上传路径，最大 API trace 减少 30.05%，压缩上传量减少约 65.25%，单次总耗时减少 21.58%。
普通上传路径的最大 API trace 减少 19.66%，但本轮总耗时增加 14.153 秒，未证明稳定提速。
不要把压缩包与增量传输量相互比较，也不要把普通上传的单次差异解释为编译器优化的因果效果。

正常源码文件清单由 1,399 个文件、36,513,809 字节降到 1,067 个文件、32,396,714 字节（约 -11.28%）；
压缩上传额外消除了忽略目录被递归重新加入的问题。最终最大路由为 `/api/agent`，
`/api/agent/execution/[id]` 为 188.700 MB，5,573 个文件。
这里统计实际 Linux `.nft.json` 中现存文件的逻辑字节，按部署路径计数，并非 Vercel 最终 ZIP/解压包的精确大小。
最终 Preview 同时以 build-env/runtime `VERCEL_SUPPORT_LARGE_FUNCTIONS=0` 成功部署，证明不依赖放宽大小限制。

最终最大 trace 的主要保留内容：FFmpeg 79.912 MB、Google Fonts 38.810 MB、public 21.306 MB、
Sharp libvips 16.657 MB、src 8.767 MB、Next chunk 8.363 MB；没有本地编译工具。

## 功能与回归

- Vitest：395 个文件通过，2 个跳过；2,921 项测试通过，2 项跳过。含云端预算/目录排除、渲染生命周期/隔离、视频导出、固定和任意字体、匿名字体读取。
- TypeScript 无报错；变更文件 ESLint 无报错。
- CLI smoke/upload 套件通过，包含 60 MB 分析、500 MB 分块上传、恢复、非法 offset、大小/供应商/元数据限制和存储拒绝；CLI 本轮无代码或版本变化。
- 本地原入口 `renderDesignFrame`/`renderDesignVideo` 配置 local，实际生成 JPG 和 640×360、30 fps、2.000 秒 H.264；帧图中文字正常。总计 28.808 秒，其中视频渲染 10.443 秒。它与云端测试不是相同创作稿，不能用作逐像素一致性结论。
- 独立 Preview 实际 Agent 项目，经事件确认调用 `run_code → preview_frame → publish_draft → materialize_media`，完成可编辑稿和 MP4。无图片/视频/音乐模型调用，Agent 净计费 2 credits。
- 下载云端 MP4 用 ffprobe 确认为 H.264、640×360、30 fps、2.000 秒；实际查看抽帧，中文衬线标题、英文副标题、移动圆点可见。
- 最终目录排除版：`GET /api/remotion/fonts` 200、3,549 faces；鉴权任意字体 Bungee Spice 动态 provision 200；Agent 事件接口 200；鉴权空参数 export 返回预期 400，验证真实模块可加载且不创建导出任务。
- 最终 Preview 在 Codex 内置浏览器显示首页、模板图片和设计切换交互，控制台无 error/warn。本轮未重新验证所有媒体供应商或所有用户项目。

最终 Preview：`https://ai-image-editor-oxsxque5p-vegekyd-sys-projects.vercel.app`

测试记录、构建日志、各次耗时 JSON、源码清单和可播放 MP4 保存在本机
`/Users/tianyicai/.codex/artifacts/cloud-deploy-footprint-20261113/`。不将访问凭据、签名媒体 URL 或完整原始日志提交到仓库。

## 发布交接

按用户在关联会话授权的顺序，本任务验收后先合 dev，生产部署及 shared dev 同步由图片恢复发布会话继续处理。
本任务的完成阶段是本地/Preview 验证和合入；生产性能、真实生产导出与环境同步以发布会话的后续证据为准。
