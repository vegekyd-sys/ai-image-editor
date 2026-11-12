# Seedance 2.5 Flash 候选接入核查

2026-11-12；候选 `B-20261112-seedance25-flash`。

## 当前结果

用户已授权独立 worktree 接入，未授权合入、上线或更换默认模型。已从现场 fetch 后与 origin/dev 一致的 `fbc7daac8abf9dae4fd71ffc69304a8e6cae5b18` 创建 managed worktree：

- Worktree：`/Users/tianyicai/.codex/worktrees/seedance25-flash/ai-image-editor`
- 分支：`codex/seedance25-flash`
- 阶段：`blocked_api_not_open`，业务代码尚未接入，`code_ready=false`、`live_verified=false`。
- 费用：$0；没有提交任何生成 POST，没有真实 Flash 样例。

BytePlus 创建视频任务的官方正文已发布 Flash 公告，但明确写明 **2026-11-15 14:00（UTC+8）开放在线体验与 API 调用**。今天的发布公告不等于现有账号已经可调用。公开价格页已经补充精确 ID 和价格；公开模型列表及任务参数明细尚未补齐 Flash 的完整能力合同。不能将普通 2.5 的全部限制继承给 Flash。

## 已实际读取的一手证据

| 来源 | 观测 |
| --- | --- |
| [BytePlus 创建视频任务](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api.md) | 浏览器实际正文与下载的完整 Markdown 均写明 11 月 15 日 14:00 开放。页面中的现有示例仍为普通 2.5 ID。 |
| [BytePlus 价格](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing.md) | Flash 精确 ID 为 `dreamina-seedance-2-5-flash-261115`；480p/720p，无视频输入 $7.00/百万 token，有视频输入 $4.30/百万 token；1080p、4K、离线推理均列为不支持。 |
| [BytePlus 模型列表](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list.md) | 本次完整正文尚无 Flash 条目，不能确认其全部输入、时长、参考数、并发限制。 |
| [BytePlus Flash 模型详情](https://ai.byteplus.com/ark/region:ap-southeast-1/model/detail?name=dreamina-seedance-2-5-flash) | 实际浏览器显示开发者协议接受界面，未接受新协议。该页面没有被算作已读到能力正文。 |
| [EvoLink 模型目录](https://evolink.ai/models) 与 [changelog](https://evolink.ai/changelog) | 实际目录显示 128 个模型，无 Seedance 2.5 Flash；changelog 也未列 Flash。普通 Seedance 2.5 不能作为替代证据。 |
| fal 官方完整分页 API 目录 | 本次读完 1,470 个精确 endpoint ID，无 Seedance Flash。全部 ID 和分页响应元数据保存在 `fal-catalog.json`。 |

价格页的官方参考样本：16:9、5 秒、无视频输入，Flash 480p 约 $0.34、720p 约 $0.76；普通 2.5 同条件约 $0.514/$1.156。因此官方示例约便宜三分之一。这是 BytePlus 公开参考价，既不是 EvoLink 报价，也不是 Makaron 实测扣费；速度尚无本任务实测。

完整公开正文、HTTP Date/Age/ETag/Last-Modified（实际返回时保留）及全量 fal ID 在 `evidence/seedance25-flash-20261112/`。没有保存凭据。

## 现有接入核对与恢复入口

- 创建前检查了全部现存 Git worktree 分支和当前 open PR，未发现 Flash 重复实现。
- `src/lib/video-model-capabilities.ts`：普通 `seedance-2.5` 和 `seedance-2.5-eco` 已存在；当前公共 2.5 入口默认选 Eco。Flash 必须有独立精确 ID，不能被该 Eco 归一化规则改写。
- `src/lib/skills/create-video.ts` → `src/lib/evolink.ts`：现有 2.5 生成走 EvoLink。Flash 当前未在 EvoLink 文档化，不能凭后缀拼造 provider ID。
- `src/lib/seedance.ts`：旧原生实现默认走中国火山方舟，使用 `SEEDANCE_API_KEY` 与普通 2.0 Fast。其凭据的存在不证明新加坡 BytePlus Flash 的账号权限；不能改全局 `SEEDANCE_MODEL` 冒充独立接入。
- 当前已配置 EvoLink、fal、旧火山 Seedance 凭据；未发现专用 BytePlus/ARK 凭据。只检查是否配置，没有输出或复制值。
- Flash 与另一个用户限定 EvoLink 原生 4K 的 `B-20261024-seedance25-4k` 分开跟踪。Flash 官方当前不支持 4K；不把超分输出称为原生 4K。

## API 开放后的执行与验收

用户的接入授权已保留，不重复询问是否开始。雷达在本候选重新读取精确 API、价格与分发渠道后，满足可调用/账号/许可条件时复用此 worktree 继续；API 尚未开放期间不展示可选的虚假模型。

1. 核对完整 Flash 合同与实际账号可用性。优先复用现有可用供应商；需要新采购、新协议或新账号时记录真实缺口。
2. 接入后端、独立能力/路由、Agent 工具、GUI/CLI/MCP、四语文案、计费预检/结算/退款和幂等。保留现有默认及 fallback；验收时显式 Flash 且不允许隐藏 fallback。
3. 非敏感专用项目中验证文本、mascot 参考图及文档明确支持的其他模式；与现有 2.5 同素材比较可查看输出、耗时、费用、尺寸/时长/音频、保存及重开、GUI 和 CLI 实际用户路径。
4. 沿用本会话已授权试验额度（目标 $5、合计上限 $10），首次按实际供应商单价估算，付费 POST 结果不明仅查询原任务。完成后统一报告证据，不以构建代替真实生成。

本轮只完成来源核查和候选落盘。未合入、未部署、未发包，默认模型未变。
