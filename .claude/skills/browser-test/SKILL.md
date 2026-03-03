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

## 截图规则（防卡死）

- **验证 UI 状态一律用 `browser_snapshot`**（返回纯文本无障碍树，体积极小）
- **需要视觉证据时用 `browser_take_screenshot`，必须带 `filename` 参数**存到文件
- **禁止不带 `filename` 截图**——base64 图片会灌入上下文导致 Claude Code 卡死

## 测试场景

### 默认（无参数）：完整流程测试

1. **导航**：打开 `http://localhost:3000`
2. **上传图片**：用 Playwright file_upload 上传一张测试图片
3. **等待 tips 加载**：用 `browser_snapshot` 确认 tips bar 出现
4. **验证 timeline**：用 `browser_snapshot` 确认 `Original` 标签存在
5. **点击 tip**：点击第一个 tip，用 `browser_snapshot` 验证：
   - Timeline 出现第 2 个点（"Draft" 标签）
   - 画布显示预览图或加载状态
   - "Preview" 徽章出现
6. **切换 tip**：点击另一个 tip，用 `browser_snapshot` 验证 Draft 图片更新
7. **Commit**：再次点击同一 tip（或点击 `>` 按钮），用 `browser_snapshot` 验证：
   - "Draft" 变为 "Edit 1"
   - "Preview" 徽章消失
   - 新一轮 tips 开始加载
8. **长按对比**：在 Edit 1 上长按，用 `browser_snapshot` 验证显示 Original（Before）
9. **截图存档**：对关键步骤截图保存视觉证据
   - 使用 `browser_take_screenshot` + `filename` 参数，例如 `filename: "test-results/e2e/step-5-draft.png"`
   - 截图仅用于存档，不用于验证逻辑

### `$ARGUMENTS` 参数

- `upload`：只测试上传流程
- `tips`：只测试 tips 加载
- `draft`：只测试 draft/commit 流程
- `navigation`：只测试 timeline 滑动导航
- `full`：完整流程（默认）

## 错误处理

- 如果某步骤超时（30s），用 `browser_take_screenshot` + `filename: "test-results/e2e/timeout-stepN.png"` 截图当前状态并报告
- 检查 console errors（`browser_console_messages`），报告任何 JS 错误
- 如果 dev server 未启动，尝试 `npm run dev` 并等待就绪

## 输出

- 每个步骤的 PASS/FAIL 状态
- 关键步骤截图保存到 `test-results/e2e/`
- Console errors 汇总
