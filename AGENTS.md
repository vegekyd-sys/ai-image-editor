# Makaron 开发指南

Makaron 是图片、视频、音乐与动态设计产品。用中文协作；只读取本次任务涉及的代码和资料。

## 开发与定位

较大代码/运行时实验用独立 worktree，保留他人改动；设计换方向前保留对比版本。执行和授权沿用全局规则。媒体相关改动检查实际可查看/播放的产物，发布按已有 release 流程验收并报告实际完成阶段。

| 任务 | 入口及关系 |
|---|---|
| 编辑器状态与交互 | `src/components/Editor.tsx` 组织 GUI/CUI、消息与 snapshots；持久化入口 `src/hooks/useProject.ts` |
| 上传、永久媒体与缩略图 | `src/lib/supabase/storage.ts`；结合 useProject 检查保存和重新打开 |
| Agent 意图、工具和请求 | `src/lib/prompts/agent.md`、`src/lib/agent.ts`、`src/app/api/agent/route.ts` |
| 图片/视频模型能力 | `src/lib/model-router.ts`、`src/lib/video-model-capabilities.ts` |
| 计费 | `src/lib/billing/credits.ts`，结合对应 API 的预检和扣费调用 |
| 多语言 | `src/lib/i18n.tsx`、`src/lib/locales/` |
| 验证/发布命令 | 按改动选择 `package.json` scripts；发布入口 `scripts/makaron-release-check.mjs`、`scripts/makaron-release-prod.mjs` |

## 共享环境

- Production 与 Preview 按共享数据库对待；本地/Preview 不自动意味着数据隔离。生产配置及实际数据访问在执行前核对。
- 项目级 Vercel Preview 变量由所有 worktree 共享。Snapshot 实验用单次部署的 `-e REMOTION_SNAPSHOT_ID=...`，不覆盖共享 Preview 变量；兼容性通过前不占用共享 `git-dev` alias。
- `MEDIA_SANDBOX_SNAPSHOT_ID` 和 `REMOTION_SNAPSHOT_ID` 是独立合同。晋升共享 Snapshot 前，用当前分支和未包含新合同的旧应用分别验证真实 `makaron chat → run_code → preview_frame`；生产晋升另需对应授权。
- 写 Vercel 环境变量用不附带换行的输入（如 `printf '%s'`），不要用 `echo`。不把凭据放进日志或文档。
- Qwen/ComfyUI 是长期租赁 Vast 服务，固定域名 `https://comfyui.makaron.app`。普通 cleanup 不得 stop/destroy/recycle/换模板或切换生产实例。运维前查 `docs/ops/vast/ensure-makaron-qwen-vast.sh` 并核实实际实例；不可依据历史实例 ID 操作。停止/替换需明确批准、替代服务与域名/env 验证，以及无 fallback 的真实 Qwen/Pony/WAI 输出。

## 产品合同

- 产品 UI 同一变更补齐 `zh`、`zh-Hant`、`ja`、`en`，包括状态、错误、按钮、tooltip、placeholder 和无障碍文案。生成正文遵循用户要求的语言。i18n baseline 只保留历史债务；仅品牌名/技术 token 可使用相邻 `i18n-ignore`。
- System prompt 描述意图、路由和完成标准；工具描述自包含参数与输出合同，避免两处重复。模型、供应商、价格和时长限制以当前代码/配置为准。
- editable 合同只属于 `run_code` design 链路；普通生成图片或供应商视频不强加 editable 要求。涉及可视化编辑属性时，保持 Proxy、`DesignOverlay.applyStoredOffsets` 与 web-renderer 同步，使 Preview 与 Export 一致，按需读 `docs/preview-export-consistency.md`。
- Design snapshot 先取得 poster 再加入时间线；持久化不能覆盖已有 DualWriter `message_id`。GUI/CUI 互斥渲染，保持 iOS 手势路径。
- 外部 clip 合同为 `source_url + start + end + description`（秒，数组为剪辑顺序）。在输入边界兼容旧字段，丢弃上游 provider identity；内部时间字段不因此要求数据库迁移。

## 项目记忆与历史资料

长期项目上下文先查 `~/.codex/wiki/projects/makaron/index.md`，其 `memory/MEMORY.md` 是项目记忆总索引，按主题恢复架构、既有决策和踩坑。Codex 跨会话另查 `~/.codex/memories/MEMORY.md`。已有相关背景直接沿用。

需要过去的实验依据时，定点搜索 `progress.md` 或 `docs/agent-guidance/legacy-claude.md`；旧 Codex 差异见 `docs/agent-guidance/legacy-agents.md`。其中的模型、价格、实例和实验状态不是当前事实。新功能知识更新到对应文档，不逐次堆入常驻指南。
