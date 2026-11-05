# Supabase 出流降费：复核与新结论（2026-11-05）

复核对象：Codex 会话 01a199cc（11-02 至 11-04），分支 `codex/media-shared-browser-readiness`（worktree `~/.codex/worktrees/cloudflare-media-runtime/ai-image-editor`）。
本轮只做只读查询，没有改动线上配置。

## 1. 钱花在哪里

账单数据取自 Codex 11-03 读到的 Supabase 页面：

| 项目 | 金额 |
|---|---:|
| Cached egress（约 4,310 GB） | $121.80 |
| Uncached egress（约 655 GB） | $36.45 |
| 其他（Pro 套餐、算力等） | $59.03 |
| 合计 | $217.28 |

按 edge_logs 统计 2026-10-28 至 11-04 共 8 天。字节数用响应头的 Content-Length 累加，会比账单高约 20%，所以下面只看比例。

- 出流字节几乎全部来自 Storage；REST、Auth、Realtime 可以忽略。
- **按访问域名分：`cdn.makaron.app` 占 98.9%**，直连 `*.supabase.co` 只占 1.1%。Remotion Lambda、浏览器播放和下载、FFmpeg、交付页，全部走的是 `cdn.makaron.app`。
- 再按客户端细分，下面每一项都走 `cdn.makaron.app`：

  | 客户端 | 占比 |
  |---|---:|
  | Lambda | 50.0% |
  | 浏览器 | 32.2% |
  | Headless | 5.0% |
  | FFmpeg | 5.0% |
  | 其他 | 5.0% |
  | Node | 1.7% |

- 按内容类型分（以 11-03 为例）：视频约 93%，音频约 6%，图片约 0.5%。

**结论：`cdn.makaron.app` 的流量大约就是全部 egress 费用，约 $158，占总账单约 73%。**

## 2. 为什么 cdn.makaron.app 没省钱

- `makaron.app` 的 NS 已经在 Cloudflare，`cdn` 记录也开了橙云代理（A 记录解析到 104.21.x / 172.67.x）。
- 但 Supabase 返回的是 `cache-control: no-cache`，所以我们自己的 Cloudflare 层显示 `cf-cache-status: DYNAMIC`，**什么都没缓存**。每个请求都穿透到 Supabase Smart CDN，命中后按 Cached egress 计费。

## 3. 重复读取有多严重

在同一天内，被读取的字节数是对应文件实际大小的多少倍：

| 日期 | 读取 GB | 去重后文件大小 GB | 倍数 |
|---|---:|---:|---:|
| 10-28 | 395 | 32.2 | 12.3× |
| 10-29 | 209 | 25.3 | 8.3× |
| 10-30 | 312 | 39.6 | 7.9× |
| 10-31 | 15 | 1.9 | 8.1× |
| 11-01 | 18 | 2.7 | 6.5× |
| 11-02 | 383 | 39.4 | 9.7× |
| 11-03 | 125 | 20.8 | 6.0× |
| 11-04 | 160 | 23.8 | 6.7× |
| **合计** | **1,617** | **185** | **8.7×** |

**约 88% 的字节是当天已经传过的同一个文件。** 只要在 `cdn.makaron.app` 前面加一层回源缓存，这部分理论上都能省掉，不用改应用代码，Lambda、播放、下载、交付页一次全部覆盖。

另外，大于 32 MiB 的文件约占字节的 23–28%。Codex 当前候选方案的浏览器路径不处理这一档。

## 4. Codex 分支现状

- **没有合并，没有上线，目前还没产生任何节省。**
- 改动共 68 个提交、约 28k 行，其中约 2.8k 行是生产代码，其余是文档、证据 JSON 和测试。
- 速度门槛还没通过：64MB 文件首次拖动要 1229ms（原路径 451ms），渲染也有慢样本。
- 已核实的问题：
  1. **高**：`media_replica_claim` 会重新领取 `ready_until < now()` 的副本（migration 第 68 行），而 `ready_until` 只有 5 天，见第 83 行。结果是每个副本每 5 天都会从 Supabase 全量重新复制一次，不管有没有人在用。**这会凭空制造出流。**
  2. **高**：一旦打开 `MEDIA_REPLICA_DELIVERY`，如果没有先重新部署 Lambda site，所有导出都会失败（`remotion-lambda-renderer.ts:521`）。
  3. **中**：`/api/media/delivery` 不需要鉴权，每次请求都调用 service-role RPC，未命中时还会触发复制。
  4. **中**：上传网关用 tee 双写，R2 写入变慢时可能把整个文件堆在内存里。
  5. **低**：preview 用的 workers.dev 域名写死在代码和 migration 里；migration 放在 `supabase/migrations/` 下，任何一次 `db push` 都会把它推到共享的生产库。
- 和 dev 有冲突：`packages/makaron-cli/bin/makaron.mjs` 的 `uploadFileViaSignedUrl`。

## 5. 建议方案：在 cdn.makaron.app 上做 R2 回源缓存

用一个 Worker 接管路由 `cdn.makaron.app/storage/v1/object/public/*`：

1. R2 里有就直接返回，支持 Range。
2. R2 里没有就从 Supabase 取，边返回给用户边写入 R2（用 `waitUntil`）。
3. 文件可能被覆盖（代码里大量使用 `upsert: true`），所以需要处理版本：要么用 ETag 做条件 HEAD 校验（HEAD 不产生正文出流），要么在上传覆盖时主动清掉对应缓存。
4. 只缓存媒体扩展名；JSON、Markdown 等草稿文件直接透传。
5. 回滚只需要删掉这条 Worker 路由。

费用估算以 11-03 的业务量为准，未经实测：

| 项目 | 金额 |
|---|---:|
| Supabase egress | $158 → 约 $10–25（只剩首次读取，大部分落在免费额度内） |
| Cloudflare Workers Paid | $5 |
| R2 存储（约 0.7–1 TB，30 天 lifecycle） | 约 $10–15 |
| R2 请求（每月约 150 万次 GET，在免费额度内） | 约 $0 |
| **总账单** | **约 $217 → $90–105，每月省 $110–130（约 50–55%）** |

为什么不直接给 Cloudflare 加一条 Cache Rule：这样做零代码，但 Cloudflare CDN 条款限制「不使用 R2 或 Stream 却大量分发视频和大文件」。我们每月有约 4–5 TB 视频流量，账号被限流的风险不小，所以只适合当临时过渡。

需要验证的点：

- Lambda 导出速度。Codex 测过「Worker 正文代理」比原路径慢约 28%，但当时是额外加了一跳；现在 Lambda 本来就经过 `cdn.makaron.app` 的 Cloudflare 层，所以需要重新 A/B。
- 大文件的首次拖动速度。
- 文件被覆盖后会不会继续返回旧内容。

## 6. 实施进展（2026-11-05 14:59 CST）

- 实现位置：`services/media-r2-cache/`，设计、验收数据和上线步骤见其 README。
- 测试域名 `cdn-r2-test.makaron.app` 已部署，R2 bucket `makaron-cdn-media`（APAC，带 30 天过期规则）已创建。**生产 `cdn.makaron.app` 路由未改动。**
- 单元测试 13/13 通过，真实环境验收 15/15 通过。从 V 测速：图片 124→84ms，32MiB 视频 3.6→2.1s，拖动 601→392ms，首字节 283→60ms。
- 实测发现并修复了一个问题：Supabase CDN 按编码分别缓存、失效有滞后，会把旧版本写回 R2。现在补缓存改为直读 Storage，并要求 ETag 与返回给用户的版本一致。
- 上线前仍待完成：购买 Workers Paid、配置 Cache Purge Token（可选）、配置生产 PURGE_SECRET 和 Vault、执行触发器 SQL、上线后对比 Lambda 渲染耗时。

## 7. 已上线（2026-11-05 21:10 CST）

已购买 Workers Paid，`cdn.makaron.app` 的公开媒体请求已经由 R2 缓存 Worker 接管，线上冒烟检查通过（详见 `services/media-r2-cache/README.md`）。覆盖写触发器和 Vault 密钥已经由人工在 SQL Editor 里执行完毕，实测 R2 副本在数秒内被清除。省钱效果要看 11-06 起的 Supabase egress。

## 8. 网站发布与 Lambda 回归（2026-11-05 22:40 CST）

- 合入 `dev` 并执行 `release:prod`：2724 条测试通过，`/api/health` 12/12 健康，生产 bundle 里四种语言的 Changelog 都已就位。
- Lambda：上线后导出变慢。三段对照（R2 / 北美绕过 / 摘掉路由）的结果分别是 1075 / 1164 / 1173ms，排除了缓存的影响，已恢复全量缓存。详见 Worker README。

## 9. 待跟进

- **11-06 复查**：定时任务 `r2-cache-egress-check-20261106`（20:00 CST）会核对 Supabase egress 是否下降、R2 用量和 Lambda 导出耗时，结果追加到本文和项目记忆。
- **美东冷读**：R2 在 APAC，美东 Lambda 冷读时请求层 p90 约 450ms（直连约 100ms），端到端导出目前没有受影响。如果 Lambda 每秒成片耗时 p50 持续高于约 900ms，就按 Worker README 的方案处理：延长边缘 TTL 并加后台复核、加 ENAM 副本，或者临时设置 `BYPASS_CONTINENTS=NA`。
