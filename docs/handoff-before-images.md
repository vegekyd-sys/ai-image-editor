# Handoff: Home Skill Detail Before-Images UI

## 当前状态

Home skill detail overlay 已支持 `before_images`（示例原图）展示，但用户反馈位置和箭头效果不对。需要下一个 agent 调整。

## 已完成

1. **DB + API**：`home_skills` 表有 `before_images jsonb` 列。`GET /api/home-skills` 和 admin CRUD 都支持。`HomeSkill` 类型有 `before_images?: string[]`。
2. **MP4 cover 支持**：`renderCoverMedia()` helper 检测 `.mp4/.webm/.mov` 后缀自动用 `<video autoPlay loop muted playsInline>`。3 处 cover 统一用它（`src/app/home/page.tsx` 里：卡片网格、hero fly、detail overlay）。
3. **当前 before_images 布局**（待调整）：
   - 渲染在 `renderUploadSlots` 行内（line 397-480），在 "+" 上传槽右边
   - 虚线弯曲箭头（SVG）连接 "+" → before 图
   - 当 `attachedFiles.length === 0` 时显示，用户上传图后隐藏
   - 单张 before 图 52×64，白色 2px border，圆角 8px，轻微旋转
4. **已有数据**：`Mech Suit Up`（`id=64d7e442-7d6e-4882-9479-47bf526a88e7`）有一张 before 图作为测试。其他 skill `before_images` 都是空数组。

## 用户反馈（待修复）

用户画了示意图（带红框 + 红色弯曲箭头），明确要求：
- "+" 在左，before 图在右，箭头连接两者
- **箭头要弯弯向上**，不是向下
- **箭头要更美观**，当前版本不够好看

用户说目前实现"before 图片和箭头位置不对"。具体怎么不对，需要下一个 agent 再跟用户确认。可能的方向：
- 箭头弧度/曲线需要更明显的向上弯
- 箭头可能需要更粗、更有手绘感（像截图示例的红色箭头那样）
- before 图可能要更大、更靠右（贴近封面图右下角）
- 或者整个位置要从 `renderUploadSlots` 行内移到 detail overlay card 的右下角

## 关键代码位置

- `src/app/home/page.tsx:397-480` — `renderUploadSlots` 含 before_images + 箭头渲染
- `src/app/home/page.tsx:440-452` — `renderCoverMedia` 视频/图片自适应
- `src/app/home/page.tsx:1086` — detail overlay 里调用 `renderUploadSlots(template, true)`
- `src/lib/home-skills.ts:11` — `before_images?: string[]` 类型

## 建议起步步骤

1. 问用户再发一次那张带红框 + 红色箭头的示意图（上一次发错了），明确目标布局
2. 如果需要更手绘感的箭头，考虑用真实图片（上传到 Storage `marketplace/ui/arrow.svg`）而不是 inline SVG
3. 如果 before 图要在 cover 图内部右下角（overlay 右下角 absolute 定位），而不是在 upload slots 行里，需要把渲染从 `renderUploadSlots` 搬到 detail overlay card 的 `mkr-detail-slide` 里（当前 line 1076-1095）

## 已知 bug（次要）

- 用户反馈手机端看不到 before 图 —— 现在 before 图在 `renderUploadSlots` 里，mobile 的 upload slots 在 fixed bottom input 区域（`page.tsx:972-975`），应该可以看到，但如果调回 overlay 内部定位，要注意 mobile 的 fixed input 会遮住底部

## Worktree

- 目录：`/Users/tianyicai/ai-image-editor/.claude/worktrees/new-homepage`
- 分支：`worktree-new-homepage`
- Dev server：`npx next dev -H 0.0.0.0 -p 3001`
- 手机访问：`http://<your-local-ip>:3001/home`（IP 用 `ifconfig | grep inet`）
- 测试账号：`test-claude@makaron.app` / `TestAccount2026!`
