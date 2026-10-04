# 同源 480p 超分备选实测

日期：2026-10-04。状态：实验完成；后续产品编排已在独立分支实现，未部署。独立 worktree：`seedance25-480p`。

## 范围与命名

用户认为前次 FlashVSR 的效果不够好，要求更快的备选，并复用之前的 480p 视频比较。本轮新增 Seedance 生成 **0 次**；新增付费超分 **3 次**，均成功完成，没有重试。

候选产品名称：Seedance 2.5 Eco（经济高清）、Lite（轻享高清）、Value（优享高清）、Smart HD（智能高清）、SR（超分高清）。推荐 Eco，说明低价价值；Fast 暂不推荐，因为更快的超分阶段没有证明完整生成链路快于原生 1080p。名称属于 Makaron 组合路线，不能冒充 ByteDance 官方型号。

## 输入与参数

复用 `test-results/seedance25-mascot-ab/mascot-480p.mp4`，854×480 / 24fps / 241 帧；视频 10.041667 秒，容器与音频 10.08 秒。输入 SHA256：`5899bbac9c5428ca65dd045a9aa321e8a7bb8f0ed6c84df674f430e543ca3a02`。三次请求使用同一次上传的原始文件，没有新增 prompt 或重新生成。

| 方案 | 接口及参数 |
|---|---|
| Topaz Proteus | fal `topaz/upscale/video/precision`；`model=Proteus`，`upscale_factor=2.25`，`target_fps=24`，`H264_output=true` |
| Topaz Gaia CG | 同接口；`model=Gaia CG`，其余相同 |
| ByteDance Fast | fal `fal-ai/bytedance-upscaler/upscale/video`；`target_resolution=1080p`，`target_fps=24`，`enhancement_preset=aigc`，`enhancement_tier=fast`，`fidelity=high`，数值 `bit_depth=8` |
| 免费基准 | FFmpeg Lanczos 到 1920×1080；另生成一条 `unsharp=5:5:0.35:5:5:0` 的轻锐化版本，无 AI 调用 |
| 历史 FlashVSR | 复用前次 Regular / quality 80 的 1080p 文件，参数与时延详见前次报告 |

输出全部统一为 1920×1080 / 24fps / 241 帧。AI 供应商原始视频也均为 1920×1080 / 24fps / 241 帧；未要求插帧。最终规范化编码为 H.264 / CRF 18，重新复制原片音轨，不采用供应商重编码音轨。比较的是交付编码后的文件。

## 实测时延与费用

三个任务同时提交；供应商时间从发起提交到轮询观察完成并取回结果，包含网络与约 10 秒轮询间隔，不是纯 GPU 推理时间。下载及规范化使用同一 Mac，编码顺序会影响就绪时间；只有一个样本，不能推断 P50/P95。

| 方案 | 供应商返回 | 本地文件就绪 | 公开价估算，仅超分 |
|---|---:|---:|---:|
| Topaz Proteus | 33.432 秒 | 43.436 秒 | $0.2016 |
| ByteDance Fast | 44.409 秒 | 48.939 秒 | $0.072576 |
| Topaz Gaia CG | 65.867 秒 | 79.333 秒 | $0.2016 |
| 普通缩放 | 本机 | 1.548 秒 | $0 AI 费用 |
| 普通缩放 + 轻锐化 | 本机 | 1.678 秒 | $0 AI 费用 |
| 前次 FlashVSR | 161.352 秒 | 前次还有 720p 导出，不直接比较 | $0.253817344 |

本轮三次超分公开价估算合计 **$0.475776**，不是账单实扣。提交前按 Topaz 更高分辨率及时间舍入预留的保守上界合计 $1.40，小于本轮 $1.50 预算。

[Topaz Precision 官方标价](https://fal.ai/models/topaz/upscale/video/precision)：1080p / 30fps 为 $0.20 / 10 秒，实际信用点舍入和 24fps 计费需查账单。[ByteDance Upscaler 官方标价](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video)：1080p / 30fps 为 $0.0072 / 秒；本轮请求 24fps，保守按 30fps 标价估算。FlashVSR 旧样片费用按实际输出像素估算，详情见前次报告。

如果加上已实扣的原片 $1.374，ByteDance 路线总成本估算 $1.446576，Proteus 路线 $1.5756；相对已实扣原生 1080p $7.387，分别约节省 80.4% 与 78.7%。这不是新的端到端实测：将前次原片就绪 186.708 秒和本次后处理就绪相加，Proteus 约 230.1 秒、ByteDance 约 235.6 秒；前次原生 1080p 就绪 222.716 秒。经济路线的价值目前主要是省钱。

## 画质判断

以下是同帧目视判断，没有原生同一帧的高分辨率真值，不能把锐度等同于细节正确性，也没有把独立生成的原生 1080p 用作参考指标。

- 7.2 秒的吉祥物：FlashVSR 将方块眼睛处理成圆点，并改变轮廓。Proteus 与 ByteDance 保留原有方块表情更好。ByteDance 边缘更清晰，高光与轮廓有锐化光晕；Proteus 较均衡。
- 7.2 秒的建筑：FlashVSR 有很强的纹理重构，部分细节来自模型补绘。ByteDance 与 Proteus 也改善了楼宇边缘，前者锐化更强；Gaia CG 较软，相对普通缩放提升有限。
- 1 / 3 / 5 / 8.5 秒的采样画面：构图与动作保持一致。抽帧不构成连续播放的闪烁验收，仍需用户看完整视频。
- 普通缩放 / 轻锐化最快，适合预览或不付费的放大导出；它们不应被产品宣传为 AI 超分。

建议将 **ByteDance Fast 作为经济路线候选，Proteus 作为更均衡的备选**。不再把 FlashVSR 写成第一版唯一默认。先由用户评审这条样片，再覆盖人像、文字、快速运动、竖屏和无声视频，并核对实扣账单；单一样片不足以成为稳定生产默认。

## 产物与验证

本地目录：`test-results/seedance25-mascot-ab/upscale-options/`。播放器：`http://127.0.0.1:8770/upscale-options/index.html`。旧 `compare.html` 增加入口，原有对比保留。

页面提供六种版本任意两两切换、同步播放、0.5 倍速、逐帧、7.2 秒暂停、表情和楼宇的 430×430 原尺寸局部窗口，以及整帧原尺寸图片。默认左 Proteus、右 ByteDance，不把画面占满后缩小到看不出差异。

五条新增本地视频均 FFmpeg 全片解码通过，241 帧、24fps、1920×1080；原始 AAC payload MD5 均为 `e8ffe05ea54500d3bb872071d5014e65`，与源视频一致；文件 HTTP 200 与 Content-Length 校验通过，播放器 JS 语法检查通过。浏览器工具此前被本地 URL 策略拒绝，本轮没有绕过，**没有声称本轮浏览器播放已验收**。页面交由用户查看。

可复用脚本：`scripts/video-upscale-options-live.mts`；保存回执后继续同一任务，避免付费重提。`scripts/build-upscale-options-report.py` 仅构建本地播放器，无 API 调用。回执、带访问地址的响应和媒体保留在被忽略的测试目录，不提交凭据或签名 URL。

## 用户选定 ByteDance 后的 2K / 4K 实测

用户选择 **Seedance 2.5 Eco**，并选择 ByteDance Fast 接入独立 Agent 超分。本段新增超分 2 次，没有重新生成 Seedance；原三次测试记录不变。产品编排现已在独立分支实现，仍未生产部署或应用迁移。

调用新的产品适配器 `submitByteDanceUpscale` / `pollByteDanceUpscale`，同一 fal 原片 URL、24fps、aigc、fast、high、数值 bit_depth=8。下载后使用 `finishUpscaleMedia` 复制原 AAC 音轨，视频不重编码。

| 目标 | 实际交付尺寸 | 提交至本地文件就绪 | 10.08 秒超分公开估价 |
|---|---|---:|---:|
| 2K | 2564×1440 | 72.259 秒 | $0.145152 |
| 4K | 3844×2160 | 84.503 秒 | $0.290304 |

两项估价合计 **$0.435456**，不是账单实扣。时间包含 10 秒轮询间隔和下载，不是纯推理时间，不包含新生成或产品 Storage 上传耗时。实际维持 24fps / 241 帧 / 10.08 秒；两项全片解码通过，AAC payload MD5 都为源片的 `e8ffe05ea54500d3bb872071d5014e65`。尺寸因原片 854/480 比例和供应商偶数舍入略宽，按真实尺寸交付。

播放器增加两项及“ByteDance 1080p vs 4K”按钮；高清局部窗口按视频实际尺寸映射同一画面区域。文件 `bytedance-2k-final.mp4` / `bytedance-4k-final.mp4`；验证 JSON 保留在忽略的产物目录。供应商接口列出 6K / 8K，公开价只到 4K，产品第一版仅开放 1080p / 2K / 4K。
