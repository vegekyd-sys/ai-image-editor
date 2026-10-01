# 项目进入到可见画面：2026-10-01 profiling

验收点是从导航开始到实际图片或视频首帧显示，并检查后续是否又变黑、loading 或重复滑入。编辑器挂载、DOMContentLoaded 和 API 完成不能替代这个指标。

## 环境与证据

- 旧代码：`9f9be93f`；最终运行代码：`edaba28b`（之后提交仅添加测试和本报告）。
- 同一台 Mac，Playwright headed Chromium，每次新建浏览器 context，390×844，真实共享生产数据和媒体，本地 webpack production build、`next start`。
- 每 100ms 采样可见图片与视频解码状态，记录动画、网络失败和整段进入录像；这不是线上上线后的验收或真实 iOS App 验收。
- 最终样本 JSON：`/tmp/mkr-visual-streamed-{video,image,video2,image-repeat}.json`。
- 对照录像：`/tmp/mkr-project-entry-comparison.mp4`，左边旧版，右边最终候选。录像时间轴包含浏览器开始导航前的短暂空白，具体耗时以 JSON 的 navigation-relative 时间为准。

## 结果

| 公开项目 | 旧版实际出画面 | 最终候选实际出画面 |
| --- | --- | --- |
| `62cb6b23-989f-48a3-9b6b-2fe936f7d4de` 视频 | 两次本地首帧 2.88s、3.54s；另一次线上 3.74s | 首帧 1.77s |
| `170e7497-ac1e-4a58-8ebc-a39cba4d71ed` 图片 | 成功样本 1.24s；另一次直到采样结束仍在加载 | 0.82s、1.21s |
| `8b94e663-5bd2-43ea-a4fa-253780d890a1` 视频 | 一个慢样本首帧 13.75s | 首帧 1.31s |

旧版整页 `page-slide-in` 在本地出现 1 次、线上曾出现 2 次；最终四个样本均为 0 次。最终四个样本的首个画面之后，100ms 采样未出现空画面间隙，未捕获 pageerror。第二个视频的直接媒体请求出现 ERR_ABORTED，播放器仍正常出帧；不能把所有网络请求都称为无错误。

网络波动明显，表中是实际样本，不是总体 P95 或稳定 SLA。第二个视频的单次慢样本不作为“整体提升十倍”的依据。图片原本已有服务端预览，正常样本的首图提升有限；本次也避免了慢服务端查询阻塞整页。

最终样本首个 HTML 响应约 11–57ms，完整 DOMContentLoaded 仍约 10–10.6s，但真实画面在 0.82–1.77s 已经显示。这说明等待页面全部完成会误判用户可见的进入耗时。

## 改动与原因

- 去掉项目 loading 壳和 editor 上的整页滑入，避免不同挂载阶段重复播放。
- 首图查询放入独立 Suspense，慢服务端读数不阻塞编辑器响应；读取沿用 viewer session 与 RLS，私人项目不能通过管理员查询泄露早期媒体。
- 提前显示当前真实媒体，直到对应编辑器画布解码、绘制后交接。编辑过的 composition 使用保存的 poster，避免展示未经编辑的源视频。
- 早期图片和视频与画布使用一致的 CORS 请求模式，视频沿用相同代理 fallback，减少重新请求；只对当前进入的媒体加载，不保留后台隐藏播放器。
- 主画布视频提前读首帧，截 poster 使用当前解码帧，取消“先跳到 0.5 秒、再跳回”的二次 seek；访客不执行 poster 持久化。
- 访问验证与项目、快照、消息、音乐并行读取，取消前后额外查询；持久化 design 在 poster/history 之后异步恢复，并使用 owner workspace。
- 相机、动画、设计编辑面板、Moveable 和 composition 编译运行时按需加载；普通图片/视频进入不再为 Babel 状态订阅加载整个 composition 编译器。

## 验证与边界

完成进入录像、桌面视频详情打开与真实播放、移动视口图片显示；构建、TypeScript、相关 ESLint、UI i18n guard 与完整 Vitest 已验证。另有测试覆盖慢媒体查询先返回 editor shell、解码后交接、跨项目切换与代理 fallback。

公开 design 页面既有 fonts POST 401 尚未解决，不能宣称所有 composition 的可交互预览已通过。登录后的私有项目、真实 WKWebView 项目列表滑入与生产部署仍需各自验收。当前候选未合并、未部署。
