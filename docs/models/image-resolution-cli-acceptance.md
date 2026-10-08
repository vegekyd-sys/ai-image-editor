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

## 实测结果

分辨率专项 8 个最终场景均通过安装的 Makaron CLI Chat 实际出图、完整解码、持久化与 CLI 重新读取；原生尺寸 8/8 通过，视觉完整验收 7/8。透明编辑 2K 保留真实 alpha 与源茶壶，主体外轮廓仍有浅色半透明光晕，质量待改善。

| 最终 case | 实际模型 | 保存后尺寸 | 结果 |
| --- | --- | --- | --- |
| D01 | Nano Banana 2.1 | 2048×2048 | 通过 |
| D02 | Nano Banana 2.1 | 4096×4096 | 通过 |
| F01 | Flare（Auto） | 2048×2048 | 通过 |
| F02 | Flare | 3840×2160 | 通过 |
| F07，替代失败 F03 | Flare | 2160×3840 | 通过 |
| F08，替代失败 F04 | Sunburst | 2048×2048 | 通过 |
| F09，替代失败 F05 | Flare 编辑 | 2048×2048，真实 alpha | 分辨率通过，边缘光晕警告 |
| F10，替代失败 F06 | Nano Banana 2.1（Agent依据能力表自动选择） | 4096×4096 | 通过 |

初始 F03/F04/F05 已在 fal 生成成功，本地运行时 decode/normalization 报 RangeError；读取同一已接受请求的原始供应商图片，Sharp 全解码通过，尺寸与成本也有效。F06 在 OpenRouter HTTP 200、17,533,457 字节 JSON 返回后，图片 payload 校验报 RangeError。避开整张大图的带量词正则，改为限长 header 解析和无量词非法字符检查；随后 F07–F10 的独立真实 CLI Chat 请求全部交付。独立 Node 对旧 fal 素材的归一化也能通过，故不能把这个问题描述为图片损坏或供应商不支持；运行时解析/校验是本轮复现的故障环节。原 C09/C10 没有阶段日志，不能逐次认定其旧失败根因相同。

补齐 Flare/Sunburst imageResolution 与原生 image_size，兼容画布保留 Flare-first；方形 4K 转 Nano，透明方形 4K 放宽至 2K 并说明。明确要求高分辨率的透明编辑不缩回源图尺寸。供应商最终计费仍取实际成本，保持既有余额预检政策，没有按分辨率硬编码新图价。

共 12 个独立项目/请求（包含修复前 4 个失败记录），Makaron 共扣 88 credits，最终 8 个出图请求 84 credits，失败请求各仅扣 Agent 1 credit。fal 三个失败请求已产生供应商图片与成本，OpenRouter 失败请求的供应商成本未确认，不能把 Makaron 没扣图片 credits 当作供应商没有费用。没有自动重发失败的付费 POST。

脚本：`scripts/image-resolution-cli-acceptance.mjs`；报告：`test-results/image-resolution-cli/report.html`，所有 receipt、图片、修复前失败及供应商原始图保留于同目录。报告生成用 `node scripts/image-capability-cli-report.mjs --resolution`。独立 runner 的 `release:check --local` 退出 0：TypeScript、2159 自动化测试（1 跳过）、CLI smoke、生产 webpack 构建和 server runtime packaging 通过。原 50-case 的参考取舍与其他视觉偏差仍未重新完成验收。

状态：候选工作树已修正，未合并、未上线；分辨率专项通过不替代完整上线验收。
