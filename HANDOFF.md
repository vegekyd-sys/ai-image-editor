# Handoff: Remotion Player 集成

## 当前状态

worktree-workspace-agent 分支，所有代码已 commit。

### 已完成

1. **Workspace Agent 全链路**（已上 prod）
   - workspace_files 表 + Supabase Storage
   - 5 个 Agent 工具：list_files, read_file, write_file, delete_file, run_code
   - run_code：sharp + satori + JSZip + saveToWorkspace + vm 沙箱
   - Skill 创建 → 持久化 → 使用 → 打包 zip 全流程
   - CUI 改进：FileRefChip、代码折叠、run_code 指示器
   - 设计思维 prompt（agent.md Workflow 段落）
   
2. **Remotion 集成**（代码写好，未测通）
   - 安装：remotion, @remotion/player, @remotion/media, sucrase, html2canvas
   - `src/lib/evalRemotionJSX.ts`：sucrase 转译 JSX → React.createElement + Remotion scope 注入
   - `src/components/RemotionRenderer.tsx`：@remotion/player 渲染 + html2canvas 截图
   - `src/lib/agent.ts`：design 返回类型 + SSE 事件 + ctx.__pendingDesign 机制
   - `src/lib/agentStream.ts`：onDesign callback
   - `src/components/Editor.tsx`：pendingDesign state + RemotionRenderer 挂载

### 当前 Bug

**问题**：Agent 返回 `{ type: 'design', code: 'JSX...' }` 后：
- Snapshot 里黑屏空的
- CUI inline 里也没出现 Player

**可能原因**（待排查）：
1. `onDesign` callback 可能没被触发——检查 server 日志有没有 design SSE 事件
2. `ctx.__pendingDesign` 可能没被正确设置——检查 agent.ts 的 design 分支
3. RemotionRenderer 可能挂载了但渲染失败——检查浏览器 console 错误
4. Editor.tsx 里 pendingDesign 触发了但 RemotionRenderer 位置在最底部，可能渲染不可见

**用户建议的方向**：
- 先做第一步：**CUI inline 显示 Remotion Player**（不急 snapshot）
- 跟 CUI 里的 inline 图片/视频一样的位置
- 确认 Player 能正确渲染 Agent 的 JSX
- 然后再做 snapshot 集成

### 测试方法

1. 启动 dev server：在 worktree 目录 `npm run dev`
2. 进入项目：`http://localhost:3000/projects/448e04be-70cd-4709-9680-569c3dba8c24`
3. 在 CUI 发消息：`use run_code with design type: make a title card with dark background and "THE MOMENT" title`
4. 检查 server 日志：`tail -f` dev server output，看有没有 `design` 相关日志
5. 检查浏览器 console：有没有 sucrase/Player 相关错误

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/lib/evalRemotionJSX.ts` | sucrase JSX 转译 + Remotion scope 注入 |
| `src/components/RemotionRenderer.tsx` | @remotion/player 渲染组件 |
| `src/components/Editor.tsx` | pendingDesign state + RemotionRenderer 挂载（第 3228 行附近） |
| `src/lib/agent.ts` | design 返回类型处理 + ctx.__pendingDesign + SSE 事件 emit |
| `src/lib/agentStream.ts` | onDesign callback 定义 |

### 排查顺序

```
1. Server 端：agent.ts run_code execute 是否返回了 type: 'design'
   → 看 server log 有没有 "result type: object, keys: type,width,height,props,code"

2. Server 端：tool-result handler 是否 emit 了 design SSE 事件
   → 检查 ctx.__pendingDesign 是否被设置
   → 检查 yield { type: 'design', ... } 是否执行

3. 前端：agentStream.ts case 'design' 是否 match
   → 在 onDesign callback 加 console.log 确认

4. 前端：Editor.tsx pendingDesign 是否被设置
   → 在 setPendingDesign 后加 console.log

5. 前端：RemotionRenderer 是否渲染
   → 检查 evalRemotionJSX 是否成功编译
   → 检查 Player 是否挂载
   → 检查浏览器 console 有没有 React/Remotion 错误
```

### 下一步 Plan

**Step 1**：修 bug，让 design 在 CUI inline 里正确显示为 Remotion Player
**Step 2**：用户确认后，加"Save as snapshot"功能
**Step 3**：测试动画（animation 参数）
**Step 4**：移除 satori

### 记住的原则

- **Agent 最大自由**：不封装 helper，给通用能力
- **设计师思维**：先看图再设计，针对这张图做专属决策
- **Remotion 精神**：Agent 写 React JSX，浏览器真实渲染
- **两项目统一约定**：跟 video-maker 同方案（sucrase + Player）

### Plan 文件

`.claude/plans/tender-snuggling-whisper.md`

### Memory 文件

关键 memory：
- `workspace-agent.md` — 完整架构和代码状态
- `design-principles.md` — Agent 最大自由、设计思维、Remotion 精神、两项目协作
- `run-code-vision.md` — run_code 愿景和 WOW 场景
