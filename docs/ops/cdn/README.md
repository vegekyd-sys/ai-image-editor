# DL-1020-01 下载诊断与候选提速（2026-10-20）

对象：nightshift.tianyi.live/deliver/ 的 DL-1020-01 清单，共 10 条 MP4，565,615,533 字节。实际域名是 cdn.makaron.app。

## 完整性与速度

全部 10 条已完整下载，HTTP 200、大小匹配，ffprobe 检查为 1080x1920 H.264/AAC。原始 SHA-256 在 baseline JSON。连续逐条下载总计 262.04 秒；首条 142MB 用时 65.61 秒。首条已为 faststart（moov 在前），无需重新编码。

Cloudflare 原本最后一条 Bypass 规则匹配整个 cdn 域名，覆盖前面的公开媒体缓存规则。按十个精确视频路径排除后，20 次 Range 都返回正确 206，第二轮 10/10 HIT。完整重测 9 条成功；第 2 条一次 TLS 连接超时，保留失败记录，单独重试成功。最终十条完整 SHA-256 均相同。

缓存命中后首条 63.48 秒，改善有限。四个并行 Range 重组同一文件用时 17.01 秒，8.35 MB/s，SHA-256 一致。这是本机路径的实测，不能当作中国大陆三网 SLA。

Codex 内置浏览器真实点击候选页单条下载，142,048,671 字节，SHA-256 为 7a56b6242a2bdf9601dfbf0678d906fd5f79bf35b84064bf900c30240db44121，与基线一致。候选页面在独立 v-nightshift worktree；没有修改在线模板。

## 配置与范围

缓存规则前后表达式、精确路径与回滚方式在 dl-1020-01-cache-pilot.json。此次没有对整个 public bucket 放开视频缓存。Smart Tiered Cache 已启用，但没有独立量化其效果。

响应头变换仅匹配这十个公开 GET/HEAD，添加 Access-Control-Expose-Headers: Content-Range, ETag, Accept-Ranges；已用真实 206 响应及浏览器文件校验验证。

R2 未订阅、未创建 bucket、未迁移文件。开通需要新增用量计费订阅和条款确认，问题已交给用户，尚未收到同意。不得把这一状态描述为已完成 R2 迁移。长期视频分发方案需结合 Cloudflare Developer Platform/R2/Stream 的适用条款，不能把本次缓存诊断当成免费 CDN 视频长期方案。

## 验证边界

本机 DNS 呈现代理地址，边缘多为 NRT；V 与另一现有测试主机出口均为 SG。没有大陆电信/联通/移动三网样本。新加坡约 19.7MB 文件为 1.93–2.06 秒，但两次走不同 colo，不能作为缓存冷热对比。媒体内容未重新编码、未降低画质。

## 复测

使用 scripts/probe-media-delivery.py 对保存的清单执行 --full / --repeat 2（--help 查看参数）。探针串行执行，保留 HTTP、Range、长度、SHA-256、ffprobe 与耗时。测试会消耗真实下载流量；不要无目的重复全量。

CLI/NPM：本次 Makaron 只有诊断脚本与运维资料，无网站功能/CLI 合同发布，不需要发新 CLI 包。夜班交付页改动走该仓库独立 PR/CI/发布流程。

## 收尾状态

临时视频缓存试验已结束，Bypass 表达式恢复原值；真实响应确认 DYNAMIC。保留 Smart Tiered Cache 开关与十条公开视频的校验头。恢复缓存原配置后，内置浏览器重新点击第一条，17.543 秒下载 142MB，SHA-256 仍与基线一致，说明分段提速不依赖此次 Cloudflare 缓存试点。

Chrome 原生保存窗口完成 ZIP 写盘；566MB 包约 83.33 秒（保存点击后计时至文件最终 mtime，近似值），十条解压文件 SHA-256 全部匹配。这个 ZIP 结果发生在缓存试点期间；不可把不同下载方式的总耗时直接视为严格 A/B。

最终候选补充 cache:no-store，避免重复 Range 命中浏览器缓存。再次真实点击下载首条 142MB：14.436 秒，SHA-256 一致。该数字仍为单次本机测量，不能保证其他网络固定倍数。
