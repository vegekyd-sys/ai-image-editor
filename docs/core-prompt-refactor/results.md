# 本地验收结果

基线 `3193cd36`；候选分支 `codex/core-prompt-layered-refactor`。测试在 Mac 上运行，Agent 为 Azure `gpt-5.6-terra`。这是本地候选结果，尚未合并或部署。

## 结构与回归

- Core：11,875 → 7,286 字符，减少 38.6%。
- 实际静态 system + 序列化工具：102,578 → 79,407 字符，减少 22.6%。这是字符数，不是计费 token。
- 原 Core 54 段全部可追溯，12 份关键创作正文哈希不变；真实 `read_file` 验证视频、编码指南一次返回完整延迟合同。
- 全量 Vitest：272 个测试文件通过、1 个跳过；1,658 项测试通过、1 项跳过。
- ESLint、UI i18n、Agent startup、video reference workflow 和 TypeScript 检查通过。保留一项既有 unused locale warning。
- 专用 runner `/Users/tianyicai/ai-image-editor-runner-core-prompt` 对代码提交 `90dd149d` 执行 `npm run build -- --webpack` 成功；延迟合同已进入服务端构建产物。构建有 HEIC 依赖静态分析 warning。feature worktree 未生成 `.next`，没有部署。

## 模型行为与速度

41 个场景，累计 156 次真实 Agent 调用；各场景最新双方首动作检查 82/82 通过。媒体与编码执行在此层截获，所以此数字只代表路由、授权和参数约束。完整原始失败保留在本地记录中。

最终普通场景独立运行五轮，交错基线/候选顺序：

| 指标（中位数） | 基线 | 候选 |
|---|---:|---:|
| 首字，四场景各五次 | 4.29s | 3.83s |
| 直接修图，开始至调用生成工具 | 10.18s | 4.76s |
| enhance，开始至调用生成工具 | 11.60s | 14.20s |

首字总体减少约 10.9%；enhance 的工具调用反而慢约 2.6 秒，两版都只读取一次 enhance 指南。问候总耗时也变慢。样本受到缓存、模型和网络波动影响，不能承诺所有请求加速；动作耗时不包含图片/视频生成时间。

## 真实产物

- 同一狗狗原图：局部改色、增强、风格化均生成双方真实图片并检查。第一次候选把领结纹样改变，判失败；补充精确编辑规则后两次候选复测保住黑条纹。有限样本不能证明像素级保真。
- 两版 SeeDance Fast 均交付 10 秒 H.264/AAC 视频，完整解码通过，并检查动作抽帧。浏览器播放进度均达到 10.08 秒，`ended=true`；全部对照图片加载成功。未单独验收声音内容质量。
- 两版捕获的 Node/FFmpeg 代码实际执行，把本地测试视频切成两段各 5 秒的 MP4，完整解码通过。
- 两版 Remotion 原始首稿都有外层 JSX 语法错误；各进行一次保留视觉的受控语法修复后通过验证，实际渲染 5 秒动画，并验证只修改 title prop 可重新出图。这不等同于 hosted Agent 自动恢复通过。原请求没有规定画幅，两版画幅不同，不作为同画幅审美胜负证据。

## 排除与待验收

OpenRouter 复测中一份基线回退 Qwen；Google 直连四次均因地区限制回退 Qwen。都排除出同模型比较，没有把 fallback 当作 Google 成功。

严格人脸身份、多源长视频完整制作、hosted CUI/CLI 的完整执行与恢复、计费、Preview/Export 尚未完成验收。因此目前能确认结构保全、已测路由、部分真实媒体和本地编码交付，不能确认“所有场景效果都不下降”。

所有逐次结果和失败位于被 Git 忽略的 `artifacts/core-prompt/`；可视对照入口为其中的 `review.html`，机器可读摘要见同目录文档的 `results.json`。`node benchmarks/core-prompt/report.mjs` 可从本地证据重新生成。
