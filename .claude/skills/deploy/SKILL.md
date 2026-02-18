---
name: deploy
description: Build and deploy to Vercel with safety checks
allowed-tools: Bash, Read
---

# Deploy — 构建并部署到 Vercel

## 重要安全规则

**必须获得用户明确同意后才能部署到线上。** 如果用户只是说"部署吧"，可以执行。如果是其他上下文中提到部署，先确认。

## 流程

1. **Pre-flight 检查**：
   - `git status`：确认没有未提交的关键改动（提醒用户是否需要先 commit）
   - `npm run lint`：确认无 lint 错误
   - `npm run build`：确认构建成功

2. **确认环境变量**：
   - 检查 Vercel 上的环境变量是否与本地 `.env.local` 一致（特别是 `AI_PROVIDER`）
   - 如果不一致，提醒用户

3. **部署**：
   - `vercel --prod`
   - 等待部署完成，输出 URL

4. **部署后验证**：
   - 输出部署 URL
   - 提醒用户在手机上测试核心流程：上传 → tips → 预览 → commit

## 回滚

如果用户要求回滚：
- `vercel rollback` 回到上一个部署
- 或 `git revert HEAD && vercel --prod` 回滚代码并重新部署
