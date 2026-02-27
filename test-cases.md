# Makaron 综合测试用例

> 每个 case 用 `- [ ]` 标记 Pass/Fail。测试前先确认环境（正式 / Preview / 本地 dev）。
> 桌面端断点：`min-width: 1024px`，低于此为移动端。

---

## 1. 认证

### 1.1 注册

- [ ] **正常注册**：输入合法邮箱 + ≥6 位密码 → 注册成功，跳转到 `/projects`
- [ ] **邮箱已存在**：用已注册邮箱 → 显示「该邮箱已注册，请直接登录」
- [ ] **密码太短**：输入 <6 位密码 → 显示「密码至少需要 6 个字符」
- [ ] **邮箱格式错误**：输入无效邮箱 → 显示「邮箱格式不正确」
- [ ] **频率限制**：60s 内重复注册 → 显示「请等待 60 秒后再试」
- [ ] **Loading 状态**：点击注册后按钮显示 spinner，不可重复点击

### 1.2 登录

- [ ] **正常登录**：正确邮箱 + 密码 → 跳转 `/projects`
- [ ] **错误凭证**：错误密码 → 显示「邮箱或密码错误」
- [ ] **Loading 状态**：点击登录后按钮显示 spinner

### 1.3 Session

- [ ] **刷新保持**：登录后刷新页面 → 仍在 `/projects`，不跳登录页
- [ ] **登出**：点击登出 → 跳转登录页，再访问 `/projects` 被拦截
- [ ] **Middleware 性能**：页面导航无明显冻结（`getSession` 读 cookie，非网络请求）

---

## 2. 项目列表

### 2.1 加载

- [ ] **首次加载**：从 Supabase 拉取项目列表，显示 2 列 gallery
- [ ] **同 session 返回**：从编辑器返回 → 零 spinner，内存缓存同步渲染
- [ ] **新 session 加载**：关闭 tab 重开 → IndexedDB 缓存优先，Supabase 后台刷新

### 2.2 创建项目

- [ ] **图片上传**：选择/拖拽图片 → 客户端压缩（max 2048px, quality 0.92）→ 跳转编辑器
- [ ] **图片 + 文字**：上传图片并输入 prompt → 编辑器打开后自动触发 Agent
- [ ] **EXIF 提取**：上传含 GPS 的照片 → 项目标题包含拍摄地点（区/县级别）

### 2.3 卡片交互

- [ ] **进入编辑器**：点击卡片 → `page-slide-out` 动画 → 编辑器 `page-slide-in`
- [ ] **重命名**：点击 `···` → 重命名 → inline input 出现 → Enter 提交 / Escape 取消
- [ ] **删除**：点击 `···` → 删除 → 卡片立即消失（乐观更新）→ 后台删除数据
- [ ] **卡片用 `<Link>` 标签**：iOS 上 touch 响应零延迟，`:active` 状态立即触发

### 2.4 Badges

- [ ] **Snap 数量**：项目有 >1 个 snapshot → 卡片底部显示「N snaps」badge
- [ ] **视频标志**：项目有已完成视频 → 卡片底部显示 ▶ 播放图标（fuchsia 背景）
- [ ] **单 snapshot 项目**：不显示 snap badge

### 2.5 页面样式

- [ ] **Wordmark**：顶部 Makaron 字样，800 字重
- [ ] **副标题**：「one man studio」，Caveat 手写体

---

## 3. 编辑器 — Timeline

### 3.1 基本渲染

- [ ] **Snapshot 加载**：进入编辑器 → 显示最新 snapshot 图片
- [ ] **Timeline dots**：底部显示 snapshot 数量对应的圆点，当前高亮
- [ ] **空项目**：pendingImage 正常显示为首个 snapshot

### 3.2 导航

- [ ] **左滑**：向左滑（≥40px 水平、水平 > 垂直）→ 下一张 snapshot
- [ ] **右滑**：向右滑 → 上一张 snapshot
- [ ] **边界**：第一张右滑 / 最后一张左滑 → 无响应
- [ ] **键盘**：← / → 方向键切换（桌面端）
- [ ] **鼠标拖拽**：桌面端鼠标左键拖拽，同 40px 阈值

### 3.3 图片交互

- [ ] **长按对比**：长按 200ms → 显示前一张 snapshot（opacity 渐变）
- [ ] **长按取消**：长按中移动 >10px → 取消对比，进入滑动
- [ ] **Pinch zoom**：双指缩放图片
- [ ] **双击重置**：双击 → 缩放重置为 1x

### 3.4 视频条目

- [ ] **视频 timeline**：有已完成视频 → timeline 末尾出现 `__VIDEO__` 条目
- [ ] **视频播放**：滑到视频条目 → Canvas 渲染 `<video>`，最后一个 snapshot 作为 poster
- [ ] **播放按钮**：正中间播放按钮，点击播放

---

## 4. Tips 系统

### 4.1 生成

- [ ] **SSE 流式**：上传图片后 ~3-5s 内 6 个 tips 全部出齐（2 enhance + 2 creative + 2 wild）
- [ ] **增量解析**：tips 逐个出现，不等全部完成
- [ ] **分类标签**：每个 tip 正确归类（enhance / creative / wild）

### 4.2 Preview 缩略图

- [ ] **自动生成**：tips 出齐后，committed 分类的 tips 自动生成 preview
- [ ] **状态流转**：`none → generating → done`，缩略图从加载到显示
- [ ] **Error 状态**：preview 失败 → 显示 error 标记
- [ ] **Error 重试（emoji 区域）**：点击 error tip 的 emoji → 触发重试
- [ ] **Error 重试（文字区域）**：点击 error tip 的文字区域 → 同样触发重试

### 4.3 Tip 交互

- [ ] **点击 → Draft**：点击已有 preview 的 tip → Canvas 显示 draft 预览图
- [ ] **Draft 取消**：点击其他 tip 或滑动 → draft 取消
- [ ] **Commit**：选中 tip 后点击 commit 按钮（「继续编辑 →」）→ draft 变正式 snapshot
- [ ] **Commit 按钮动画**：按钮宽度从 0 → 72px，0.2s ease-out
- [ ] **Commit 后加载新 tips**：新 snapshot 自动触发新一轮 tips 生成

### 4.4 分类 Tab

- [ ] **Tab 切换**：点击分类 tab → 滚动到该分类的 tips
- [ ] **按分类 preview**：切换到未生成 preview 的分类 → 自动触发该分类 tips 的 preview 生成
- [ ] **Tab 高亮**：当前分类 tab 用主题色高亮（enhance=fuchsia, wild=red）
- [ ] **Commit 后滚动**：commit 某分类 tip 后，auto-scroll 到该分类位置

### 4.5 Auto-scroll

- [ ] **生成时滚动**：tip `previewStatus` 变为 `generating` → 自动滚动到该 tip
- [ ] **完成时滚动**：tip `previewStatus` 变为 `done` → 自动滚动到该 tip
- [ ] **滚动延迟**：220ms 后执行（等待按钮动画完成）
- [ ] **居中对齐**：目标 tip 水平居中显示

### 4.6 图片压缩策略

- [ ] **Tips 分析**：用 `compressBase64(img, 600_000)` 压缩到 ~600KB（只分析不生图）
- [ ] **Preview 生图**：用原始 URL/base64（高清原图，否则人脸变形）
- [ ] **Commit 后 tips**：并发请求总大小 ~2.4MB（非 ~12MB），速度接近首次上传

### 4.7 桌面端 TipsBar

- [ ] **卡片尺寸**：200 → 156px
- [ ] **缩略图尺寸**：72 → 56px
- [ ] **Wheel 横滚**：垂直滚轮转换为水平滚动
- [ ] **鼠标拖拽**：mouseDown 拖拽横向滚动，移动 >4px 进入拖拽态

---

## 5. 画笔标注

### 5.1 基本功能

- [ ] **进入标注模式**：点击标注按钮 → AnnotationToolbar 出现
- [ ] **退出标注模式**：点击关闭 → 工具栏消失，回到正常浏览
- [ ] **画笔工具**：选择画笔 → 在 Canvas 上绘制自由曲线
- [ ] **矩形工具**：选择矩形 → 拖拽绘制矩形框
- [ ] **撤销**：点击撤销按钮 → 移除最后一个标注元素
- [ ] **撤销禁用**：无标注时撤销按钮 disabled
- [ ] **清除全部**：清除所有标注

### 5.2 颜色与粗细

- [ ] **默认颜色**：红色 (`#dc2626`)
- [ ] **颜色选择**：6 种颜色可选，点击切换
- [ ] **粗细调节**：slider 范围 5-80px
- [ ] **展开面板**：点击颜色/粗细按钮展开设置面板

### 5.3 选中与操作

- [ ] **Hit-test 选中**：点击已有的框/标注 → 虚线边框高亮
- [ ] **拖拽移动**：选中后拖拽 → 移动标注位置（触摸区域扩大 20px）
- [ ] **删除**：选中后右上角红色删除按钮 → 移除该标注

### 5.4 发送标注

- [ ] **发送给 Agent**：标注完成后发送 → Agent 能看到标注内容并理解编辑意图

---

## 6. Agent 对话

### 6.1 视图切换（移动端）

- [ ] **GUI → CUI**：点击「聊天」按钮 → Hero 动画（380ms cubic-bezier）→ 全屏对话
- [ ] **CUI → GUI**：点击 PiP → Hero 动画 → 回到画布模式
- [ ] **Hero 起点（GUI→CUI）**：Canvas 图片的 1:1 中心裁剪正方形
- [ ] **Hero 终点（CUI→GUI）**：Canvas 全区域，img 用 `object-contain` 匹配
- [ ] **iOS 右滑拦截**：CUI 中右滑不会触发浏览器返回（history.pushState）

### 6.2 视图切换（桌面端）

- [ ] **CUI 常驻**：`flex-row` 布局，GUI + CUI 340px 侧边面板同时显示
- [ ] **无 Hero 动画**：桌面端不触发视图切换动画
- [ ] **无 PiP**：桌面端不显示 PiP

### 6.3 PiP（移动端）

- [ ] **默认位置**：bottom-left，边距 14px
- [ ] **尺寸切换**：右下角 resize handle → 116 ↔ 200px
- [ ] **拖拽**：任意位置拖拽 → 松手吸附到 6 个角落（tl/tr/ml/mr/bl/br）
- [ ] **边缘收起**：拖到边角后再推 60px → 收起，露出 28px peek + 箭头
- [ ] **收起展开**：tap 或 swipe → 展开
- [ ] **Tap PiP body**：展开状态 tap → Hero 动画返回 GUI
- [ ] **键盘场景**：键盘打开时 tap PiP → 先 blur 等 300ms → 再执行动画

### 6.4 消息

- [ ] **发送文字**：输入消息 → 发送 → Agent 流式回复（token 级）
- [ ] **图片生成**：请求生成图片 → Agent 调用 generate_image → 图片出现在对话中
- [ ] **多轮上下文**：Agent 记住之前的对话内容（最近 6 条消息注入 prompt）
- [ ] **自动命名**：首次对话后项目自动获得标题
- [ ] **Inline 图片**：对话中的图片可正常显示，持久化后重进仍可见
- [ ] **Tool 状态卡片**：Agent 调用工具时显示 tool status card
- [ ] **Markdown 渲染**：Agent 回复中的 markdown 正确渲染

### 6.5 持久化

- [ ] **消息持久化**：Agent 消息全量保存到 Supabase
- [ ] **历史恢复**：退出重进 → 对话历史完整恢复
- [ ] **多 turn 分气泡**：analyze_image 前/后内容分开显示

---

## 7. 视频生成

### 7.1 入口

- [ ] **▶ 按钮**：≥3 个 snapshots → timeline dots 末尾出现 ▶ 按钮（24px fuchsia 圆形）
- [ ] **<3 snapshots**：不显示 ▶ 按钮
- [ ] **点击 ▶**：打开 AnimateSheet（底部 sheet，无蒙版）

### 7.2 脚本生成

- [ ] **自动生成**：打开 sheet → Agent 后台写脚本（`generating_prompt` 状态）
- [ ] **StatusBar 提示**：显示「正在写视频脚本...」
- [ ] **脚本流式写入**：`animationState.prompt` 实时更新
- [ ] **脚本同步到 CUI**：脚本内容同时出现在 CUI messages 中

### 7.3 提交与轮询

- [ ] **时长选项**：3s / 5s / 7s / 10s / 15s / 智能
- [ ] **费用预估**：显示 `duration × $0.112`
- [ ] **提交**：点击提交 → `submitting → polling`
- [ ] **轮询进度**：4s 间隔轮询，StatusBar 显示「视频渲染中 M:SS」
- [ ] **进度条**：宽度 = `min(95%, (pollSeconds / 300) × 100%)`

### 7.4 完成

- [ ] **视频完成**：`polling → done`，StatusBar 显示「视频已生成」
- [ ] **自动添加 CUI 消息**：视频 URL 自动插入对话（inline video player）
- [ ] **Timeline 条目**：视频作为 timeline 最后一个条目，可滑动到达
- [ ] **播放**：Canvas 渲染 `<video>`，poster = 最后一个 snapshot

### 7.5 保存

- [ ] **Save 按钮**：点击 → spinner + 「Saving」 → 通过 `/api/proxy-video` 下载
- [ ] **iOS 分享表**：iOS 弹出分享表可保存到相册
- [ ] **Toast**：保存完成后弹「保存成功」toast（2 秒消失）

### 7.6 放弃与重新生成

- [ ] **放弃**：polling 状态下显示「放弃」按钮 → 停止轮询，回到 `ready`，保留 prompt
- [ ] **DB 标记**：放弃后数据库标记 `abandoned`
- [ ] **重新生成**：点击「重新生成视频」→ `done → idle`，sheet 保持打开，刷新 imageUrls
- [ ] **关闭 sheet**：点 X → 关闭 sheet，回到最后 snapshot

### 7.7 恢复

- [ ] **重进恢复（completed）**：退出重进 → 自动恢复已完成视频
- [ ] **重进恢复（processing）**：退出重进 → 自动继续轮询进行中任务

### 7.8 限制

- [ ] **>7 snapshots**：只取前 7 张图片
- [ ] **必须 URL**：图片必须已上传到 Supabase Storage（有 `imageUrl`）
- [ ] **新 snapshot 无 URL**：`saveSnapshot` 上传完通过 `onUploaded` 回调更新 URL

---

## 8. 持久化 & 缓存

### 8.1 三层缓存

- [ ] **内存缓存**：同 session 内切换页面 → 零延迟渲染（`getCachedProjectDataSync`）
- [ ] **IndexedDB**：新 session 打开 → IndexedDB 优先加载（DB: `makaron-images`, version 4）
- [ ] **Supabase**：IndexedDB 无数据 → 从 Supabase 拉取

### 8.2 IndexedDB Stores

- [ ] **images store**：存储图片 base64（key: `snap:${id}`, `pending:${projectId}` 等）
- [ ] **project-data store**：项目元数据 JSON（snapshots + messages + title）
- [ ] **projects-list store**：项目列表缓存（userId → projects[]）
- [ ] **TTL 30 天**：过期数据自动清理

### 8.3 写入点

- [ ] **原图上传**：`pendingImage` 写入缓存
- [ ] **Agent 生图**：新 snapshot base64 写入缓存
- [ ] **Commit tip**：draft → snapshot，写入缓存
- [ ] **Tip preview**：preview 图片写入缓存
- [ ] **项目数据变化**：`useProject` saveSnapshot/saveMessage 更新缓存

### 8.4 性能验证

- [ ] **同 session 返回**：从编辑器返回项目列表 → 零 spinner
- [ ] **同 session 重进**：项目列表点击项目 → Editor 直接渲染，无 spinner
- [ ] **删除清除缓存**：删除项目 → 对应缓存清除

---

## 9. 桌面适配

### 9.1 布局

- [ ] **断点**：窗口 ≥1024px → 桌面模式
- [ ] **flex-row**：GUI（flex-1）+ CUI（w-340px）水平排列
- [ ] **CUI 侧边面板**：始终显示，mode="panel"（静态 flex，非 overlay）
- [ ] **无 viewMode 切换**：桌面端不存在 GUI/CUI 互斥，两者并排
- [ ] **窗口缩放**：缩小到 <1024px → 自动切回移动端布局

### 9.2 鼠标交互

- [ ] **Canvas 鼠标拖拽**：mouseDown/Move/Up 复用 touch 的滑动逻辑（40px 阈值）
- [ ] **Canvas 长按对比**：鼠标长按 200ms → 显示前一张 snapshot
- [ ] **TipsBar 鼠标拖拽**：mouseDown 横向拖拽滚动（>4px 进入拖拽态）
- [ ] **TipsBar wheel**：垂直滚轮 → 水平滚动
- [ ] **拖拽 cursor**：拖拽时全局 `cursor: grabbing`（`[data-dragging]` CSS）

### 9.3 尺寸缩放

- [ ] **CUI 文字**：22 → 14px
- [ ] **TipsBar 卡片**：200 → 156px
- [ ] **TipsBar 缩略图**：72 → 56px
- [ ] **Timeline dots**：缩小 + 贴底（bottom-3）
- [ ] **全局 cursor**：所有 `button, a, label` 有 `cursor: pointer`

---

## 10. 错误处理

### 10.1 AI 请求失败

- [ ] **Tips 生成失败**：错误提示，可重试
- [ ] **Preview 生成失败**：tip 显示 error 状态，点击可重试
- [ ] **Chat 流断开**：Agent 回复中断 → 显示错误信息
- [ ] **视频生成失败**：AnimateSheet 内红色文本 + 重试按钮
- [ ] **视频 503**：显示「视频服务暂时不可用」
- [ ] **视频 500/502**：显示「视频服务出错」

### 10.2 网络

- [ ] **登录网络错误**：显示「网络错误，请重试」
- [ ] **上传失败**：图片上传到 Supabase Storage 失败 → 不阻塞前端操作（fire-and-forget）
- [ ] **持久化错误**：写入失败只 `console.error`，不中断用户操作

### 10.3 Session

- [ ] **Session 过期**：API 返回 401 → 跳转登录页
- [ ] **刷新 token**：Supabase Auth 自动刷新，用户无感

### 10.4 输入

- [ ] **无效图片格式**：上传非图片文件 → 友好提示
- [ ] **超大文件**：客户端压缩处理，不因文件过大卡住

---

## 11. 边缘场景

### 11.1 视频限制

- [ ] **>7 snapshots 视频**：只取前 7 张，不报错
- [ ] **snapshot 无 URL**：新 snapshot 未上传完 → 等待 `onUploaded` 回调后再允许提交

### 11.2 空/少内容

- [ ] **单 snapshot 项目**：无视频按钮，长按对比无效（无前一张）
- [ ] **零 tips**：tips 生成中或全部失败 → TipsBar 显示加载/空状态
- [ ] **空对话**：CUI 无历史消息 → 显示 AgentStatusBar 打招呼文字

### 11.3 并发

- [ ] **并发 tips 请求**：commit 后 4 个 `/api/tips` 并发 → 各自独立完成，不冲突
- [ ] **快速连续 commit**：连续 commit 两个 tip → 不丢数据，tips 正确刷新
- [ ] **重复点击 commit**：连续点击 commit 按钮 → 只执行一次

### 11.4 MOCK_AI 模式

- [ ] **开启 MOCK_AI**：`.env.local` 设 `MOCK_AI=true`
- [ ] **Chat**：返回 mock 文字（不调 AI）
- [ ] **Tips**：返回硬编码 6 个 tips
- [ ] **Preview**：返回原图
- [ ] **Tips 缩略图**：不受 MOCK_AI 影响（已关闭 mock）

### 11.5 图片传输

- [ ] **有 URL 时**：API 调用传 Supabase Storage URL（~100 bytes）
- [ ] **无 URL 时**：fallback base64（刚上传 / Agent 新生图）
- [ ] **Agent 聊天兜底**：无 URL 时额外用 `compressBase64` 兜底 Vercel 4.5MB 限制
- [ ] **前端渲染**：始终用 base64/内存缓存（零延迟显示），不等 URL

---

## 测试环境 Checklist

| 项目 | 正式 (makaron.app) | Preview | 本地 dev |
|------|:---:|:---:|:---:|
| Supabase 连接 | | | |
| AI 生图 | | | |
| Tips 生成 | | | |
| 视频生成 | | | |
| Auth 流程 | | | |
| IndexedDB | | | |
