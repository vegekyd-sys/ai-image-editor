# 线上与 Preview 项目首画面对照（2026-10-01）

8 个公开项目，每个版本每个项目 6 次，共 96 次实际链接点击。测试时间约 15:33–15:47 Asia/Shanghai。

## 测试口径

- 从真实链接点击开始，到主画布第一张实际图片、实际视频海报或已解码的视频帧可见；不计 loading、占位图、缩略图或按钮。
- 同一台 Mac、Chromium，390 × 844 手机尺寸，匿名访问；每次创建独立浏览器上下文，清空浏览器 HTTP 缓存和登录状态。串行交替线上与 Preview，固定种子打乱项目顺序，没有网络/CPU 限速。CDN 和服务端缓存未清空。
- 通过逐帧 DOM 可见性、资源/解码状态和截图像素校验计时；已人工检查所有成功样本截图，以及不同类型超时截图。
- 首次画面时间包括导航、服务端、脚本与媒体等待。视频海报可见不代表视频已经能播放。本轮没有测完整编辑就绪时间。
- 20 秒内没有实际画面记录为超时，不当作恰好 20 秒，也不删除。校准 pilot 不进入正式统计。
- 本轮是公开链接完整导航，不是登录态项目列表中的 SPA 跳转，也不是 iPhone Safari/移动网络实测。

## 结果

整体 48 次/版本的样本中位数（保留超时的排序位置）为线上 4.66 秒、Preview 1.82 秒，下降 61%。这两个中位数位置都落在实际观测到画面的样本内，因此可计算，未将超时赋成精确时长。

线上 18/48（37.5%）超时，Preview 2/48（4.2%）超时。只看成功样本的整体中位数为 3.14 → 1.79 秒；成功样本中间 50% 为 2.56–4.38 → 1.66–2.11 秒。

以下逐项目时间和下降比例仅使用成功出画面的样本中位数。所有超时独立列出，不能用时间列推断所有进入都成功。

| 项目（线上） | Preview | 线上中位数/秒 | Preview中位数/秒 | 时间下降 | 线上超时 | Preview超时 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| [多机位四宫格（原链接）](https://www.makaron.app/projects/62cb6b23-989f-48a3-9b6b-2fe936f7d4de) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/62cb6b23-989f-48a3-9b6b-2fe936f7d4de) | 3.05 | 1.72 | 44% | 3/6 | 0/6 |
| [多机位故事视频](https://www.makaron.app/projects/8b94e663-5bd2-43ea-a4fa-253780d890a1) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/8b94e663-5bd2-43ea-a4fa-253780d890a1) | 3.61 | 1.83 | 49% | 0/6 | 0/6 |
| [H3 Max / Wan3 视频](https://www.makaron.app/projects/65c105f9-c544-43cb-9e8f-49cdb68c6c1a) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/65c105f9-c544-43cb-9e8f-49cdb68c6c1a) | 3.37 | 1.91 | 43% | 3/6 | 0/6 |
| [工厂 TikTok（16条素材）](https://www.makaron.app/projects/bcfaf9f3-49ef-4722-be01-fffaaaaaba42) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/bcfaf9f3-49ef-4722-be01-fffaaaaaba42) | 2.68 | 1.73 | 36% | 3/6 | 0/6 |
| [Mario 圣诞图](https://www.makaron.app/projects/170e7497-ac1e-4a58-8ebc-a39cba4d71ed) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/170e7497-ac1e-4a58-8ebc-a39cba4d71ed) | 2.51 | 1.61 | 36% | 1/6 | 0/6 |
| [Christmas Wonderland](https://www.makaron.app/projects/690ef838-567b-41ab-ad62-188bfacc3420) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/690ef838-567b-41ab-ad62-188bfacc3420) | 2.53 | 1.70 | 33% | 3/6 | 0/6 |
| [人物 look sheet](https://www.makaron.app/projects/ae9c5d14-66c5-417e-a79c-5ae886d6520c) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/ae9c5d14-66c5-417e-a79c-5ae886d6520c) | 2.52 | 1.80 | 29% | 3/6 | 1/6 |
| [Dobby 设计（9条素材）](https://www.makaron.app/projects/31d23e7f-ae21-4f27-aadc-85c4c043bb3a) | [体验](https://ai-image-editor-kiqf83cee-vegekyd-sys-projects.vercel.app/projects/31d23e7f-ae21-4f27-aadc-85c4c043bb3a) | 9.74 | 8.97 | 8% | 2/6 | 1/6 |

48 组配对中 Preview 43 组更早出画面（包括线上超时而 Preview 成功的情况）；并非每次都更快。普通图片/视频项目中位数改善约 29–49%，无海报的设计项目仅改善约 8%，仍是主要等待点。

线上每次检测到 1–2 次整页 page-slide-in，Preview 为 0。线上另有 4 次实际画面短暂出现后，在随后约 1.2 秒观察期重新变为空白；按“第一张实际画面”的口径仍保留首次时间，因此本表会低估这些样本的持续等待。

## 版本与内容核对

- 线上部署 dpl_5DDnoUcBFtcvRGkvWELUT3ZapD7g，dev / 9f9be93fc9fea06c6ef414ee0caf3bbb28505326。
- Preview 部署 dpl_CqoLKDR6etKhYiqm26o18azu6t9Z，代码候选 f2e3b634，codex/project-entry-speed。
- 测试前后两端部署 ID 相同；未发布生产。
- H3 Max / Wan3 在选样与正式测量之间从 2 条变成 3 条素材。正式测量中所有读到客户端 snapshot 的样本均为同一 latest snapshot（0c8694a5-887f-46ef-829f-0e01ad7260c8），与结束时核对相同；其余项目版本也一致。配对中没有观察到双方 latest snapshot 不同。
- 未观测到 pageerror；匿名 billing/tips/font API 仍有 401，设计链路亦有服务响应异常，因此不能宣称没有接口错误。Preview 两次超时均经截图确认，分别是人物图片的空画布/loading、设计视频空白但已有文字。

## 数据

96 条精简原始数据：project-entry-live-preview-2026-10-01.csv。完整临时脚本、逐次 JSON、截图位于 /tmp/mkr-live-bench-20261001；没有把凭据或媒体访问参数加入本报告。

该结果描述当前本机网络下两个真实部署的对照，尚不能拆分全部代码优化、CDN、运行环境等因素的贡献，也不代表所有项目或真实移动网络的超时率。
