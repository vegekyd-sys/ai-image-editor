---
name: batch-test
description: Run tips batch evaluation with random images and generate interactive report
allowed-tools: Bash, Read, Glob, Grep
---

# Batch Test — Tips 评测

运行 `scripts/batch-test.mjs` 对 tips prompt 进行批量评测。

## 流程

1. 确认当前 `src/lib/gemini.ts` 中的 TIPS_SYSTEM_PROMPT 和 `src/lib/prompts/*.md` 是否有未保存的改动（`git diff`）
2. 确定版本号：读取 `test-results/` 下已有的版本目录，取最大版本号 +1 作为本次版本（如 v15）
3. 运行测试：`node scripts/batch-test.mjs --version <N>` $ARGUMENTS
   - 默认从 testcase 目录随机 5 张图，每张生成 6 tips + 6 编辑图
   - 输出到 `test-results/v<N>/`
4. 测试完成后，汇报结果：
   - 成功率（N/30）
   - 输出目录路径
   - 提醒用户打开 `report.html` 进行人工评分
5. 等用户评分完成后，如果用户要求分析评分，使用 `/score-review v<N>` 分析

## 参数

- 无参数：使用默认设置（随机 5 张图）
- `--images 3`：指定图片数量
- `--provider google|openrouter`：指定 AI provider
