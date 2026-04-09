# Handoff: Remotion 渲染引擎 + Workspace Agent

## 当前分支
`worktree-workspace-agent`，最新 commit `08b2fa2`

## 2026-04-09 更新总结

### 已完成

1. **renderStillOnWeb 图片截图**
   - 替代 html2canvas，用 Remotion 官方浏览器渲染器
   - 输出 JPEG，可持久化、生 tips、刷新不丢失
   - 跨域图片自动预取为 data URL（`resolvePropsUrls`）

2. **Remotion Player 动画播放**
   - `design.animation` 存在时渲染 Player（controls + loop + autoPlay）
   - 截 frame 0 作为 poster 存到 snapshot.image
   - Canvas 显示 Player，CUI 显示 inline Player
   - `animatedDesigns` map 驱动 ImageCanvas 的 Player 渲染

3. **Design 持久化（workspace_files）**
   - design JSON 存到 `code/{snapshotId}.json`（Supabase Storage）
   - snapshots 表加 `design_path` 列
   - 刷新后从 workspace 加载 design → 编译 JSX → 渲染 Player/截图
   - userId 从 image_url 推导（避免 auth 时序问题）

4. **MP4 导出**
   - `renderMediaOnWeb`（h264/mp4）浏览器端渲染
   - Save 按钮自动判断：animated design → MP4，静态图 → JPEG
   - 进度显示

5. **Babel standalone 替代 Sucrase**
   - 支持 optional chaining、nullish coalescing 等现代语法
   - 修复 agent 生成复杂代码时的编译错误

6. **去掉 satori**
   - renderHtml 功能被 design 模式完全替代
   - 简化依赖

7. **run_code image_refs**
   - 模型自选带哪些图片，pre-fetch 为 Buffer 放入 sandbox `images[]`
   - 共享 `validateImageIndex` + `fetchImageBuffer` 工具函数

8. **Design 默认策略**
   - 所有视觉输出用 design 模式（React/CSS）
   - sharp 只用于格式转换/metadata

9. **video-design skill**
   - 四问自检框架（剪辑方式、视频 vs 网页、情绪、字幕）
   - 存在 `src/skills/video-design/SKILL.md`

10. **Agent 模型升级**
    - Opus 4.6（`us.anthropic.claude-opus-4-6-v1`）

11. **Bug 修复**
    - MIME 类型不匹配（PNG 标为 JPEG → Bedrock 报错）
    - 跨域黑图（Player + renderStillOnWeb 都需要预取 URL）
    - animation 结构归一化（agent 返回 fps/duration → 包装成 animation）
    - tool-result 后 status 重置（不再停留在"分析图片"）
    - 重复 snapshot（useRef guard + onComplete ref guard）

### 已知问题

- Agent 生成的视频"像网页"（UI 元素、白色底）— video-design skill 已加自检框架但需验证效果
- MP4 导出未实际测试
- agent 修改 `code/xxx.json` 后 session 内不实时更新（需刷新）

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/components/RemotionRenderer.tsx` | Still → renderStillOnWeb，Animation → Player + poster，MP4 导出 |
| `src/lib/evalRemotionJSX.ts` | Babel standalone 编译 Agent JSX |
| `src/components/Editor.tsx` | pendingDesign → snapshot，animatedDesigns，MP4 Save |
| `src/components/ImageCanvas.tsx` | animated design 用 Player 渲染 |
| `src/hooks/useProject.ts` | design 持久化（save + load workspace JSON） |
| `src/lib/agent.ts` | Opus 4.6，image_refs，validateImageIndex，fetchImageBuffer |
| `src/skills/video-design/SKILL.md` | 视频设计自检框架 |
