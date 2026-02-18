---
name: score-review
description: Analyze batch test scores and generate insights for progress.md
allowed-tools: Read, Glob, Grep, Bash
---

# Score Review — 评分数据分析

分析某个版本的评分数据，生成洞察并追加到 `progress.md`。

## 参数

`$ARGUMENTS` = 版本号（如 `v14`、`v15`），或 `latest` 表示最新版本。

## 流程

1. **定位数据**：
   - 读取 `test-results/$ARGUMENTS/scores.json`（如果传了版本号）
   - 如果传 `latest`，找 `test-results/` 下最大版本号目录
   - 同时读取 `test-results/$ARGUMENTS/results.json` 获取 tip 详情

2. **统计分析**：
   - 总平均分
   - 按类别（enhance/creative/wild）平均分
   - >= 8 分数量和占比
   - <= 4 分数量和占比
   - 与上一版本对比（读取上一版本的 scores.json）

3. **模式识别**：
   - 高分共同特征（哪些 tip 类型/关键词得高分）
   - 低分失败模式（人脸变形、idea 无关、执行差等）
   - 用户反馈中的高频关键词

4. **生成洞察**：
   - 列出 "有效的改动"（哪些改进生效了）
   - 列出 "剩余问题"（仍需解决的）
   - 提出 "V(N+1) 改进方向"

5. **写入 progress.md**：
   - 按既有格式追加到 `progress.md`
   - 包含：测试图片、成功率、平均分、高分表、低分表、核心洞察、改进方向

## 输出格式

遵循 `progress.md` 中已有版本的格式，保持一致性。特别注意：
- 高分表包含：分数、Tip名、类别、用户原因
- 低分表同上
- 核心洞察用 `####` 标题分节
