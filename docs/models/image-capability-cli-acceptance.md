# CLI Chat 实图验收计划

用户于 2026-10-08 要求重要 case 到最终图片，全部通过 Makaron CLI Chat 路线测试，通过后才考虑上线。本轮候选服务为独立 runtime runner，图片生成入口只使用安装的 `makaron chat`；不使用 direct edit、供应商直调或替换图片 execute。

完整清单在 `scripts/image-capability-cli-acceptance.mjs`，运行前保存 `test-results/image-capability-cli/manifest.json`。C01–C50 覆盖默认文生图/编辑/多图/中文排版、超宽超长比例、分辨率、透明/抠图/冲突放宽、所有显式模型和历史别名、NSFW 文生图/编辑/跨轮/输入上限、16/17/14/15/9/10/3/4 输入边界与成人语义；C49 以原项目的真实 V 图片重现 8:1 请求，C50 检查人脸增强默认路由。每项只提交一次；已知 run 从断点继续轮询，不自动重发未知付费结果。常规批次最多三个并发，原项目复现另用两项独立测试。

正向验收为真实 Agent、供应商、Storage、Snapshot 与 Credits。逐项保存 run 结果、实际 tool input/output、图片事件、账单与 CLI 重新读取项目媒体的结果，完整解码最终图片并检查尺寸/alpha。技术通过和人工视觉通过分别记录。安全纹理配合 NSFW 标记只能证明路由与执行，不证明所有成人语义能通过主模型审核；C40 单独检查真实成人服装语义。

负向计费/供应商故障用同一 CLI Chat 到候选服务，单独测试进程通过 `scripts/image-capability-cli-faults.mjs` 注入只读价格/余额响应或供应商失败。不得修改共享数据库、账户余额、价格表、供应商密钥或线上环境。负向测试明确标记为故障注入，不能计为真实供应商出图。检查没有图片扣费、没有重新提交与跨供应商重试。

原 R14 的 GUI 手选覆盖和 R20 的 Tips preview 不经过 CLI Chat，R21 prompt 来源及 R22 构建也不是聊天出图行为；它们继续由各自自动化回归验证，单独记录，不能把 CLI Chat 成功称为这些 GUI/结构合同的端到端验收。

生成测试项目和账单是本轮授权验收的产物；原用户项目不修改。没有合并、部署或晋升共享 Preview alias。

## 正向真实结果（2026-10-08）

候选服务代码 `ca8df405`（功能提交 `bb0c94e1`），安装的 CLI 调用 `MAKARON_URL=http://127.0.0.1:3047 makaron chat --project auto --agent-model gpt-6-luna -b --json`，后续通过 `responses get --wait --json` 和 `project media --json` 完成验收。使用已有本地有效供应商配置与共享数据库中的新建测试项目；这不是生产部署后的验收。

50 个正向 case 全部完成：47 项实际得到一张供应商图片，完成完整解码、保存的 Snapshot 与 URL 对照、CLI 再读取项目媒体、实际图片模型与一次图片结算核对。47 项技术链路通过；人工查看全部最终图片后，44 项同时通过视觉验收，3 项有内容质量偏差。没有用直调供应商或图片桩代替正向 CLI Chat。

| 分类 | Case | 结果 |
| --- | --- | --- |
| 原项目超宽复现 | C49 | NB2.1，2928×352，V 在左侧，右侧渐变留白；保存和再读取通过 |
| 超宽/超长 | C05–C08 | 2928×352、352×2928、2064×512、512×2064，实际供应商输出 |
| 透明与冲突 | C12–C14、C27、C38、C41、C48 | 真实透明/抠图正常；透明 8:1 保留比例并说明不透明；Spicy 冲突参数放宽后实际出图 |
| 未知/旧 ID | C15–C18、C47 | 未知/退役 Auto Flare 优先；旧 qwen 直接 Spicy |
| NSFW | C24–C28、C40、C42、C45–C46、C48 | 文生图、编辑、冲突、显式/隐式跨轮均 Spicy；C40 为主 Agent 判断的非露骨成年内衣时尚题材 |
| 参考边界 | C34–C39、C43–C45 | 除 C37 外实际出图；C35 16输入、C36 17输入放宽、C43 NB14输入、C44 Wan9输入、C45 Spicy3输入有实物 |
| 未交付 | C09、C10 | NB2.1 的 2K、4K 请求返回结果未知错误；各一次工具调用，无图片费用，不自动重发 |
| 路由/参考取舍失败 | C37 | Agent 先把15输入截为14，再选NB2.1；没有按“保留全部参考优先”选Flare，随后供应商结果未知，无最终图 |
| 内容质量偏差 | C11、C43、C44 | 1K茶壶偏灰绿/米色；NB14输入横幅添加中文广告文字；Wan9输入残留“REF 6” |

C44 首次使用的测试 PNG 有 alpha 通道，被 Wan 提交前校验明确拒绝，未提交供应商。将同一安全测试图编码为无 alpha PNG 后重新通过 CLI Chat 验证，Wan 正常出图。首次失败记录单独保留在 `C44-initial-invalid-fixture/`，包括其 1 credit Agent 费用，不隐去失败。

注意：`completed` 仅表示 Agent 本轮已终止，不代表图片交付成功；C09/C10/C37 的最终图片为空，验收仍判失败。部分 case 在主 Agent 阶段已根据能力表调整输入数量或尺寸，验收记录的 `coverageNotes` 明确它们不证明“原始冲突参数到共享规划”的分支；C27、C48 等原样参数 case 单独覆盖该分支。

## 负向 CLI Chat 结果

N01–N05 全部通过：余额不足在 Agent 启动前拒绝，缺图片价格在图片提交前停止，供应商审核拒绝、提交结果未知超时、空输出各仅有一次被测试进程截获的供应商 POST；没有图片扣费、重发或跨供应商尝试。四项已进入真实主 Agent 的 case 正常报告失败并结束；这不等于故障被修复或供应商可用。注入配置只存在于独立本地 Next 进程，不修改数据库/线上环境，完成后清空并停止该进程。

已知 Makaron 账单合计 400 credits，含 C44 首次无效素材的 1 credit 和负向测试的 Agent 费用。此金额不代表供应商总成本；C09/C10/C37 未能取得供应商完成结果与成本，不能声称供应商没有收费。它们均没有 Makaron 图片扣费，原请求没有自动重发。

## 全量自动化与查看入口

本轮重新执行全量 `npm test`：326 个 test file、2151 项 test 通过，1 个跳过，日志 `/tmp/image-capability-cli-full-tests.log`。生产应用代码未因这轮测试变更；上轮 TypeScript、CLI smoke、production build、i18n、Agent startup 检查仍对应同一功能代码。R14 GUI 手选覆盖、R20 Tips preview、R21/R22 结构合同由原有自动化覆盖，不能称为本轮 GUI 实图验收。

本地 `test-results/image-capability-cli/report.html` 为图片验收页，带通过/失败筛选、完整请求与实际工具输入、图片原文件和项目入口。`acceptance-results.json` 汇总各项判定；`Cxx-receipt.json`、`Cxx-evidence.json` 保留 run、账单、工具与持久化证据。`contact-sheet-1.png` 至 `contact-sheet-5.png` 是已查看的最终图片联系表。生成图片与带项目数据的运行记录不提交 Git。

本轮结论：已有核心路径的真实出图证据，但尚未全部通过；2K/4K 不确定结果、C37 主 Agent 提前丢参考、三项内容质量偏差应在上线判断时明确处理。没有替用户上线。
