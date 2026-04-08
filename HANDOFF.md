# Handoff: Remotion Design 图片导出

## 当前分支
`worktree-workspace-agent`，所有代码已 commit（`de19293`）。

## 当前状态

### 已完成
1. **evalRemotionJSX 简化** — Agent 写完整 `function Design(props) { return ... }`，去掉了所有 auto-return regex
2. **agent.ts tool description** — 更新为要求 agent 写完整函数 + 示例
3. **html2canvas 截图位置** — 从 `left:-9999px`（黑屏）改为 `opacity:0`（浏览器正常渲染），截图前临时 `opacity:1`
4. **CUI inline** — 截图作为 `msg.image` 显示（不用 Remotion Player）
5. **Canvas** — 截图作为普通 snapshot 图片显示
6. **DesignPayload 类型** — 共享在 `src/types/index.ts`
7. **错误处理** — 编译失败通过 onError 显示在 CUI 消息里（不是浮动 div）

### 测试结果
| 测试 | 结果 |
|------|------|
| 简单纯色 design（红底 HELLO、蓝色 MAKARON）| ✅ 截图正确，CUI + Canvas 显示正常 |
| 复杂带照片 design（杂志封面 10K chars）| ⚠️ 文字/排版渲染正常，但照片不显示（黑底+文字） |
| Tips 生成 | ✅ 基于截图正常生成 |
| 编译失败 | ✅ 错误显示在 CUI 消息里 |

### 当前 Bug：复杂 design 照片不显示

**症状**：Agent 生成的杂志封面代码中，文字、渐变、标签都正确渲染，但背景照片（`<img src={props.snapshotUrl}>`）不显示。

**已知信息**：
- `props.snapshotUrl` 通过 `design.props` → Player `inputProps` 传入
- 图片等待逻辑已有（5s timeout for img.onload）
- 之前 inline Remotion Player 模式下照片能正常显示

**可能原因**：
1. Player 在 `opacity:0` 模式下图片加载行为不同
2. `props.snapshotUrl` 是 base64 还是 URL — 如果是 base64 可能太大
3. html2canvas 的 `useCORS` 处理跨域图片有问题
4. 图片在 5s timeout 内没加载完

**排查方向**：
- 当前 RemotionRenderer 已改为 debug 可见模式（`zIndex: 9999`，注释掉了 opacity:0）
- 下一步：发一个带照片的 design，用 Playwright 截图看 Player 里照片是否显示
- 如果 Player 里照片显示正常 → html2canvas 捕获问题
- 如果 Player 里照片也不显示 → props 传递或图片加载问题

### Debug 状态
`RemotionRenderer.tsx` 当前是 **debug 可见模式**（`zIndex: 9999`，`opacity` 注释掉了）。
修复完需要改回 `opacity: 0; zIndex: -1`。

## 关键文件

| 文件 | 状态 | 作用 |
|------|------|------|
| `src/lib/evalRemotionJSX.ts` | ✅ 重写 | 简化：直接 transpile 完整函数，无 auto-return |
| `src/components/RemotionRenderer.tsx` | 🔧 debug 模式 | Player 渲染 + html2canvas 截图 |
| `src/components/Editor.tsx` | ✅ 已改 | onDesign → pendingDesignMsgIdRef → onComplete 设 msg.image |
| `src/components/AgentChatView.tsx` | ✅ 已改 | inline Player 注释掉，CUI 显示截图图片 |
| `src/lib/agent.ts` | ✅ 已改 | tool description 要求 agent 写完整函数 |
| `src/types/index.ts` | ✅ 已改 | DesignPayload + Message.design 类型 |

## 下一步

1. **排查照片不显示** — 用 debug 可见模式看 Player 渲染结果
2. **修复后恢复隐藏** — `opacity: 0; zIndex: -1`
3. **commit + 测试全链路**
4. **后续：Remotion Player 展示 + 视频导出**（另一个 milestone）

## 测试方法

1. `npm run dev`（worktree 目录）
2. 登录 test-claude@makaron.app / TestAccount2026!
3. 进入项目 `448e04be-70cd-4709-9680-569c3dba8c24`
4. CUI 发送：`用 run_code design 给 @1 做一张杂志封面，用系统字体`
5. 观察：
   - 如果 debug 模式：Player 会覆盖在页面顶层显示
   - 截图完成后 Player 移除
   - CUI 显示截图图片 @N
   - Canvas 显示截图图片

## Plan 文件
`/Users/tianyicai/.claude/plans/encapsulated-leaping-globe.md`

## MOCK_AI 状态
`.env.local` 中 `MOCK_AI=true`（节省 tips API 费用）。测试生图需要改回 `# MOCK_AI=true`。
