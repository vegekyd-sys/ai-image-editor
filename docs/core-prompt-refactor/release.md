# 2026-09-05 Core Prompt 发布记录

用户查看 57 组盲评结果、分层结构和剩余风险后，明确授权：新增开关，默认切到新版，合入 dev 并上线。这是知情发布决定，不是将此前失败的质量门槛改判为通过。

## 已发布

- 产品代码：`bf07bede7765c9daee9696d71cb6693659217c05`，已合入并推送 `origin/dev`。
- 部署：`dpl_4rn4szJ7aQ7Htbdrgcr9jshr6DDb`，Vercel Ready。
- `https://www.makaron.app` 与 `https://makaron.app` 已显式指向该部署。`vercel --prod` 只自动更新项目默认别名，因此另行检查并更新正式域名。
- 当前管理员接口返回 `mode: layered`。Admin 页面顶部「新版分层 Core Prompt」开关已发布。
- 配置存于独立 `core_prompt_settings` 表，RLS 开启；anon/authenticated 无写权限，service_role 可写。通过管理员 API 控制，缓存 15 秒，读取异常回退旧版。
- 原部署保留：`ai-image-editor-6d6dnxap9-vegekyd-sys-projects.vercel.app`（`3193cd36`）。开关回退无需重新部署；整站回退时两个正式域名也必须同时核验。

## 验证

- 全量单测 1663 通过、1 跳过；CLI smoke 通过；lint、TypeScript 通过。
- worktree Webpack 构建通过；canonical dev Turbopack 构建及 Vercel 远端构建通过。第一次 worktree 构建出现一次未定位的 `undefined.length` 异常，重跑成功，后续两种正式构建未复现。
- 冻结基线逐字验证：旧 Core、workspace authoring、video/coding 工具说明及不附加 bundle 的真实 read_file 均恢复；新版继续通过 54 段规则归属、12 份创作正文和两套 bundle 检查。
- 本地真实管理员 API：legacy/layered 往返均 200；未登录写入 403。两次真实 CLI 改写均完成，日志分别 `mode=legacy base=11875`、`mode=layered base=7455`，最终恢复 layered。
- 正式管理员 GET 200 且 layered；未登录 PUT 被拒绝。线上日志检索命中新部署的 layered 请求，未命中 legacy。
- 正式域名 health：13 项 healthy，0 unhealthy，0 unavailable。
- 线上真实图片编辑已保存、重新读取并下载：1024×1024 JPEG，领结红/黑，完整解码。未将本次烟测解释为所有未编辑像素严格不变。
- 线上 H3 Max Turbo 480p：已完成并保存视频，480×480，视频流 5.166667 秒、有音轨，完整解码。抽帧发现额外分屏，未满足单一固定镜头的严格画面要求；生成与存储路径通过，质量不记作全通过。
- 线上 Remotion：可编辑作品已保存；重新从项目读取并云端导出，3 秒、720×720、90 帧，完整解码，标题「轻盈出发」正确。该用例要求无音轨。
- Mac 锁屏导致 CUA 不可用，本轮没有完成后台按钮的真实浏览器点击和手机布局验收；API 往返、四语言文案检查和生产构建已验证。

原始 CLI/导出结果、项目标识和临时签名 URL 只保留在忽略目录 `artifacts/core-prompt/release/`，不写入此记录。

## 风险仍保留

详见 `acceptance.md`：局部图片严格保真、长视频自动收尾、局部视频修复的时长与窗口外一致性、普通请求速度并未全部通过。默认视频供应商没有因本次发布而改成 H3；本轮 H3 烟测不覆盖所有模型。

权限检查另外确认原有 `app_settings` 无 RLS，匿名可写。新开关已使用受保护独立表；试验阶段仅创建的 `app_settings.core_prompt_mode` 已删除。本次没有改变旧配置表其他行或权限，这个既有安全问题需要单独修复。
