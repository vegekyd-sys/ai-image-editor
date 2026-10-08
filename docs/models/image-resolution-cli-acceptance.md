# 图片分辨率专项验收

本轮核对 Nano Banana 2.1 和实际接入的 GPT Image **2.5**（Flare/Sunburst），不把 GPT Image 2.1 当作已配置模型。保留原 50 case 的历史结果，本轮新增独立项目，通过安装的 `makaron chat` 生成真实图片，核验工具参数、供应商原生尺寸、完整解码、保存后重新读取、模型与实际扣费。

修改前确认的缺口：Flare/Sunburst 能力表没有 imageResolution；适配器显式比例固定约 1MP。Nano Banana 2.1 已发送 resolution，但原失败被通用 catch 吞掉具体阶段。

待覆盖：

| Case | 预期 |
| --- | --- |
| D01/D02 | 显式 Nano Banana 2.1 方形 2K/4K，原生 2048/4096 方图 |
| F01 | Auto 2K 方图，Flare 优先，2048×2048 |
| F02/F03 | Flare 4K 横/竖，3840×2160 / 2160×3840 |
| F04 | Sunburst 2K，2048×2048 |
| F05 | 透明编辑 2K，真实 alpha；不缩回低分辨率源图 |
| F06 | Auto 4K 方图，GPT 的像素上限无法满足，改选 Nano Banana 2.1 |
| 单元边界 | 1K/2K/4K 无比例与各种比例的合法画布；4K 方图与透明冲突允许放宽并说明；未知档位、NSFW 保持原政策；主 Agent/MCP 预检与实际路由一致 |

GPT Image 2.5 的 4K 指 3840 长边、最多 8,294,400 像素，不能生成 4096×4096 方图。无指定比例的 4K 默认 16:9；指定方形 4K 时优先满足方形与分辨率，使用 Nano Banana 2.1；需要透明时保留透明、放宽到 2K。普通 1K 与没有指定分辨率的原有默认行为保持不变。

来源：[fal 适配合同](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api)、[OpenAI 原生尺寸](https://developers.openai.com/api/docs/guides/image-prompting)、[OpenRouter 图片 resolution 参数](https://openrouter.ai/docs/api/api-reference/images/generate-an-image)。

状态：专项验收进行中，未合并、未上线。实际结果在补测后更新。
