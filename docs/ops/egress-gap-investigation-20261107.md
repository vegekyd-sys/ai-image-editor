# Supabase egress 与 CF 边缘 MISS 差距调研（2026-11-07）

- 调研时间：2026-11-07 00:00–00:15 CST（`date +%F` = 2026-11-07）。11-07 当天（UTC）还没有数据，整天复核交给定时任务 `r2-cache-egress-check-20261107`（10:00 CST）。
- 方式：只读。读代码，查 Cloudflare GraphQL，查 Supabase Management API 的 `analytics/endpoints/logs`（ClickHouse，`source='edge_logs'`），对共享库执行只读 SQL（`read_only: true`）。没有改动 Worker、路由、Supabase 配置或数据。
- 疑点：11-06 UTC 0–12 时，Supabase 计费 35.5 GB（cached 26.1 + uncached 9.4），而 CF 边缘 MISS 只有 9.0 GB；未缓存 egress 也没有下降。见 `docs/ops/supabase-egress-review-20261105.md` 第 10 节。

## 0. 结论先行

1. **差距的主要部分是 Worker 补 R2 时读取整个文件（候选①）。** Worker 回源时把 Host 改成 `sdyrtztrjgmmpnirswxt.supabase.co`，所以这些子请求在 Supabase 日志里记在 supabase.co 名下，CF 边缘的统计里看不到。11-06 UTC 0–12 时，带 `r2c=` 的补缓存请求共 **22.9 GB**，约占计费 35.5 GB 的 **65%**。补缓存总会读完整个文件，所以这个数是真实传输量。剩下约 12.6 GB 是用户请求未命中时原样转发到源站的部分。
2. **补缓存没有被重复触发。** 11-06 UTC 0–16 时共 2,031 次补缓存，涉及 2,027 个不同路径。revalidate 有 1,930 次，但每次只取 1 字节，字节量可以忽略。
3. **补缓存的流量一半来自预热（候选②），一半是稳态。** 11-06 补缓存的 27.4 GB 中，上线前就存在的老文件占 13.5 GB，这部分会随 R2 预热完成而消失；上线后新建的文件占 13.9 GB，这部分会一直存在，按 11-06 的业务量约 20 GB/天。
4. **未缓存 egress 不降是结构性的，符合预期。** 每个新文件的第一次读取一定会穿过 Supabase CDN 并且未命中，按 uncached 计费。R2 缓存只能省掉重复读取，重复读取本来就主要按 cached 计费。另外，补缓存请求在 Supabase CDN 上 93% 是 HIT，按 cached 计费。
5. **绕开 cdn.makaron.app 的直连流量可以排除（候选③）。** 11-06 不经过 Worker 的 supabase.co 请求总共只有约 3 MB。`/render/image` 约 0.1 GB，签名 URL 和其他 Storage 接口都在 MB 级。
6. **206 bug 引起的重试可以排除（候选⑤）。** 修复前的 206 响应来自 R2，不回源；能确认的失败只有 4 次。
7. **新发现的漏网点：`.wav` 等音频的 content-type 是 `application/octet-stream`，永远进不了 R2。** 每次读取都穿透到 Supabase。11-06 UTC 0–16 时有 13 个这样的 wav，被请求 1,198 次，Content-Length 合计 3.4 GB。库里同类对象共 763 个，近 7 天新增 112 个，都在 `workspace/<project>/media/` 下。
8. **正确性问题，与费用无关：`?r2c=` 绕不开 Supabase CDN。** 带唯一参数的请求仍然会 HIT。README 里说「补缓存不读 Supabase CDN，避免写入旧版本」，这个说法不成立。

## 1. 从代码估算每次回源拉多少字节

依据 `services/media-r2-cache/src/worker.mjs`（生产版本 `c53679db`）：

| 路径 | 回源请求 | 源站返回字节 | 触发条件 |
|---|---|---|---|
| 未命中时透传（Tier 3） | 原样转发用户请求（包括 Range） | 用户要多少就给多少；`bytes=0-` 会声明整个文件长度，但客户端可能中途断开 | 边缘缓存和 R2 都没有 |
| 补缓存 `fill()` | 不带 Range 的 GET，加 `?r2c=<ts>`，并带 `accept-encoding: identity` | **整个文件**（`bucket.put` 会读完整个流） | 每次透传都会触发，条件是状态为 200/206/304、媒体类型、总长不超过 1 GiB。同一 isolate 用 `inflight` 去重，跨 isolate 用 R2 条件写锁（120 秒），开始前还会 `head` 一次 R2 |
| 复核 `revalidate()` | `Range: bytes=0-0` 加 `?r2c=` | 1 字节 | R2 命中，且距上次检查超过 600 秒 |
| HIT-R2 后写边缘缓存 | 只读 R2，不回源 | 0 | 每个 isolate 第一次命中 |

所以，一个新文件的回源量 ≈ 未命中时用户实际读到的字节 + 整个文件 1 次。补缓存完成前的并发请求也会透传，这一部分见第 2.4 节。

## 2. 数据

### 2.1 Supabase 侧：11-06 UTC 0–16 时，按请求类型拆分

数据来自 `edge_logs`，字节数是响应头 Content-Length 的总和。Content-Length 是声明长度，不是实际传输量，开区间 Range 和 HEAD 会被高估。

| 类别 | 请求数 | 路径数 | Content-Length 合计 |
|---|---:|---:|---:|
| Worker 补缓存（`r2c=`，无 Range） | 2,031 | 2,027 | 27.6 GB |
| Worker 复核（`r2c=`，`bytes=0-0`） | 1,930 | 624 | ≈0 |
| 透传的媒体 GET，带 Range | 3,148 | 1,212 | 22.8 GB |
| 透传的媒体 GET，无 Range | 1,497 | 857 | 9.9 GB |
| 透传的媒体 HEAD（没有正文，不计费） | 224 | 188 | 1.8 GB |
| 透传的非媒体扩展名（json/md 等） | 13,463 | 299 | 0.03 GB |
| 透传的 `?t=` 等带参数请求 | 148 | 30 | 0.002 GB |
| 不经过 Worker 的 supabase.co 直连（非 Cloudflare 出口） | ~1,300 | – | ≈0.003 GB |
| cdn.makaron.app `/storage/v1/render/image` | 1,843 | – | 0.10 GB |

补缓存请求在 Supabase CDN 上的状态：HIT 1,896 次、26.3 GB，MISS 135 次、1.3 GB。复核请求 HIT 1,378 次、MISS 552 次。

透传的媒体 GET 按 Range 形态拆分：`bytes=0-` 1,341 次，18.2 GB；无 Range 1,028 次，9.9 GB；闭区间 1,193 次，3.6 GB；从 N 开始的开区间 210 次，1.0 GB。

### 2.2 和 11-06 UTC 0–12 时的计费对账

| 项目 | GB |
|---|---:|
| Supabase Usage 计费（cached 26.1 + uncached 9.4） | 35.5 |
| 其中补缓存（整文件，Content-Length ≈ 实际传输） | 22.9（HIT 21.8 / MISS 1.1） |
| 其中透传（Content-Length 28.6，实际约为 35.5 − 22.9） | ≈12.6 |
| CF 边缘 `miss`（eyeball） | 9.0 |

透传实际字节（约 12.6 GB）比 CF 的 MISS（9.0 GB）多约 3.6 GB，差约 40%。可能有两个原因：一是客户端断开前，Supabase 已经把数据发给了 Worker；二是 CF 状态和 Worker 层级的对应关系不是一一对应（见第 2.5 节）。11-04 上线前也有类似的系统性差距：CF eyeball 102 GB，计费 118 GB，Content-Length 合计 184 GB。

**也就是说，「35.5 GB 远多于 9.0 GB」，约 2/3 来自补缓存，约 1/3 来自透传，而且透传本身在两边的统计口径也不同。**

### 2.3 补缓存的对象是什么时候创建的（预热还是稳态）

把补缓存的路径和 `storage.objects.created_at` 对比：

| 补缓存时段（UTC） | 上线后新建 | 上线前 30 天内 | 更老 | 找不到 |
|---|---|---|---|---|
| 11-05 13:10–24:00 | 165 个 / 2.3 GB | 358 个 / 9.4 GB | 23 个 / 0.6 GB | 3 |
| 11-06 00:00–16:00 | 1,419 个 / 13.9 GB | 585 个 / 13.3 GB | 19 个 / 0.2 GB | 4 |

- 预热部分（上线前的老文件）在 11-06 仍有约 50%。这部分会随时间下降，但 R2 有 30 天过期规则，仍被访问的热文件每 30 天会再补一次。
- 稳态部分（新文件）按 11-06 的速度约 20 GB/天。cached 单价是 $0.03/GB，约 $0.6/天，约 $19/月。

### 2.4 透传请求和补缓存之间的时序

11-06 UTC 0–16 时，无查询参数的媒体 GET 透传请求：

| 阶段 | 请求数 | 路径数 | Content-Length |
|---|---:|---:|---:|
| 补缓存开始之前（基本就是触发补缓存的那一次） | 2,087 | 1,878 | 24.6 GB |
| 补缓存开始后 120 秒内（补缓存还在进行时的并发请求） | 383 | 218 | 4.5 GB |
| 补缓存开始 120 秒之后 | 43 | 41 | 0.03 GB |
| 整个时段都没有补缓存 | 2,132 | 36 | 3.5 GB |

最后一行「整个时段都没有补缓存」的明细：13 个 wav，content-type 为 `application/octet-stream`，被请求 1,198 次，3.4 GB；它们大多是 `bytes=78-` 这类开区间 Range，看起来像是重复的音频解码读取。另有 400 响应（`NoSuchKey`）约 900 次，字节为 0。

### 2.5 CF 侧（`httpRequestsAdaptiveGroups`，cdn.makaron.app `/storage/v1/object/public/*`）

| 时段（UTC） | 结果 |
|---|---|
| 11-04 全天（上线前） | eyeball 37,132 次 / 102.2 GB，全部是 `dynamic` |
| 11-06 0–12 时 | `hit` 87.9 GB，`none` 31.3 GB（206 共 8,686 次，修复前 HIT-R2 的整对象请求也回 206），`miss` 9.0 GB，`edgeWorkerFetch` 0.1 GB |
| 11-06 15:50–16:20（修复后约 30 分钟） | 出现 `none` + 200（13 次 / 0.19 GB），说明不带 Range 的 HIT-R2 已经改回 200 |

注意：Worker 访问 supabase.co 的子请求属于 Supabase 自己的 zone，不会出现在我们 zone 的 `httpRequestsAdaptiveGroups` 里，所以「回源字节」只能看 Supabase 侧。`hit` / `none` / `miss` 和 HIT-EDGE / HIT-R2 / MISS 的对应关系是推断出来的，没有逐条核对。

### 2.6 库里 content-type 错误的媒体对象（`storage.objects`，bucket `images`）

| 扩展名 | mimetype | 个数 | 容量 | 近 7 天新增 |
|---|---|---:|---:|---:|
| wav | application/octet-stream | 763 | 2.56 GB | 112 |
| mp3 | application/octet-stream | 44 | 0.03 GB | 2 |
| m4a | application/octet-stream | 33 | 0.02 GB | 0 |
| mp4 | application/octet-stream | 5 | 0.27 GB | 0 |
| 其他（webm、gif、jpg、text/plain 的 mp4） | | 9 | ≈0 | 0 |

近 7 天新增的 wav 全部在 `<user>/workspace/<project>/media/*.wav`。代码里推断 content-type 的地方都没有覆盖音频，包括 `src/lib/workspace.ts:403` 的 `extToContentType`、`src/lib/media-sandbox.ts:163` 的 `guessContentType`、`src/lib/agent-tools.ts:1011` 的 `inferWorkspaceContentType`，未匹配时一律落到 `application/octet-stream`。具体是哪条写入路径产生的这批 wav，还没有逐条确认。

### 2.7 代码里直连 supabase.co 的地方

- `NEXT_PUBLIC_SUPABASE_URL` 在生产环境是 `https://cdn.makaron.app`，`getPublicUrl` 生成的都是 CDN 域名。`normalizeDomain()` 会把旧的 supabase.co URL 改写成 CDN 域名。
- 上传走 `/storage/v1/object/<bucket>`、TUS 和签名上传，这些是 ingress，不产生 egress。
- `getOptimizedUrl()` 会生成 `/storage/v1/render/image/public/...`。它走 cdn.makaron.app，但不在 Worker 路由里，所以直接透传到 Supabase。实测量约 0.1 GB/16 小时，可以忽略。
- 日志里非 Cloudflare 出口访问 supabase.co 的请求（AWS 东京、MonoCloud 等），11-06 合计约 3 MB。

## 3. 候选原因排序

| 排名 | 候选 | 判断 | 证据 |
|---|---|---|---|
| 1 | ① 补缓存拉整个文件 | **确认是主因**，约占 11-06 计费的 65% | 第 2.1、2.2 节；没有重复触发（2,031 次 / 2,027 个路径） |
| 2 | ② 预热 | **确认**，约占补缓存的一半，会逐步消失 | 第 2.3 节 |
| 3 | ④ 计费口径 | **确认是统计差异的来源之一** | 补缓存在 Supabase CDN 上是 HIT，按 cached 计费；edge_logs 的 Content-Length 高估实际传输（11-04：184 GB 对 118 GB）；Usage 按 UTC 日统计，11-05 包含上线前 13 小时；未缓存 egress 本质上就是新文件的第一次读取 |
| 4 | 新发现：音频 octet-stream 进不了 R2 | **确认**，量不大但会一直存在 | 第 2.4、2.6 节 |
| 5 | 补缓存期间的并发透传 | 存在，量小 | 120 秒窗口内 383 次请求、4.5 GB（Content-Length） |
| 6 | ③ 直连绕开 CDN | **排除** | 第 2.7 节，约 3 MB |
| 7 | ⑤ 206 重试 | **排除**（对 egress 而言） | 206 响应由 R2 提供，不回源；能确认的失败只有 4 次 |

## 4. 缺的数据和获取方式

| 缺什么 | 怎么拿 |
|---|---|
| 11-06 和 11-07 的完整一天 | 11-07 10:00 CST 的定时任务会查 Supabase Usage；Supabase 侧的拆分可以用本文的 SQL，每次查询最长 24 小时，结果最多 1000 行，要分时段查 |
| 补缓存失败的原因（`fill_version_mismatch`、`bg_error`），以及因 `fillableOrigin` 不通过而白拉的字节 | Workers Observability（采样 5%）。wrangler 的 OAuth token 调 telemetry API 返回 403，需要在 Dashboard 里看，或者建一个带 `Workers Observability Read` 权限的 API token |
| 实际传输字节（不是 Content-Length） | edge_logs 里没有这个字段。只能用 Usage 页的总数对账，或者看 CF eyeball 的 `edgeResponseBytes` |
| 预热消退曲线 | 每天跑一次第 2.3 节的「补缓存路径 × created_at」统计，看老文件占比 |
| wav 的写入方 | 查 `agent_tool_history` 或 workspace_files，看这 112 个 wav 是哪个工具写的 |

## 5. 优化方案

金额按 11-06 的业务量估算：cached $0.03/GB，uncached $0.09/GB。

| # | 方案 | 预计节省 | 风险 | 改线上吗 |
|---|---|---|---|---|
| A | **什么都不做，等预热结束** | 补缓存中的老文件部分约 20 GB/天，约 $0.6/天，几天到几周内归零 | 无 | 否 |
| B | **修正音频 content-type**：在 `workspace.ts`、`media-sandbox.ts`、`agent-tools.ts` 中补上 wav/mp3/m4a/aac/ogg/flac/opus；另外 Worker 遇到 `application/octet-stream` 时，只要扩展名在 `MEDIA_EXT` 里也允许补缓存，这样已有的 763 个对象也能覆盖 | 最多约 5 GB/天（Content-Length 上限），约 $2–5/月；Lambda 读音频也会更快 | 低。Worker 侧要确认返回给客户端的 content-type 保持源站原值 | 应用代码要发布；Worker 要部署。都需要用户批准 |
| C | **未命中且是不带 Range 的完整 GET 时，直接 tee 用户响应写入 R2**，不再单独补缓存 | 省掉这类对象的补缓存，约 10 GB/天，约 $10/月 | 中。tee 要处理客户端断开：断开后要么继续读完写入 R2，要么放弃；对 200 响应要保留 ETag 校验 | 改 Worker，需要批准 |
| D | **上传时写透（write-through）**：服务端生成的媒体上传 Supabase 后，同时把字节写进 R2，例如通过 Worker `/__r2c/put` 加鉴权，并校验 Supabase ETag | 新文件的补缓存（约 20 GB/天，$19/月）加上一部分首读 uncached（最多约 19 GB/天，约 $50/月），上限约 $60–70/月 | 高。要改上传链路；双写一致性是问题；Vercel 出站流量成本没核实；Codex 分支在这个方向上踩过坑（tee 堆内存、副本重复领取） | 改应用和 Worker，需要批准，建议先做方案设计 |
| E | **`bytes=0-` 的未命中由 Worker 改为整文件请求并 tee** | 不确定，可能反而更贵：首读会从「用户实际读的部分按 uncached 计 + 整文件按 cached 计」变成「整文件按 uncached 计」，客户端断开越早越亏 | 中 | 不建议 |
| F | **修正 `r2c=` 绕不开 Supabase CDN 的问题**（属于正确性问题） | 费用为负：补缓存会从 cached 变成 uncached，约 3 倍价格 | 低 | 建议只修 README 的说法，保留 ETag 校验和覆盖写触发器作为主要防线；如果确实要绕开 CDN，先在测试域名上验证请求头或参数的效果 |

建议顺序：先 **A + B**（B 改动小、确定能省），再评估 **C**。**D** 是唯一能显著降低未缓存 egress 的方案，但改动大，等 11-07 的整天数据出来后再决定要不要做方案设计。

## 6. 复现查询

Supabase Management API：`GET /v1/projects/<ref>/analytics/endpoints/logs?sql=...&iso_timestamp_start=...&iso_timestamp_end=...`，token 用 `.env.local` 的 `SUPABASE_ACCESS_TOKEN`，不要写进文件。旧端点 `logs.all` 已返回 410。

```sql
-- 按类别统计回源字节（主机 / 是否 r2c / Supabase CDN 状态）
select log_attributes['request.host'] as host,
  if(position(log_attributes['request.search'],'r2c=')>0,'r2c','-') as r2c,
  log_attributes['response.headers.cf_cache_status'] as sbcache,
  count() as n,
  round(sum(toInt64OrZero(log_attributes['response.headers.content_length']))/1e9,3) as gb
from logs where source='edge_logs' and log_attributes['request.path'] like '/storage/v1/object/public/%'
group by host, r2c, sbcache order by gb desc
```

第 2.3 节的做法：先导出补缓存路径（`r2c=` 且没有 Range，按路径 `group by`，每 ≤6 小时查一次，避免超过 1000 行的上限），再用 Management API 的 `database/query`（`read_only: true`）和 `storage.objects` 按 name 关联，比较 `created_at`。

## 7. 方案 B 实施（2026-11-07，只到测试环境）

用户批准先做方案 B。

**写入路径确认**：近 7 天新增的 112 个 wav，文件名都是 `<13位毫秒时间戳>-<slug>.wav`，比如 `-master.wav`、`-mix.wav`、`-vo-norm.wav`，对应 `src/lib/media-sandbox.ts` 中 run_code（Node + FFmpeg）产物的保存逻辑：`saveOutput()` 和 outputs 自动保存。这两处都用 `guessContentType` 推断类型，以前没有音频。

**应用侧**：新增 `src/lib/media-content-type.ts`，扩展名列表和 Worker 的 `MEDIA_EXT` 一致：mp4/m4v/mov/webm、mp3/wav/m4a/aac/ogg/oga/opus/flac、jpg/jpeg/png/webp/gif/avif。`workspace.ts` 的 `extToContentType`、`media-sandbox.ts` 的 `guessContentType`、`agent-tools.ts` 的 `inferWorkspaceContentType` 都改为使用它，各自原有的非媒体映射（md/json/txt/pdf 等）不变。
- 行为变化：音频从 `application/octet-stream` 变为 `audio/*`。`read_file` 读音频时，会走已有的「音视频只返回元数据和本地路径」分支，不再把整个文件转成 base64。
- 新增 `.avif` 识别。`.heic` 和 `.svg` 仍然不算媒体，与 Worker 一致。
- 单测 `__tests__/mediaContentType.test.ts` 会校验这张表覆盖 Worker `MEDIA_EXT` 的全部扩展名。

**Worker 侧**：`isMediaResponseType(contentType, pathname)` 接受 `application/octet-stream` 加媒体扩展名，补缓存条件和 `fillableOrigin` 都改为使用它。返回给客户端的 content-type 保持源站原值。

**验证**：`tsc --noEmit` 通过；相关 vitest 9 个文件 47 条通过；Worker `npm test` 19/19 通过；测试域名上 octet-stream 的 wav 第 2 次请求即为 `HIT-R2`，content-type 不变；`acceptance.sh` 15/15 通过。详见 Worker README。

**已有的 763 个对象**：部署 Worker 后，它们在下次被读取时自动进入 R2，不需要批量改 Storage 元数据。不建议直接 `update storage.objects.metadata`：这只改数据库，不改底层对象的 Content-Type，会造成不一致。如果以后确实想统一，只能重新上传（带正确的 content-type 和 `x-upsert`）。覆盖写会触发 purge，但重新上传的收益只是 content-type 更规范，不省流量，所以不建议做。

**上线步骤（都需要用户验收和批准）**：
1. 生产 Worker：在 `services/media-r2-cache` 运行 `npx wrangler deploy`。回滚用 `npx wrangler rollback c53679db-c4b7-46f3-846b-346fb1529196`。部署后，对一个已有的 octet-stream wav 连续请求两次，确认第 2 次是 `HIT-R2` 且 content-type 不变，再跑一遍 `TEST_HOST=https://cdn.makaron.app` 的 acceptance。
2. 应用：把本分支合入 `dev`，按仓库发布流程执行 `release:prod`（Vercel）。新产出的音频会带 `audio/*`。
3. 两步互不依赖。先做第 1 步，已有对象立刻生效。
4. 第二天用第 2.4 节的查询复核：「整个时段都没有补缓存」里的 wav 应该消失。
