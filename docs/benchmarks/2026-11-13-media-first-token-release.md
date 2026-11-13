# 媒体首字优化发布验收（2026-11-13）

用户确认独立 Preview A/B 后，授权合入上线。代码合入 `dev` 并推送：`5bae74ea953174bcde6d7fcb0e7af8906fb05e64`。本记录是后续文档补充；线上应用代码以该已验收提交为准。

## 部署与同步

| 环境 | Deployment | 状态与源码 |
| --- | --- | --- |
| [Production](https://www.makaron.app) | `dpl_dCzpXZ14Mo5NfcjHTuCoLiEF4upH` | READY，源码 `5bae74ea` |
| [共享 dev Preview](https://ai-image-editor-git-dev-vegekyd-sys-projects.vercel.app) | `dpl_Aw6SrmLzDTcmk6WETR5yorZSJg1C` | READY，源码 `5bae74ea` |

两端均在 `hnd1`。Production 使用 `pnpm run release:prod`；共享 Preview 在同一已验收提交部署并通过功能检查后再绑定 alias。两次均为普通文件增量上传。未修改共享环境变量或晋升 Snapshot。

对比 Production、默认 Preview 与 dev 分支 Preview 的 24 项 Agent、媒体沙箱、Remotion、Lambda、导出、缓存、容量和编码配置，均一致。两端实际导出回执均使用 Remotion Lambda `4.0.527` 的同一渲染函数；字体 telemetry 无错误。

## 验收

- 完整发布门禁通过：TypeScript、407 个测试文件通过（2 跳过）、3035 项测试通过（2 跳过）、CLI smoke/upload、本地生产构建、Vercel 构建及运行时体积/FFmpeg 门禁。四项受控路由证据为当前源码指纹，预检未执行媒体生成或项目写入。
- 两端 `/api/health` 均为 healthy，13/13 服务正常。
- 公网认证 `/api/agent` 各验收图片、视频、图片+视频三条；6/6 原始 SSE 正常完成，无错误。单次验收数据仅用于功能回归，不代替前述交错 A/B。

| 场景 | Production 首字 | 共享 Preview 首字 |
| --- | ---: | ---: |
| 图片 | 6.890s | 8.935s |
| 视频 | 7.890s | 14.331s |
| 图片+视频 | 9.353s | 11.081s |

- 两端各导出一段 2 秒、640×360、24fps H.264 MP4，下载、ffprobe 与代表帧检查通过，均未发布至时间线。最初的生产测试夹具使用不支持的 Arial，任务明确失败；改为已查实存在的 Inter 后创建新任务成功，失败回执保留。未修改产品字体策略。
- 生产页面“更新”弹窗已在内置浏览器验收，新增标题与两条文案可见，控制台无 error/warn。`Changelog.tsx` 和四语言文案已更新；新增 changelog 定向测试 30 项通过，i18n 门禁无新增问题。
- 本次不改 CLI 模型、参数、help、README 或 bundled Skill 合同，无需新发包。已验证 npm latest `0.17.19` 与仓库包内容一致，并完成 registry 全新安装、help 与 9 项入口发现检查。

## Changelog

1. 带图片聊天时，默认 Agent 更快开始回复，减少等待。
2. 同时使用图片和视频时，更快收到素材分析与创作方案。

纯视频首字未在独立 A/B 中证明改善，不列入上述承诺。详见[云端对照及限制](2026-11-13-media-first-token-cloud.md)。

## 回滚与证据

发布前生产 deployment：`dpl_7EZRhBCuJj6nqzEoAvimavqkDRBx`（`a9079073`）；发布前共享 Preview：`dpl_36Lpxf1qWHz1v9kokozXqYbbisSh`。回滚可恢复相应旧 deployment alias；本次无数据库迁移和共享配置变更。

私有证据保存在本机 `/Users/tianyicai/.codex/artifacts/makaron-media-ttft-20261113/release/`，包括构建日志、源码/alias 回执、三环境配置对照、CLI registry 验证、生产与 Preview 媒体请求和 MP4 导出回执。私有环境、认证信息及媒体链接不进入 Git。临时构建/部署 worktree 已归档，原功能 worktree 保留。
