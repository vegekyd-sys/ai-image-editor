# Makaron 模型更新流程

新增模型、替换供应商、修改能力或计费，都从当前 `dev` 开独立 worktree，按下面的顺序执行。仓库里的模型注册、能力规则和计费配置供网页、Agent、CLI 与 Skill 共用。

## 1. 登记模型和实际路由

- 核对供应商当前启用的模型 ID、请求参数和计费口径。记录 Makaron 对外 ID、默认档位、输入输出限制、实际供应商路由及异步回查入口。保留已有 ID 的含义，明确新增或迁移的档位。
- 图片从 [模型注册](../src/lib/models/index.ts) 和 [图片能力](../src/lib/image-model-capabilities.ts) 更新。视频和音频分别从 [视频能力](../src/lib/video-model-capabilities.ts) 和 [音频能力](../src/lib/audio-model-capabilities.ts) 更新。Agent 对话模型同步检查 [模型目录](../src/lib/agent-models.ts)、[调用路由](../src/lib/agent-model-runtime.ts) 和 [用量费率](../src/lib/billing/token-rates.ts)。
- 用同一套能力定义检查产品选择器、Agent 工具、Skill 和 CLI 的参数与帮助。产品文案补齐四个 locale。涉及 Skill 的改动走 [Skill 同步流程](agent-guidance/makaron-skill-sync.md)。

## 2. 配齐价格和扣费规则

- 按已开放组合核对价格。视频逐一核对分辨率、生成／编辑／续写、无参考和各类参考输入。图片核对尺寸、质量、生成／编辑和计费输入张数。音频区分按次和按实际时长。涉及 `media_pricing` 数据时提交迁移并读回目标行，核对启用状态、版本和各计费维度。Preview 与 Production 按共享数据库对待。
- 复用 [媒体计费](../src/lib/billing/media-pricing.ts)、[图片计费](../src/lib/billing/image-pricing.ts) 和 [图片计费策略](../src/lib/billing/image-pricing-policy.ts)。同一请求的模型、计费数量和价格版本来自这些计费路径。`query_model_prices` 和 `makaron price` 共用 [询价逻辑](../src/lib/model-price-tool.ts)。网页、CLI 和 Skill 统一引用这些计费来源。
- 区分固定价、估算、仅供预检的金额和按实际用量结算。活跃档位缺计费行或计费字段时，补齐并验证后再开放该组合。缺输入时提示缺什么，未知价格明确反馈。用户侧说明使用积分、计费数量和估算范围，Agent 对话用量单独说明。
- **按需查询生成积分。** 用户问费用、预算或要求比价时，Agent 调用询价工具。普通生成直接走既有流程，保留原有余额校验、扣费及高价档确认规则。更新日志、CLI 帮助和 Skill 都沿用这个口径。

## 3. 在同一 Preview 实测网页和 CLI

- 对确切候选提交运行 `pnpm run runner:preview <commit> --skip-domain`，记录提交、部署 ID 和适用的环境差异。按 [发布检查清单](makaron-release-checklist.md) 跑构建、运行时检查和相关测试。
- 网页实际验证模型选项、一次明确问价和普通生成的路由。用受控测试记录实际工具调用，普通生成应有零次询价工具调用，报价应有零次媒体提交。用 CLI 按相同参数覆盖典型案例、边界参数和缺失输入，与网页报价和生成预检对照。
- 对新增供应商或生成能力，按授权做真实生成与回查，确认实际模型、供应商、产物、耗时和积分结算。纯询价改动可用受控路由和只读报价验收。对参考视频计费分别检查输出与参考的计费数量，用总积分比较配置。

## 4. 合入、上线和验收

- Preview 通过后合入 `dev`，按 [发布检查清单](makaron-release-checklist.md#deploy) 从干净的 canonical `dev` 执行生产发布。核对最终提交、正式域名、共享 Dev 和 Preview 配置，重测受影响的网页与 CLI 入口。
- 发布前检查 CLI 包是否要同步。需要更新时先让正式 API 可用，再发布验收过的 tarball。等 registry 的 `latest` 与下载均可用后，验证哈希、全新安装、实际命令和 bundled Skill。验收命令见 [CLI Publish](makaron-release-checklist.md#cli-publish)。
- 记录线上提交和部署、实际报价或生成结果、CLI 发包及全新安装结果，并留好回滚基线。以后会话从本文件进入，实时模型、价格和可用性以当前代码、配置和环境验证为准。
