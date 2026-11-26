# 参与 Makaron 开发

V 和其他维护者可以直接从仓库接手更新。日常改动向 `dev` 提 PR，项目约定见 [AGENTS.md](AGENTS.md)。使用 Makaron 做图、做视频的命令另见 [CLI README](packages/makaron-cli/README.md)。

## 开始一项更新

1. 明确用户要从哪个入口完成什么操作，以及本次要交付方案、PR、独立 Preview 还是正式发布。承接已有工作时，先读对应 PR 的目标分支、最新提交、评审意见和验收记录。
2. 取最新开发基线（`git fetch origin dev`），从 `origin/dev` 开任务分支。较大的代码或运行时实验用独立 worktree，保留其他人的修改。首次克隆可用 `git clone --branch dev <仓库地址>`，按根目录 [package.json](package.json) 指定的 pnpm 版本安装依赖（`pnpm install --frozen-lockfile`）。
3. 功能 worktree 用于编辑和提交。需要跑 Next.js、完整构建或部署 Preview 时，交给固定 runner，传入已提交的 SHA。同一 runner 会切换提交，多人同时验收时先协调占用。另一台机器可提交并交接 SHA，由已配置环境的维护者执行对应步骤。[Runner 设置与命令](docs/worktree-runtime-runner.md)

## 按改动选择入口和验收方式

| 改动 | 从哪里改、怎样验证 |
| --- | --- |
| 模型、供应商、能力或价格 | 从注册、参数边界和价格行查到网页、Agent 和 CLI。在同一候选 Preview 核对报价、实际路由、生成结果和扣费。纯询价改动覆盖报价与预检即可。具体步骤见[模型更新流程](docs/model-release-workflow.md)。 |
| Agent、工具或 Skill | [系统提示词](src/lib/prompts/agent.md)描述意图、路由和完成标准，[工具定义](src/lib/agent-tools.ts)维护参数与输出合同。改内部 Skill 或对外目录时运行 `pnpm run build:skill-sync` 和 `pnpm run check:skill-sync`。路由证据过期时，在获授权环境运行止于媒体生成前的预检。[Skill 同步与验收](docs/agent-guidance/makaron-skill-sync.md) |
| 编辑器、媒体或导出 | 从 [Editor](src/components/Editor.tsx) 追到[项目持久化](src/hooks/useProject.ts)。保存类改动用同一项目保存后重开；编辑属性改动对照预览和实际导出。图片看成图，视频和音频实际播放，记录覆盖的设备或浏览器。[预览与导出一致性](docs/preview-export-consistency.md) |
| 用户界面或更新说明 | 同一 PR 补齐 `zh`、`zh-Hant`、`ja`、`en`，覆盖错误、提示及无障碍文案，并运行 `pnpm run check:i18n-ui`。需要公告时，在[产品更新记录](src/components/Changelog.tsx)和[语言文件](src/lib/locales/)写清用户现在能做什么。 |
| CLI、MCP 或对外参数 | 对照 [CLI 合同](packages/makaron-cli/README.md)和 [MCP 工具](Makaron_MCP_README.md)，从受影响入口运行真实命令，核对参数、帮助和返回值。每次发布都评估 CLI 包是否需要更新。[CLI 发包与全新安装验收](docs/makaron-release-checklist.md#cli-publish) |

## 提交 PR 与交接

先跑能复现问题或覆盖新行为的最小检查。纯文档改动检查链接、命令和 diff；运行时代码用 `pnpm run runner:test <commit>` 做完整本地检查。需要独立 Preview 时用 `pnpm run runner:preview <commit> --skip-domain`，在该部署走一遍用户入口。Preview 和 Production 共用数据库，项目级 Preview 变量也由各分支共享。实验用单次部署覆盖，保留共享配置和 `git-dev` 别名。[共享环境约定](AGENTS.md#共享环境)

向 `dev` 开 PR（如使用 GitHub CLI，指定 `gh pr create --base dev`）。让下一位维护者能从 PR 回答三个问题：

- **改了什么？** 用户入口、预期结果，以及影响到的网页、Agent、CLI、计费或存量项目。
- **怎么复验？** 候选 SHA、执行命令或页面操作、环境和实际结果。媒体可附可公开的样例。凭据、用户素材、签名下载链接留在授权环境内。
- **接下来做什么？** 写明已完成的阶段、仍待验证的路径和下一步。例如「候选 Preview 已验证保存重开，实体 iPhone 手势待测」。接手者先核对 PR 当前 SHA，再复用对应的证据。

## 任务包含正式发布时

按[发布清单](docs/makaron-release-checklist.md)执行。合入后检查干净的 `dev` 工作目录及待发 SHA，从该目录运行 `pnpm run release:prod`。先核对正式域名、健康状态和受影响的用户操作，再把已验收提交同步到 dev 部署及共享 Preview，核对实际运行时和产物，按清单记录部署 ID 并保留回滚基线。Preview 与生产均使用普通文件增量上传。

涉及 CLI 发包时，先确认依赖的生产 API 可用，再发布已验收的 tarball。从 npm 全新安装，核对 `latest`、包哈希、受影响的命令和 bundled Skill。在 PR 或发布记录中分别写清生产、共享 Preview 和 CLI 的实际结果。无需更新 CLI 时注明原因。
