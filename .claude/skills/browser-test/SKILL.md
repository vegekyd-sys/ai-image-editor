---
name: browser-test
description: E2E browser test using Playwright MCP - upload image, verify tips, preview, commit
allowed-tools: Bash, Read, Glob, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_file_upload, mcp__playwright__browser_wait_for, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_console_messages, mcp__playwright__browser_evaluate, mcp__playwright__browser_press_key, mcp__playwright__browser_tabs
---

# Browser Test — 端到端浏览器测试

使用 Playwright MCP 对本地 dev server 进行端到端测试。

## 前置条件

- `npm run dev` 已启动（如果没有，先启动）
- 测试图片可用：`/Users/tianyicai/testcase/` 目录下的图片

## 测试场景

### 默认（无参数）：完整流程测试

1. **导航**：打开 `http://localhost:3000`
2. **上传图片**：用 Playwright file_upload 上传一张测试图片
3. **等待 tips 加载**：等待 tips bar 出现（观察 snapshot 获取到 tips）
4. **验证 timeline**：snapshot 应该获取到 `Original` 标签
5. **点击 tip**：点击第一个 tip，验证：
   - Timeline 出现第 2 个点（"Draft" 标签）
   - 画布显示预览图或加载状态
   - "Preview" 徽章出现
6. **切换 tip**：点击另一个 tip，验证 Draft 图片更新
7. **Commit**：再次点击同一 tip（或点击 `>` 按钮），验证：
   - "Draft" 变为 "Edit 1"
   - "Preview" 徽章消失
   - 新一轮 tips 开始加载
8. **长按对比**：在 Edit 1 上长按，验证显示 Original（Before）
9. **截图**：保存关键步骤的截图到 `test-results/e2e/`

### `$ARGUMENTS` 参数

- `upload`：只测试上传流程
- `tips`：只测试 tips 加载
- `draft`：只测试 draft/commit 流程
- `navigation`：只测试 timeline 滑动导航
- `full`：完整流程（默认）

## 错误处理

- 如果某步骤超时（30s），截图当前状态并报告
- 检查 console errors（`browser_console_messages`），报告任何 JS 错误
- 如果 dev server 未启动，尝试 `npm run dev` 并等待就绪

## 输出

- 每个步骤的 PASS/FAIL 状态
- 关键步骤截图保存到 `test-results/e2e/`
- Console errors 汇总
