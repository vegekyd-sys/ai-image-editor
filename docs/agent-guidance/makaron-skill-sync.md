# 对外 Makaron Skill 的同步与验收

主要路径保持 `makaron chat`，自然语言可自动选择 Skill，明确选择用 `--skill`。外部入口只给“需求 → 入口”，制作、依赖和审核由内部 Skill 负责。

## 目录来源

`config/makaron-external-skills.json` 唯一维护主要入口名单、中英文需求摘要及排除项。当前 9 项；明确排除 `motion-design-video`、`source-video-studio`、`website-to-video`、`reference-video-studio`。排除只影响对外主要入口目录。新增 Skill 不会自动扩大这份精选目录。

描述、触发词、tags、素材要求及 inputHint 从对应 `src/skills/<name>/SKILL.md` frontmatter 读取，生成 bundled `references/workflow-catalog.json`。名称必须存在、匹配、builtIn 且可发现，否则失败。

```bash
npm run build:skill-sync
npm run check:skill-sync
```

生成器只替换带标记的目录区域，保留其余手写文档。英文入口同步到 npm canonical Skill、README、旧根入口和 public discovery；中文入口维护在 `docs/agent-guidance/makaron-cli-entry.zh.md`，发布后可同步到本机 Skill。普通 build 的 prebuild 自动生成；CI 在 build 之前先检查，不能靠 build 自动刷新掩盖漏提交。

## 路由证据

CI 检查当前源文件指纹与 `benchmarks/external-skill-routing/accepted.json` 是否匹配，不调用模型。内部 Skill 正文、共享 Skill、路由代码或用例更新会使旧证据失效，需在有预算和授权的环境重新跑：

```bash
npm run test:skill-routing -- --live --env <已有私密环境文件>
```

现有三项实测覆盖长叙事、参考片精确复刻、产品讲解。测试使用实际 Agent prompt、工具 schema 和模型，只允许本地 `read_file` 执行，禁用 provider 执行工具，拦截其余工具。每例最多 5 步、0 重试，用户指令要求在媒体生成前停止；即便模型尝试生成也无法执行。仅有 Agent 推理成本，没有媒体生成或项目写入。它验证路由和规划，不代表完整视频成片验收，也不替代生产 CLI → worker 的全链路测试。

## CI 与发布

`.github/workflows/makaron-skill-sync.yml` 在相关 PR、dev push 及手动运行时检查目录、public 副本和源指纹；跑故障用例、CLI smoke、文档 lint，并检查实际 npm tarball。PR/dev 比较上一个版本：已发包文件变化但版本未升时失败。此 workflow 不发布 npm、不执行付费测试。是否作为分支保护 required check，取决于仓库现有保护设置。

```bash
npm run release:cli:prepare -- --base <合入前提交> --out <临时目录>
# 审查 prepared.json 指定的 tarball，已获发布授权时发布该文件
npm publish <已检查的.tgz> --access public --tag latest --ignore-scripts
npm run release:cli:verify -- --tarball <同一个.tgz> --report <验收.json>
```

prepare 对齐四处版本元数据、检查生成状态和路由证据、运行测试，并逐文件检查打包内容。verify 核对 npm version/latest/SHA1，以全新目录和 cache 从 registry 安装，逐文件对比、检查版本和 chat help，再只读查询线上 built-in 目录确认 9 项可发现。

内部正文变化会使路由证据失效，但不会改变外部目录元数据；npm 已发包内容无变化时无需升版。描述、触发词、输入要求或外部入口变化会更新 package，必须同步升版发布。网站、CLI/npm 和独立插件的发布状态分别记录；此机制不隐式部署网站或发布其他插件。
