# Makaron 重构优先级审计（2026-08-19）

## 结论

当前最值得优先重构的是 `src/lib/agent.ts`，准确地说，是把其中的 **Agent 工具注册表** 与 **Agent 流式执行引擎** 拆成稳定边界。

这不是因为它单纯“行数最多”，而是因为它同时满足四个条件：

1. 它是全仓变更压力最高的核心文件。
2. 它把生成、分析、Studio、Workspace、Remotion、持久化、计费和执行恢复揉在同一编译单元中。
3. 它已有天然的工具级切割面，能保持外部 API 不变地渐进迁移。
4. 相比直接重构 `Editor.tsx`，它更容易建立无行为变化的自动化验收。

第一阶段的收益主要是可靠性、可测试性和开发吞吐，不应承诺首屏速度、Agent 响应速度或 token 成本立即下降。

## 实施状态（2026-08-19）

本报告的第一阶段已经在 `codex/refactor-audit-20260819` 实施：

- `agent.ts` 从 6,323 行降到 1,422 行，保留原有 `runMakaronAgent` façade 和流式执行引擎。
- 工具侧代码迁入 `agent-tools.ts`，19 个工具各自成为独立 factory。
- `createTools` 从 3,427 行降到 67 行，现在只负责创建共享 scope 和组装工具。
- input-version guard 与幂等 operation ledger 独立为 `agent-tool-guards.ts`。
- 新增工具表面、guard 集合和真实 guard 行为契约测试。
- 旧的源码契约测试改为读取完整 Agent runtime，而不是假设所有实现永远位于 `agent.ts` 单文件。

这次迁移没有改变工具名称、description、Zod schema、provider 路由、计费、持久化或返回值。后续若继续按 image/video/audio/workspace/composition/studio 拆物理文件，可以直接移动已经独立的 factory，不再改动 registry 和 runner。

## 证据

以下统计基于 `dev` 的 `73724a7f`，Git 变更窗口为 2026-05-01 至 2026-08-19。`fix-like` 由提交标题中的 fix / repair / regression / crash / restore 等关键词估算，只用于比较变更压力，不等同于精确缺陷数。

| 候选 | 当前行数 | imports | 期间提交 | fix-like | merge 提交 | 结构信号 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `src/lib/agent.ts` | 6,323 | 51 | 228 | 91 | 29 | `createTools` 3,427 行；`runMakaronAgent` 1,158 行 |
| `src/components/Editor.tsx` | 4,474 | 50 | 148 | 67 | 20 | 69 个 `useState`、42 个 `useEffect`、54 个 `useCallback` |
| `src/app/home/page.tsx` | 2,764 | 33 | 93 | 49 | 9 | 单个 `HomePageInner` 2,674 行 |
| `src/components/AgentChatView.tsx` | 1,891 | 19 | 62 | 22 | 7 | 单个主组件 1,328 行 |

`agent.ts` 的 19 个工具中，最大的执行体包括：

- `run_code`：611 行，execute 509 行
- `generate_animation`：462 行，execute 403 行
- `studio_run`：428 行，execute 339 行
- `preview_frame`：373 行，execute 310 行
- `write_file`：301 行，execute 255 行

这意味着它不是一个“长但聚焦”的文件。工具描述、Zod schema、输入校验、provider 路由、计费、Supabase 写入、后台任务、输出格式化和恢复语义都在同一处演化。

另一方面，生产代码目前只有少数入口直接依赖 `agent.ts`：两个 Agent API route、`agent-execution-runner.ts`、`agentStream.ts` 和 `agentDualWriter.ts`。因此可以保留 `runMakaronAgent` 和 `AgentStreamEvent` 的兼容出口，在内部逐步抽取，不需要一次性修改整个调用链。

当前测试覆盖了大量已抽出的邻接模块，但没有测试直接调用 `runMakaronAgent` 或 `createTools`。所以第一步必须是补契约测试，而不是直接移动代码。

## 建议的目标边界

保持 `src/lib/agent.ts` 作为兼容 façade，新增以下边界：

```text
src/lib/
  agent.ts                         # 兼容出口，最终只负责 re-export / 组装
  agent-runner.ts                  # 模型循环、stream event、终止与 usage
  agent-tool-registry.ts           # 只组装工具，不实现工具
  agent-tool-guards.ts             # input-version 与幂等包装
  agent-tools/
    image.ts                       # generate_image / rotate_camera
    video.ts                       # generate_animation
    audio.ts                       # generate_audio / transcribe_audio
    analysis.ts                    # analyze_image / analyze_video
    workspace.ts                   # list/read/write/delete files
    composition.ts                 # run_code / materialize / preview / publish
    studio.ts                      # studio_run / execution_checkpoint
    shared.ts                      # 输出格式、media resolution、公共校验
```

每个工具的 description、schema、execute 和 `toModelOutput` 必须放在同一个 factory 中，避免“协议在一个文件、真实行为在另一个文件”再次漂移。

已有的 `agent-context.ts`、`agent-execution*.ts`、`agent-terminal.ts`、`agent-model-runtime.ts` 等模块继续复用，不另起一套平行抽象。

## 分阶段实施

### Phase 0：冻结行为契约

先增加 characterization tests：

- 19 个工具名称不变。
- description、Zod input schema 的可观察合同不变。
- durable mutation 工具仍全部经过 input-version guard。
- 幂等工具集合与 operation key 语义不变。
- 典型文本、图片、视频、Remotion、Studio 请求的 `AgentStreamEvent` 顺序不变。
- 计费、退款、Supabase 写入和后台 `after()` 任务各有失败路径测试。

### Phase 1：只拆工具，不改执行语义

按领域移动工具 factory，由 `agent-tool-registry.ts` 统一组装。每个 PR 只迁移一个领域，保持工具 description、schema 和返回值一致。

优先顺序建议：

1. image + analysis：边界较小，用于验证迁移方法。
2. audio + video：覆盖 provider、计费和后台任务。
3. workspace：覆盖文件权限与持久化。
4. composition + studio：最后迁移最高风险的 durable workflow。

### Phase 2：拆执行引擎

把 `runMakaronAgent` 的模型循环、流式 JSON 解析、重试/终止、usage 和事件发射迁入 `agent-runner.ts`。`agent.ts` 继续导出原签名，调用方无需同时迁移。

### Phase 3：再判断是否做动态工具集

只有在工具调用 trace 证明大量请求长期携带无关工具后，才考虑按任务裁剪工具描述以减少 prompt token。工具模块化本身不会自动降低 token，也不应该把这一点算进 Phase 1 收益。

## 预期收益

### 1. 降低跨功能回归

现在改视频生成，往往会进入一个同时包含 Studio、Workspace、音频和 Remotion 的 3,427 行注册函数。拆分后，视频 provider、计费和输出合同可以在自己的模块内测试，减少误伤其他工具的机会。

### 2. 降低并行开发冲突

`agent.ts` 在约 110 天内被 228 个提交触碰，平均每天超过两次；其中还有 29 个 merge 提交。按工具领域分文件后，视频、音频、Studio、Workspace 可以落在不同冲突面，尤其适合 Makaron 当前多条功能线并行推进的节奏。

### 3. 让 durable execution 真正可审计

目前 input-version 和幂等保护通过注册后包装工具对象实现。抽成显式 registry + guards 后，可以用一张测试矩阵证明每个有副作用的工具都经过正确保护，而不是依赖人工记住 Set 中是否漏加名字。

### 4. 缩短 review 与定位时间

新增或修复一个工具时，review 范围从 6,323 行核心文件缩小到一个领域模块。故障可以先按 tool factory 定位，再进入 provider/service，而不是从整个 Agent 主文件开始追踪。

### 5. 为后续成本优化创造前提

工具被清晰分组后，才有条件在有 trace 证据的前提下做按任务加载、描述裁剪或 provider 懒加载。这个收益属于后续选项，不是本次结构拆分的即时结果。

## 不应作为第一优先的候选

### `Editor.tsx`：第二优先

它确实已经形成前端状态巨石：69 个 state、42 个 effect、54 个 callback，还同时管理 GUI/CUI、Tips、视频轮询、音乐、手势、editable design、上传和下载。

但它的切割风险更高：

- iOS/Safari 手势与 History DOM 生命周期高度敏感。
- v1 `project_animations` 与 v2 video snapshot 兼容逻辑仍并存。
- 预览、轮询、CUI 消息和 snapshot 持久化之间存在时序约束。
- 旧 `refactor/editor-agent-first` 分支已经落后当前 `dev` 769 个提交，不适合直接续写或整体移植。

Agent 拆分完成后，Editor 应采用“领域 controller/reducer + characterization tests”的渐进方式，优先切出视频 lifecycle 和 Tips lifecycle；不建议先引入全局状态库重写全部 state。

### `editable-manifest.ts`：不是当前首选

它虽然接近 3,000 行，但近阶段变更次数少、职责相对聚焦。除非 provenance/editable 合同开始频繁出错，否则仅凭行数重构，收益不如 Agent 和 Editor。

## 验收门禁

本重构完成的标准不是“文件变短”，而是：

- `agent.ts` 外部 import 与 `runMakaronAgent` 签名保持兼容。
- 19 个工具的可观察协议与流式事件序列有自动化快照/契约保护。
- 所有 durable mutation 工具有 guard 覆盖矩阵。
- 典型 Agent 场景的现有单测、typecheck、lint 全部通过。
- 至少完成图片、视频、Remotion、Studio 四条真实 Agent smoke。
- Phase 1 不改变工具选择、计费、provider 路由、输出文案和 prompt 大小。
- 最终 `agent.ts` 只保留 façade/组装职责；总 LOC 可以基本不变，但不存在单个 3,000+ 行注册函数。
