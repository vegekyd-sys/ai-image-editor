# Seedance 2.5 480p 与视频超分实验（2026-10-04）

独立分支 `codex/seedance25-480p-upscale`，基于 dev `238616d5`。候选改动与研究样片已完成；尚未合入、部署，也未应用共享数据库价格迁移。

## 480p 接入与计费

已有 Evolink/createVideo 链路支持 480p；本次把 Seedance 2.5 模型自己的默认分辨率改为 480p。全局默认视频模型不变，显式 720p 仍可用。CLI 技能文档同步说明。App/Agent/MCP 的报价仍从 `media_pricing` 读取，不由静态估算替代。

公开供应商价（USD，非 Makaron 用户积分；查询日 2026-10-04）：

| 输入 | 480p | 720p | 1080p |
|---|---:|---:|---:|
| 文生、图生、图/音频参考（仅输出秒） | 0.138/s | 0.296/s | 0.739/s |
| 有视频参考、编辑、延长（输入及输出秒） | 0.084/s | 0.180/s | 0.450/s |

视频参考计费秒数 = `max(参考视频总秒数, 输出秒数) + 输出秒数`。Mature Mode 加价 10%。草稿转 1080p 另收完整 1080p 费用，适合低分辨率迭代选片，但单条定稿不比直接生成 1080p 便宜。

来源：[EvoLink Seedance 2.5](https://evolink.ai/seedance-2-5)。原生 1080p 的供应商价仅作研究对照，本分支仍只开放 480p/720p 原生生成。

新迁移增加可空 `video_reference_usd_per_second`，报价按上述公式处理 Seedance 2.5 视频参考。只更新仍匹配 8 月旧价格的行，不覆盖运营手动价格、markup 或禁用标记；旧行/自定义行没有新费率时沿用旧报价合同。Admin 可编辑/清空该字段，并补齐四语言文案。

发布时先让新报价代码接管运行时，再应用迁移并核实共享数据库结果；不要先将价格表切给仍运行旧参考视频计费逻辑的实例。保留迁移前价格快照用于回滚。此处没有执行发布。

## 超分方案与成本

以 **10 秒、16:9、24fps、无视频参考** 为统一口径：

| 方案 | 超分成本估算 | 生成+超分合计 | 本次可用性 |
|---|---:|---:|---|
| 直接原生 720p | — | $2.960 | 本次未生成对照 |
| 直接原生 1080p | — | $7.390 | 本次未生成对照 |
| 480p → ByteDance Standard 1080p | $0.072 | $1.452 | 报价最低；修正后重试仍排队，已取消 |
| 480p → FlashVSR 1080p | ~$0.249 | ~$1.629 | 实测完成 |
| 480p → Evolink Topaz 4× → 1080p | ~$0.880 | ~$2.260 | 服务繁忙，实测失败 |

ByteDance：[`fal-ai/bytedance-upscaler/upscale/video`](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video)，1080p Standard 30fps $0.0072/s；60fps 翻倍，Pro 十倍。使用 `enhancement_preset=aigc`、`fidelity=high`。没有 720p preset，先取 1080p 再降到 720p；`scale_ratio` 可覆盖目标分辨率，但低于 1080p 的价格应另查实账。API `target_fps` 为数字，`bit_depth` 也必须为数字（8/10/12）；不要照搬 SDK 旧版 FPS 类型或文档枚举的字符串表达。

FlashVSR：[`fal-ai/flashvsr/upscale/video`](https://fal.ai/models/fal-ai/flashvsr/upscale/video)，公开价 $0.0005/视频百万像素（宽×高×帧数/1e6），不能把它当作每秒单价。1080p/24fps 等价约 $0.0249/s。保持音频，输入 480p 用 2.25 倍超分，再按画幅轻微裁边到标准 1920×1080；720p 从这一产物降采样。源码/自部署可再评估 [FlashVSR](https://github.com/OpenImagingLab/FlashVSR) 或 [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)，需要把 GPU 吞吐、闲置与运维算入成本，本次没有部署。

Topaz：[EvoLink Topaz](https://evolink.ai/topaz-video-upscale)，2× $0.055/s、4× $0.088/s，最大输入 50MB。480p×2 只有 960p，要达到 1080p 应 4× 后降采样，不能把 2× 报价直接算成 1080p。它可作为另一家供应商备选，但本次繁忙失败。

## 实测证据

- Seedance 任务：`task-unified-1791056778-vckskk0s`，模型 `seedance-2.5-text-to-video`，4 秒 480p，原生声音。下载为 854×480、24fps、97 帧、4.064 秒、H.264 + AAC。实际 supplier usage：37.3674 credits / **$0.55**。
- FlashVSR：`01a10355-de39-7343-b624-b531c38eeb7f`，`regular`、quality 80、color_fix、preserve_audio、2.25×，提交至完成约 **44 秒**。交付 1920×1080 和 1280×720，均为 24fps、97 帧、4.064 秒。
- 原片/两份交付文件都全量解码无错误；AAC 数据 MD5 全部相同：`86bbe772d051e81e9cf08111a6a05885`。脚本显式复制原音轨，因此不依赖供应商是否保留声音。
- 浏览器同步播放实测已通过。样片与完整任务/元数据/解码证据在 `test-results/seedance25-480p-upscale/`（忽略目录）。对比入口 `compare.html`；浏览器证据 `comparison-browser.png`。
- FlashVSR 更清晰地呈现玻璃切面、布纹和台面，但在虚化背景补出了额外光斑。没有原生 720p/1080p 的同源对照，不能声称超分画质等价原生高清；快运动、人脸、文字和纹理时序还需扩展样本。
- 超分费用目前按公开单价计算，尚未取得 fal 的实际扣费账单；不要把总价估算当实账。
- Topaz 任务 `task-unified-1791057207-b9dsy0ww`：终态失败 `Service busy. Allocating resources, please retry later.`，没有产物。
- ByteDance 第一次排队长时间不动，终态 422（bit_depth 字符串错误）；已改成数字，以 `01a1035a-896b-7d40-8e92-6f0b27c07c5a` 重试，仍在第 57 位等待，主动取消；收到 499 cancelled 确认，没有超分产物。该接口仍需重新验证可用性。

## 复用实验

先用现有 `scripts/seedance25-live.mts` 生成 480p，再运行：

```sh
DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx \
  scripts/seedance25-upscale-live.mts <seedance25-live.result.json> flashvsr
```

最后参数可改为 `bytedance`。脚本保存队列 ID、重复执行恢复同一任务、下载最终产物、保留原声音、生成 720p/1080p 文件与元数据。它是 CLI 研究脚本，尚未把两阶段任务接入 App 的计费、取消、持久化、失败重试和时间线。后续产品化要保证超分失败仍保留可播放的 480p 产物。

验证：相关 154 项测试、TypeScript、所改代码 ESLint、四语言检查、diff 检查，以及 PGlite 上真实 SQL 迁移验证（旧默认价更新、运营覆盖/markup/禁用保留、零费率约束、其他模型不变）。
