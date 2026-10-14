# 外部 Agent 调用内部 Skill：候选交付

2026-10-14。本轮主要入口为 CLI `makaron chat --skill <exact-name>`。

## 改动与权威来源

- CLI worktree：`/Users/tianyicai/.codex/worktrees/external-skill-workflow-contract/ai-image-editor`，基于 `dev`，分支 `codex/external-skill-workflow-contract`。
- 插件 worktree：`/Users/tianyicai/.codex/worktrees/external-skill-plugin-contract/ai-image-editor`，基于 `codex/makaron-plugin-distribution`，分支 `codex/external-skill-plugin-contract`。插件源码尚不在 dev，未在已有插件或 long-video-director-v2 worktree 写入。
- 本机 `.agents/skills/makaron` 保持短入口，新增 internal-workflows reference；`.codex/skills/makaron-cli` 现有入口指向该 Skill，无需重复维护。
- 仓库 npm bundled Skill、旧根 SKILL、README/help、公开静态发现副本补齐对应指导。
- 插件的 shared host-skills 为权威来源；Codex repo-installable 副本同步，Codex builder 显式复制新 reference，OpenClaw builder 原已递归复制。旧 portable CLI Skill/source-map 同步新 reference。

CLI `--skill` 在 `resolveChatSkill` 后插入 `[Active skill: <resolved-name>]`。
内部 `prompts/agent.md` 的合同要求先读 `skills/<name>/SKILL.md`。
这条输入合同无需新增 backend 路由或参数。插件 service 工具当前没有 skill 字段；
使用同一前缀交给 `/api/agent/run`。Atomic 与 native facade 都由外部宿主执行。

## 选择与完成标准

| 用户目标 | 主入口 | 关键证据 |
| --- | --- | --- |
| 长叙事生成 | `--skill long-video-director` | 所需锚点及检查、分段/seam plan、Director Beat Board、逐段分镜图及检查、真实提交引用、分段与全片播放 |
| 精确复刻 | `--skill video-edit`，brief 指定 replication | 完整参考解析、Shot Blueprint、角色 preserve/change、真实参考输入、结构/身份/音频比较 |
| 解释视频 | `--skill explainer-video` | 按视觉载体选择生成式视听或 diagrams/composition，检查画面、旁白/字幕/声音和最终交付；需要 composition 才检查可编辑与导出 |

完整 brief 包含来源角色、时长/比例/语言/音轨、授权预算/重试上限、审核主体、最终交付。
自动审核必须来自用户授权；免逐步确认仍需制作和检查锚点、节奏板、分镜与真实引用。
同项目/run 恢复、最终 MP4 materialize、下载和实际播放纳入 reference。
不能把 selected、loaded、produced、reviewed、submitted、delivered 混为一谈。

## 失败案例作为验收反例

参考项目：`https://www.makaron.app/projects/5c24df3a-f8df-4a1c-87d2-ab71e9d62b6c`。
证据采用用户提供并只读的
`/Users/tianyicai/.codex/worktrees/long-video-director-v2/ai-image-editor/docs/research/long-video-director-v2/two-path-review.md`。
该报告记录只读了 director/anchor/storyboard 文件，未制作/检查人物锚点与分镜、未提交 beat board，
两次视频只引用最初两张头像。按新增外部验收合同，此状态为“已加载指令、工作流执行不完整”，
不能标记完整 Skill 执行成功。Golden prompt 新增对应完整长视频、复刻、解释视频三例。
本轮未向原项目提交新的 run，也未重跑付费视频，因此不声称修复了该项目或证明生成质量提升。

## 验证结果

- 线上只读 `/api/skills?include=internal` 返回三个准确 built-in 名称与相应描述。
- 已安装插件只读 `makaron_discover` 确认现有 service prompt/sourceSnapshotIds 合同与无 skill 字段。
- CLI 本地 mock smoke 通过，新增三个实际 chat 调用确认同一 projectId、完整原 brief、准确 Active skill 前缀且未安装 marketplace Skill。
- 插件 adapter/portable/Codex/OpenClaw 回归共 38/38 通过；三种 service 前缀与 snapshot IDs 原样传递、同 request ID 重放不重复提交；提取包启动、reference 字节与归档可复现校验通过。
- CLI 文档 lint、Skill frontmatter validator、公开 discovery --check、diff whitespace 检查通过。
- npm 本地 pack 的 reference 包含性另行核验；没有 npm registry 安装或发布。

独立插件 worktree 首轮打包缺两张已有的生成 craft 图片副本，它们受仓库 ignore 规则影响。
本轮在该 worktree 从 canonical craft 来源恢复缺失副本后通过；没有修改内部 Skill。
这不是本次 reference 改动引入的缺失。全新 checkout 的插件打包仍需恢复这些现有生成资产，
不可用本轮通过推断该历史 packaging 边界已解决。

## 状态与剩余限制

候选文档、help 与调用/分发验证完成；本机 CLI Skill 更新属于本次文档范围。
未部署、未发 npm、未更新已安装插件 cache，也未改内部自然语言路由或 `src/skills/long-video-*`。
外部 Skill 是启动/验收指导，不能强制内部 Agent 执行阶段。read_file 与成功 run status 都不能证明
完整制作；是否满足新版内部执行门禁、实际 storyboard/anchor 送入供应商、跨段音画质量，
仍需另一条内部工作流候选合并后，在授权预算内做真实端到端验收。
两分支基础不同；合入时先采用 dev 上 CLI 候选，再将插件 shared host/reference/build 改动迁入
插件权威源，刷新其 byte-exact CLI 副本和 source-map，不盲目整体合并旧插件分支。
