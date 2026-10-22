# Kling 4.0 候选接入、mascot 原片与 Retake 实测

日期：2026-10-22。分支：`codex/kling4-mascot-candidate`，基线 `origin/dev` 的 `c0d7889d`。本轮仅本地候选；未推送、合并、部署、发布 npm 或公开发布媒体。

## 结果

同一张正式 Pixel Wizard / Spark 设定图、同一份 5 秒脚本分别生成 Kling 4.0 标准版、**fal H3 Max（非 Turbo）**、Seedance 2.5 Eco 原片。三组均通过 Makaron CLI → Agent → 指定供应商生成、视频快照持久化和项目媒体重新读取。Eco 使用 480p 基础生成后自动超分 720p。

同一条 Kling 原片再做三个 Retake，目标为只将源片 1–4 秒的 Spark 从洋红/青色改成金色，保留其余内容及整段原声。每组经 `inspect_retake` 查看实际帧，再由 Agent 按该模型输出时钟写最终提示词。因此原片是同提示词比较，Retake 是同源、同目标的产品链路比较，**不是三个供应商完全相同提示词的盲测**。

| 维度 | Kling 4.0 标准版 | fal H3 Max | Seedance 2.5 Eco |
| --- | --- | --- | --- |
| 原片 | 角色轮廓和动作清楚，节奏直接 | Spark 形态更接近品牌设定，材质和光影丰富 | 角色可识别，但城市扩展到卡片外，空间指令有偏移 |
| 原片尺寸 / 视频时长 | 1280×720 / 5.0417s | 1344×768 / 5.1667s（含音频容器 5.184s） | 1280×720 / 5.0417s（含音频容器 5.056s） |
| Retake 改色 | 金色完成，但重画光门：放大、内部变黑，原有城市受损 | 增加金色放射光，残留洋红，重演探头导致动作错位 | **本样本最忠实**，动作、字样和光门城市基本保留，局部略软 |
| 局部编辑判断 | 未达到严格“只改颜色” | 未达到严格“只改颜色” | 视觉上最接近目标，不能推广为所有任务的模型排名 |

原片本身也有指令遗漏：转为城市后无法持续保留原卡片的完整 Makaron 字样。此轮不把“有可播放产物”当成全部创意要求合格。音轨存在且可播放，但未做声音审美或盲评验收。

## 候选实现与 API 依据

- 新模型 `kling-4` 使用 EvoLink 的 `kling-v4-text-to-video`、`kling-v4-reference-to-video`、`kling-v4-video-edit`，不改旧 `kling`。
- 原生输出 720p / 1080p，整数 3–30 秒；至多 10 张图片、5 段参考视频，视频每段至少 3 秒、总计至多 30 秒。参考视频规格按供应商合同为每边 720–2160px、24–60fps、每段至多 200MB。当前通用预检检查尺寸、大小和时长；帧率/格式完整预检仍依赖供应商。
- 图片保持 feature reference；未暴露独立 keyframe/I2V。明确拒绝 extend、motion control、音频参考及 Retake replacement audio / end-frame 控制。编辑省略时长时使用 `auto`，按实测源片时长报价，不解析脚本时间来覆盖 auto。
- 单次供应商 POST；明确拒绝才释放预留。未知提交结果不重发，不切换其它模型；供应商错误正文不对用户透传。
- 接入能力表、Agent/MCP、CLI/help/README/bundled Skill、四语模型选择器及计费；新增候选 pricing 和 Retake 模型白名单迁移。
- `kling-4-flash` 没有验证到独立可调用 API、精确模型 ID 和价格；选择器显示不可用，服务端明确拒绝且无 fallback。本轮没有 Flash 付费请求或替代样片。

依据：[EvoLink reference-to-video 合同](https://evolink.ai/api-reference/kling-4/kling-v4-reference-to-video.md)、[video-edit 合同](https://evolink.ai/api-reference/kling-4/kling-v4-video-edit.md)、[fal H3 Max reference-to-video](https://fal.ai/models/minimax/h3-max/reference-to-video)。Flash 排查覆盖 EvoLink、fal、WaveSpeed、官方开放平台；宣传页或“将来切换原生 pipeline”的第三方说法不作为已接入证据。

## 共享数据库边界与未完成验收

共享 pricing 和 `video_retake_jobs.model_id` 尚不支持 Kling 4。首次 Kling Retake 在插入 receipt 时被原有 CHECK 拒绝，**供应商尚未提交，无生成费用**。候选新增两份迁移，但均未应用到共享数据库。

本次本地 Next 进程的实验专用 fetch 适配器：

1. 只给读取到的价格表追加本地 Kling 报价 fixture；不修改共享价格。
2. 仅将本次 Kling Retake 任务 receipt 存为本地 JSON，使用现有 Retake 编排完成真实供应商编辑和拼接；H3 / Eco 继续使用真实数据库 receipt。
3. 供应商调用、MCP 计费预留、Storage 媒体、项目快照均是真实链路。Kling 最终视频和 poster 已永久保存，项目重新读取成功；**这不证明 Kling 共享数据库任务恢复已验收**。
4. 付费调用写本地 ledger，禁止相同 payload 重复提交，按保守上界预留，含 $0.50 Agent 预留的总额为 $9.415，低于 $10 硬上限。此预留额不是实际花费。

实验适配器和私密回执只在忽略的 `test-results/kling4-mascot/` 内，不属于可发布应用。不得将该目录整体发布，其中存在私密环境文件。可展示文件仅在其 `review/` 子目录。

后续正式发布仍需：在已授权发布中应用两份迁移，去掉实验适配器，以正式数据库重新验证 Kling 创建/恢复/保存；检查 UI/CLI 实际入口；按发布清单同步 CLI/npm 版本、打包、registry 全新安装验收。本轮没有这些发布行为。

## 媒体与恢复验收

- 六个最终结果均下载为实际 MP4，视频/音频轨正常解析，并在 Codex 内置浏览器播放到结尾；对照页包含同步播放、独立声音、Retake 同帧滑杆和下载。
- 三条 Retake 均为 1280×720、24fps、121 帧、5.041667 秒，与源片一致。
- 三条 Retake 的完整原声 AAC 编码包 SHA-256 均与源片匹配。
- 区间外 0.25 / 0.75 / 4.25 / 4.75 秒抽帧，缩放到 160×90 后平均绝对像素差 0.23–0.44 / 255。原画面被保留，但整体重新编码，因此不声称视频逐字节无损。
- 通过新的 `project media` 请求重新读取全部六个项目：最终视频为 completed，指向永久 CDN，poster 已保存。
- 真实 Retake 计费预留均 completed：Kling 113 credits、H3 220、Eco 141。运行 usage 汇总不完整呈现这些 Retake 费用；不把其 0 credits 解读为供应商免费。
- EvoLink 标准原片处理时长 130s、Eco 基础原片 170s、Kling 编辑 82s、Eco 基础编辑 160s（供应商 task `duration`）。这些不含 Agent、轮询、超分、保存等步骤。
- H3 Retake 全链路约 146s、Kling 隔离 Retake 193s、Eco Retake 613s。Eco 包含本机开发服务重启后的 delivery lease 恢复等待，**不能拿它直接比较供应商速度**。

## 成本

| 项目 | 美元 | 证据类型 |
| --- | ---: | --- |
| Kling 标准原片 | 0.785 | EvoLink `usage.cost.usd` |
| Kling Retake | 0.564 | EvoLink `usage.cost.usd` |
| Eco 基础原片 | 0.687 | EvoLink `usage.cost.usd` |
| Eco 基础编辑 | 0.672 | EvoLink `usage.cost.usd` |
| H3 原片 | 约 0.400 | 公开单价 / 应用报价，非 fal 最终账单 |
| H3 Retake | 约 1.100 | 实际 reservation quote；包括参考图/视频输入 token |
| 两次 Eco 720p 超分 | 约 0.0648 | 5s + 4s 按 $0.0072/s 报价，非 fal 最终账单 |
| 媒体合计 | **约 4.2728** | 其中 **2.708 已由供应商回执核实**，其余为估算 |

Agent 与路由预检单列：原片运行初期本地旧 relay TLS 失败后，现有 Agent 机制使用 Azure GPT-6 Luna；随后改用当前 Preview relay，Retake 和路由预检为 Codex subscription。没有发生视频供应商 fallback。Agent 供应商最终美元账单未核实，不能将 Makaron credits 当成实际美元花费；本轮为其保守保留 $0.50。没有充值、付款或余额检查来代替费用核对。

## 验证与证据位置

- 相关原有六组回归 103 tests 通过；补充 Kling adapter、auto edit 报价/一次提交、Flash/no-audio 拒绝、Retake 引用映射及非整数源时长测试后，Kling 专项 9 tests 通过；Retake/模型限制/MCP 相关五组 94 tests 通过。
- TypeScript、定点 ESLint、四语 UI 文案检查通过；CLI smoke 和 Retake help 检查通过。
- `build:skill-sync` / `check:skill-sync` 通过。内部 Skill 变更使旧指纹失效，已重新运行受控 live 路由预检：3/3 通过，只执行本地 `read_file`，媒体操作 0，无项目写入。
- 未提交任何私密 receipt、环境文件或付费生成媒体到 Git。可复现输入和本次任务索引如下；本机私密证据根目录为 `test-results/kling4-mascot/`。

| 组 | project_id | 最终 snapshot_id |
| --- | --- | --- |
| Kling 原片 | 4b7c4279-a07f-4827-9829-032e2f71089f | 6e76e975-c290-40cb-98f9-314f2642cb80 |
| H3 原片 | 2b683c7f-06dc-4f10-993b-6ddf36edc110 | 8918644d-2cc5-43c2-b0c2-9ecd81180828 |
| Eco 原片 | 39c76a8e-cff3-4393-b7e5-6679be4ec1a5 | e7222477-58d7-4b5c-b40b-0c2efed397ab |
| Kling Retake | 3f5a7695-8437-4f34-bc12-9d8c563eb685 | 640b4d06-f839-4738-a043-2e233c1770d4 |
| H3 Retake | 888c4304-a6d9-46ae-b3f5-44266777483d | f5bfe63d-4e11-45a2-a993-8a04e0be26d8 |
| Eco Retake | 90d3be36-9e13-421b-b481-d54b70f0d3fe | 3425fc6a-63bd-49ed-a1a0-3bbf5b3dca46 |

原片脚本见本机 `prompt.txt` / `experiment.json`；各组最终 Agent 提示词见 `run-*.json`，供应商任务回执见 `provider-*.json`，媒体验收见 `retake-media-check.json`，重新打开证据见 `reopen-*.json`，展示页为 `review/index.html`。上述私密文件不承诺在其他机器可用。
