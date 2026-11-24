# 上传时写透 R2（方案 D）设计（2026-11-24）

- 时间：2026-11-24（`date +%F`），CST。只写设计，**没有改代码、没有部署、没有调用任何线上写接口**。
- 依据：`docs/ops/supabase-cost-next-20261124.md`（提交 `6e62c3e3`）§2.2、§2.4；`services/media-r2-cache/src/worker.mjs`、`README.md`、`sql/purge-on-overwrite.sql`；下文行号都基于当前分支 `b8bd2589`。
- 一句话：服务端把产物传到 Supabase 后，再把**同一份字节**推给 Worker 的新接口 `PUT /__r2c/put/...`；Worker 用 1 字节探测向 Supabase 取权威元数据，校验后写进 R2，键和元数据格式与 `fill()` 一致。第一次回读就是 `HIT-R2`，不再产生 Supabase egress。

## 0. 结论

1. **推荐方案 (a)：带鉴权的 Worker 写入接口，元数据由 Worker 自己向源站探测。** 应用侧只需要一个 `writeThroughR2(path, bytes, contentType)` 帮手函数，挂在 3 个汇聚点上（`workspace.ts` 的 `dbWriteFile`、`storage.ts` 的 `uploadVideo` / `uploadAudio`），就能覆盖绝大部分“刚上传就回读”的字节。
2. 所有服务端产物在上传时**字节都已经在 Vercel 函数或 Fly worker 的内存里**（包括 Sandbox 的 run_code 产物，它们会先拷回函数再上传）。所以不需要在 Sandbox 里放任何密钥，也不受 Vercel 请求体 4.5 MB 的限制（那只限制入站请求）。
3. 写透失败**绝不影响**用户的上传，只是回到今天的懒加载补缓存（`fill()`）。
4. 方案 (c)“上传后让 Worker 去源站拉一次”只能省掉补缓存那一份 cached egress，**每月最多约 $7**；方案 (a) 约 **$25–30**。
5. 工作量约 **3 人日**，另需约 1 周观察。覆盖不到的：Remotion Lambda 直写 Supabase S3 的成片、浏览器直传、V/OpenClaw 的 `nightshift/`。

## 1. 生产方清单

### 1.1 读取方是谁（来自报告 §2.2，加代码推断）

11-23 透传 MISS 的前 400 个对象里，343 个（11.2 GB）在上传后 2 分钟内就被读取。

| UA | 推断来源 | 依据 |
|---|---|---|
| `Lavf/61.1.100`（12.5 GB，`bytes=0-`） | Vercel 函数或 Sandbox 里的 `ffmpeg-static` | `package.json` 中 `ffmpeg-static ^5.3.0` 对应 FFmpeg 7.0，即 Lavf 61.1.100。Agent 在 run_code 里直接 `ffmpeg -i <url>`，或者 `media-sandbox.ts:204` 读取 source range |
| `Lavf/59.27.100`（2.1 GB） | Debian bookworm 自带的 FFmpeg 5.1 | `Dockerfile.remotion-worker` 基于 `node:24-bookworm`，用 apt 安装 ffmpeg（Fly 上的 remotion-export worker）；也可能是 V 侧的机器 |
| `node`（1.4 GB，完整 GET） | 服务端 `fetch(storageUrl)` | `workspace.ts:492` 的 `fetchFileContent`、`resolveWorkspaceFile` 的 hydrate、`media-sandbox.ts:175` 的 `downloadFile`、`remotion-export.ts` 的 `fetchRemoteBuffer` |
| 浏览器 UA 读 `nightshift/`（2.0 GB） | V/OpenClaw 的夜班任务，代码不在本仓库 | 另外 `video-frame.ts:11` 会把 UA 改成 `Mozilla/5.0 MakaronPreview/1.0`，在日志里也会被归为“浏览器” |

不管读取方是谁，只要**写入发生在下表这些服务端路径**，并且读取走的是 `cdn.makaron.app`，写透就能命中。

### 1.2 服务端写入点（按预计字节量排序）

“量”来自报告 §3.3 的存量统计；“回读”是对谁会在几秒到几分钟内读回它的判断。

| # | 写入点 | 写什么 | 典型大小 | 回读 | 量 |
|---|---|---|---|---|---|
| 1 | **`src/lib/workspace.ts:533-535` `dbWriteFile`**（汇聚点） | `<uid>/workspace/<path>`。调用方：run_code 的 `saveOutput` / `saveToWorkspace`（`media-sandbox.ts:695,712,899`，Sandbox 产物经 `media-sandbox-vercel.ts:476` 的 `readFileToBuffer` 拷回函数）；Remotion 导出成片（`remotion-export.ts:537,1007,1042`，在 Vercel 或 Fly 上运行）；Agent 的抽帧和 contact sheet（`agent-tools.ts:2505,2736,4163,4190,4260,4290,4361,4431`）；裁剪和元素编辑（`agent-tools.ts:3720,3727,3863`）；`layerize.ts:152` | `media/*.mp4` 平均约 22 MB（523.9 GB / 23,682 个）；`media/*.wav` 约 3.7 MB；`drafts/*.jpg` 约 170 KB | **高**。下一步 run_code 会立刻把它当输入拉回（node / Lavf）；Agent 会把帧图 URL 交给视觉模型；成片发布后会抽海报、做 CLI 下载 | **最大**。`workspace/*/media/*.mp4` 是站长账号 420 GB 的主体，正是报告里 86% 的那部分 |
| 2 | **`src/lib/supabase/storage.ts:141-165` `uploadVideo`** | `<uid>/<pid>/videos/<id>.mp4`，把服务商生成的视频落盘。调用方：`agent/run/[id]/route.ts:566,632,716`（轮询落盘，在 `after()` 里）、`agent-tools.ts:165,2358`、`animate/[taskId]/route.ts:138`、`video-snapshot/[snapshotId]/route.ts:77`、`projects/create/route.ts:244,400` | 5–30 MB | **高**。落盘后马上抽海报（`video-poster-repair.ts`），CUI 和 CLI 拿到永久 URL 后立刻播放或下载，Agent 接着做剪辑 | 大。旧结构 `<uid>/<pid>/*.mp4` 共 118 GB |
| 3 | **`storage.ts:201-232` `uploadAudio`** | `<uid>/<pid>/audio/<task>-<n>.wav/mp3`（Seed Audio、配音）。调用方：`skills/create-audio.ts:128`、`seed-audio-reference.ts:94` | WAV 约 4 MB（74.2 GB / 18,476 个） | **高**。Remotion 预览和导出、run_code 混音都会立即读取 | 中。每周新增约 10 GB |
| 4 | `video-retake.ts:29-34`、`video-upscale-pipeline.ts:42-47` | Retake 和高清化的成片、截图 | 5–30 MB | 高（交付后马上播放） | 中小 |
| 5 | `provider-video-reference.ts:217-229` | `provider-inputs/<uuid>.mp4`，作为参考视频给服务商 | ≤ `MAX_REFERENCE_BYTES` | **高**。服务商几秒内就会来拉 | 小 |
| 6 | 海报：`storage.ts:171-195` `uploadPoster`、`agent-tools.ts:185`、`video-poster/route.ts:32`、`projects/create/route.ts:257,413` | `posters/*.jpg` | 50–300 KB | 中（前端列表马上显示） | 小 |
| 7 | 图片：`storage.ts:64-104` `uploadImage` 的服务端调用（`agentDualWriter.ts:153`、`mcp/route.ts:78`、`projects/create/route.ts:68,205,356`）、`external-image.ts:79` | 编辑结果、导入图 | 0.3–3 MB | 中。多数通过 `/render/image` 变换读取，不走 object 路径，所以 Worker 看不到 | 小 |
| — | 其他：`marketplace-skill-install.ts:77`、`admin/upload`、`profile/avatar`、`kling-image4-journal.ts`（JSON）、`remotion-preview-checkpoint.ts`（另一个 bucket） | | | 低 | 可忽略，不接 |

**覆盖不到的：**

- **Remotion Lambda 直写 Supabase S3**（`remotion-export.ts:205-233,900-966`，`REMOTION_LAMBDA_SUPABASE_DIRECT_OUTPUT` 没关时生效）：成片字节不经过我们的进程。要覆盖，只能让 Lambda 同时写 R2，或者对这一条用方案 (c)。生产上这个开关是什么状态，需要确认（见 §5）。
- **浏览器直传**（`Editor.tsx:1848,2472,3887`、`storage.ts:379` 的 `uploadBlobWithProgress`、`api/storage/upload-url` 签名上传）：浏览器不能持有写入密钥。这部分是用户素材，回读一般不在 2 分钟内，继续走懒加载补缓存。
- **`nightshift/` 等 V/OpenClaw 前缀**：代码在仓库外。接口上线后，可以给 V 单独发一把密钥，让它按同样的协议调用。
- `video-upscale-pipeline.ts:46` 返回的是 `getPublicUrl` 原值，没有经过 `toPublicStorageUrl`。如果生产环境的 `NEXT_PUBLIC_SUPABASE_URL` 就是 `cdn.makaron.app`，这两者没有区别；否则这条读取会直连 supabase.co，绕过 Worker。实现时顺手统一。

## 2. 写入接口的三个选项

### (a) Worker 鉴权写入接口（推荐）

`PUT https://cdn.makaron.app/__r2c/put/images/<url 编码的 path>`

- 请求头：`authorization: Bearer <R2C_WRITE_SECRET>`（**新开一把密钥，不复用 `PURGE_SECRET`**）、`content-length`（必须有）、`content-type`；可选 `x-r2c-md5`（应用顺手算出的 hex）。请求体就是原始字节。
- 现有路由 `cdn.makaron.app/__r2c/*` 已经覆盖这个路径，不需要新路由。
- Worker 的处理步骤：
  1. 校验鉴权；用 `cacheTarget()` 算出键（复用 `MEDIA_EXT`、`..` 检查，键是 `v1/images/<path>`），算不出就返回 400。`content-length` 超过 `MAX_PUT_BYTES` 时返回 413，应用侧跳过。
  2. **向源站做 1 字节探测**，和 `revalidate()` 完全相同：`freshOriginUrl` 加 `range: bytes=0-0`、`accept-encoding: identity`。要求返回 206、强 ETag、`content-range` 里的总长等于 `content-length`、`isMediaResponseType` 为真、`cache-control` 不含 private/no-store。任何一项不满足就返回 409，不写。
  3. R2 里已经有这个键、而且 etag 相同（并发 `fill()` 已经写过）：把请求体读完丢弃，返回 200 `{stored:false, reason:"exists"}`。
  4. 请求体分两路：一路经 `FixedLengthStream(size)` 写入 R2（R2 的流式 put 要求长度已知），另一路进 `crypto.DigestStream('MD5')`。`httpMetadata` 和 `customMetadata` 与 `fill()` **逐字段一致**：`etag`、`lastModified`、`cacheControl` 来自探测响应，`checkedAt=now`，`sourceSize=size`，另外加一个 `writer:"put"` 方便统计。
  5. 写完后：如果 etag 是单段 MD5 形式（`"<32 位 hex>"`），把它和计算出的摘要比对，不一致就删掉对象，返回 409。多段 ETag（`"...-N"`）只能核对大小，剩下的交给 10 分钟复核。
  6. 写日志 `{event:"put", bytes}`，不记录路径（沿用 `log()` 的约定）。
- 第一版不写边缘缓存。原因：写入请求所在的机房不一定是读取方的机房；而且多 tee 一路会增加内存压力。R2 命中后，`serveR2` 会顺带把对象放进读取方所在机房的边缘缓存。

**为什么选它：**

- **密钥只在服务端。** 需要密钥的只有 Vercel（Production）和 Fly 的 remotion worker 的环境变量，以及 Worker secret。Sandbox 跑的是不可信的 Agent 代码，**不放任何密钥**，也不需要：产物都会先拷回函数。
- **元数据只有一个真相源。** etag、last-modified、cache-control 都由 Worker 从源站探测得到，和 `fill()`、`revalidate()` 走同一套代码，应用侧不用猜 Supabase 的 ETag 格式（单段和多段格式不同）。键格式（`KEY_VERSION`）也只留在 Worker 里。
- **可以校验。** 大小和源站一致才写；单段 ETag 还会核对 MD5。即使密钥泄露，也只能写进“和源站当前版本大小一致”的内容。
- **请求体大小：** 应用这一侧，从函数发出的 fetch 不受 Vercel 4.5 MB 的限制。Worker 这一侧，入站请求体的上限按 zone 套餐算（Free/Pro 100 MB，Business 200 MB，Enterprise 500 MB，**上线前按官方文档复核**）。`cdn.makaron.app` 的上传本来就经过同一个 Cloudflare 代理，受同样的上限，所以写透能覆盖的文件范围和今天能上传的一样。产物 mp4 平均约 20 MB，超过 100 MB 的极少，直接跳过即可。
- **流式写入：** Worker 只有 128 MB 内存，所以必须流式写入（`FixedLengthStream`），不能调用 `arrayBuffer()`。应用侧的字节本来就在内存里，直接作为 body 发送。
- 成本：每写一次，Worker 多一个请求，Supabase 多一个 1 字节探测，R2 多一次 Class A 写入。本月 R2 Put 约 10 万次，免费额度是 100 万次；写透每月估计增加 5–20 万次，仍在额度内。

### (b) 应用直接用 R2 S3 API

- 需要在 Vercel 和 Fly 上配置 R2 的 Access Key（权限按 bucket 划分，**无法限制到前缀**，而且能读写删整个缓存桶）。`@aws-sdk/client-s3` 已经是依赖（`remotion-export-media.ts` 在用）。
- 优点：没有 100 MB 限制，可以分段上传；少经过一跳。
- 缺点：应用要自己复刻 `v1/<bucket>/<path>` 键格式和 `customMetadata` 格式，Worker 一改，两边就会不一致；ETag 要应用自己去取（`storage.from().info()` 调 `/object/info`，或带 service key 做一次 HEAD），还要处理单段和多段两种格式；没有服务端校验，一旦写错，读者会拿到错误内容，直到 10 分钟复核才被清掉。
- 结论：**不推荐**。只在将来确实需要覆盖大于 100 MB 的文件时，作为补充。

### (c) Worker “预热”接口：应用通知，Worker 去源站拉一次

- 实现最简单：`POST /__r2c/prime {paths}`，Worker 直接调用现有的 `fill()`。
- **但它省不了未缓存 egress。** `fill()` 带唯一的 `r2c=` 参数直读 Storage；刚上传的对象在 Supabase CDN 上必然 MISS，所以每个对象仍然产生一次完整的未缓存 egress。
- 和现状对比：现在每个“刚上传就回读”的对象，大约是 1 次未缓存（读取方 MISS）加 1 次 cached（`fill` 时 Supabase CDN 已被前一次读取预热，报告 §2.1 显示 `r2c` 读取基本都是 HIT）。预热之后变成 1 次未缓存加 0 次 cached，**只省掉 cached 那一份**。按报告的数据：cached 每个工作日约 20–25 GB，乘以 22 个工作日约 450–550 GB/月，扣掉 250 GB 额度后，超额部分 ×$0.03 ≈ **每月最多 $7**；未缓存那一份（约 $24/月）一分不省。
- 还有竞态：读取方常常几秒内就来读；如果预热还没拉完，读取方照样 MISS，这次就什么都没省。若改成等预热完成再返回 URL，延迟等于再下载一遍整个文件，比 (a) 更慢。
- 适用范围：只适合**字节不经过我们进程**的路径，例如 Lambda 直写和浏览器直传。可以作为 (a) 之后的补充，不作为主方案。

## 3. 一致性

### 3.1 元数据

Worker 读取时依赖的字段（`metaFromR2`）：`customMetadata.etag`、`lastModified`、`cacheControl`、`checkedAt`，`httpMetadata.contentType`、`contentDisposition`，以及 `object.size`。复核（`revalidate`）只比较 **etag 和 size**。

- 写透时，这些字段全部来自 Worker 对源站的 1 字节探测，用 `metaFromOrigin()` 解析，和 `fill()` 的来源完全一致。所以 `serveR2` 的响应头、`If-None-Match` 返回 304、10 分钟复核，行为都和懒加载补缓存出来的对象没有区别。
- 不依赖应用侧拿 ETag。supabase-js 的 `upload()` 只返回 `{id, path, fullPath}`，不带 ETag；`info()` 和 HEAD 虽然能拿到，但会多一次请求，还要处理格式。
- `?download=` 变体不写透，第一次请求时照常懒加载。

### 3.2 覆盖写（upsert）

- 新路径（绝大多数情况：`Date.now()`、uuid、snapshotId 命名）走的是 INSERT，触发器不会触发，没有竞态。
- 覆盖已有路径时，会触发 UPDATE，eTag 变化，`r2c_purge_media_object` 通过 pg_net **异步**调用 `/__r2c/purge`，通常在 1 秒左右到达。
  - 如果写透先完成、purge 后到：新写入的副本会被删掉，结果只是回到懒加载补缓存。**安全，但这一次没省到。**
  - 如果 purge 先到、写透后到：写透前的探测拿到的是新版本，写进去的就是新版本。**正确。**
  - 如果两个写入方并发覆盖同一路径：探测拿到的版本可能不是本次上传的内容。单段 ETag 有 MD5 校验兜底；多段 ETag 时大小相同的概率极低，而且触发器 purge 和 10 分钟复核还会再兜一次。
- 可选优化（不在第一版）：purge 时先探测源站，如果 R2 里的 etag 与源站一致，就不删。这会改变 purge 的语义，等数据证明覆盖写时的浪费值得优化再做。

### 3.3 删除

不需要改动。触发器在删除时 purge R2 和边缘缓存；R2 的 `v1/` 前缀 7 天后由生命周期规则自动过期。写透的对象同样受这两条约束。

### 3.4 失败处理

- 应用侧：`writeThroughR2()` **永远不抛错**，内部 try/catch，带超时（例如 `5s + size / 10MB/s`，上限 20s），超时就 `AbortController.abort()`。R2 的 put 是原子的，中途中断不会留下半个对象。
- 必须在 Supabase 上传**成功之后**才调用；上传失败就不调用。
- 要**等写透完成（或超时）再返回 URL**。原因是读取方往往几秒内就来；如果写透放在后台进行，第一次读取仍可能 MISS。对于本身已经在 `after()` 里运行的路径（视频轮询落盘），等待不会影响用户感知。
- Worker 返回 4xx/5xx、超时、网络错误时，只记一条日志（不含路径），然后继续正常流程。读取时自然回退到现有的 MISS 加 `fill()`。
- Worker 侧另加一个开关 `R2C_PUT_DISABLED=1`：开启后接口直接返回 503，应用视为跳过。这是最快的止血手段。

## 4. 上线计划

1. **Worker（测试环境 `makaron-media-r2-cache-test`）**：实现 `PUT /__r2c/put/...`，补单测：鉴权失败 401、非媒体返回 400、大小不符 409、MD5 不符时删除并返回 409、已存在时跳过、写入的元数据与 `fill()` 完全一致、之后的 GET 为 `HIT-R2` 且 sha256 一致、`R2C_PUT_DISABLED` 返回 503。在 `scripts/acceptance.sh` 里加一段：往 `images/r2c-acceptance/` 上传后立刻写透，再 GET 应为 `HIT-R2`；覆盖写后 purge 会把旧副本清掉。
2. **应用帮手函数** `src/lib/r2-write-through.ts`：`writeThroughR2({ path, bytes, contentType })`。只处理 `MEDIA_EXT` 扩展名和 ≥ 64 KB 的文件（更小的文件省不了多少，还会增加写入次数）。读取环境变量 `R2C_WRITE_URL`、`R2C_WRITE_SECRET`、`R2C_WRITE_THROUGH=off|shadow|on`。`shadow` 模式下带 `x-r2c-dry-run: 1`：Worker 只做探测和校验、不写 R2，用来测连通性、延迟和校验通过率。
3. **接入顺序**（按字节量从大到小）：
   1. `workspace.ts` 的 `dbWriteFile`（run_code、Remotion 导出、抽帧）。**这是第一步，单项覆盖了大部分收益。**
   2. `uploadVideo`（服务商视频落盘），以及 `video-retake.ts`、`video-upscale-pipeline.ts`、`provider-video-reference.ts`。
   3. `uploadAudio`。
   4. 海报和服务端图片（收益小，可以不做）。
4. **密钥**：Worker 用 `wrangler secret put R2C_WRITE_SECRET`；Vercel 只配 Production（Preview 是否开启见 §5）；Fly remotion worker 用 `fly secrets set`。**不写进仓库、不写进文档、不加 `NEXT_PUBLIC_` 前缀、不传进 Sandbox。**
5. **流程**：先 `shadow` 2 天，再对第一步开 `on`，观察 3 个工作日后再逐步接入后面几步。

**怎么量效果：**

| 指标 | 来源 | 目标 |
|---|---|---|
| 首读 MISS 中“上传后 2 分钟内被读取”的字节 | Supabase `edge_logs` 与 `storage.objects.created_at` 关联（报告 §2.2 的查询） | 11.2 GB/工作日 → < 1.5 GB |
| `r2c=` 补缓存流量（cached） | `edge_logs` 中带 `r2c` 的请求 | 26.5 GB/工作日 → < 5 GB |
| 写透次数、字节、失败率、耗时 p50/p95 | Worker 日志 `put` 事件；应用日志 `[r2-write-through]` | 失败率 < 2%；p95 < 3 s（20 MB） |
| `HIT-R2` 与 `MISS` 的比例 | 对样本对象抽查 `x-makaron-cache` 响应头（CF 的 GraphQL 不能按自定义响应头分组）；或者在 Worker 日志里按事件计数 | MISS 明显下降 |
| 账单 | Supabase Usage 页每日的 uncached / cached egress | 工作日未缓存 egress 从约 21 GB 降到约 6 GB 以下 |
| 对用户的影响 | `remotion_export_jobs.metadata.stageTimings.workspaceWriteMs`、run_code 各阶段耗时 | 每次上传增加的耗时 < 1–3 s |

**回滚**（任选其一，互不依赖）：

- Worker 设 `R2C_PUT_DISABLED=1` 后重新部署（最快）；
- Vercel / Fly 设 `R2C_WRITE_THROUGH=off`（Vercel 要重新部署才生效）；
- `wrangler rollback` 到上一版 Worker。

已经写进 R2 的对象不需要清理：它们和懒加载补缓存出来的对象完全一样，会按 7 天规则自动过期。

## 5. 工作量与待确认问题

**工作量**（约 3 人日，另加约 1 周观察）：

| 项 | 估计 |
|---|---|
| Worker 接口和单测（约 100 行，加 8–10 条测试） | 1 天 |
| 应用帮手函数、3 个汇聚点和 4 个零散写入点、单测 | 1 天 |
| 测试环境验收（acceptance.sh 加段）、配密钥、shadow 观察 | 0.5 天 |
| 分步开启和量化复盘（写回本文或报告） | 0.5 天，跨约 1 周 |

**请站长确认：**

1. **zone 套餐和请求体上限**：`makaron.app` 是 Free、Pro 还是更高？这决定 `MAX_PUT_BYTES` 设为 100 MB 还是 200 MB。
2. **Remotion Lambda 直写**：生产上 `REMOTION_LAMBDA_SUPABASE_DIRECT_OUTPUT` 和 `SUPABASE_S3_*` 有没有配置？如果在用，成片不经过我们的进程，要另想办法（Lambda 同时写 R2，或者对这一条用方案 (c) 预热，每次多一份未缓存读取）。
3. **Vercel 函数区域**：报告 §2.3 显示服务端请求来自日本，推断函数在 `hnd1`，和 R2 APAC、Supabase 东京同区域。请确认，因为这决定写透的延迟。Fly worker 在哪个区域？
4. **Preview 部署**要不要开启写透？（Preview 连的也是生产 Supabase，开启后同样能省钱，但要多一个环境配置密钥。）
5. **octet-stream 修复**：README 里 2026-11-07 的修复写着“只上了测试环境”。请确认 11-19 部署的生产版本是否已经包含（`isMediaResponseType`）。如果没有，`.wav` 文件写透时会被 409 拒绝。
6. **V/OpenClaw 的 `nightshift/`**：要不要给 V 单独发一把写入密钥，让它也走写透？代码在仓库外，量约 2 GB/工作日。
7. **小文件门槛**：`drafts/*.jpg`（约 170 KB，量很大）要不要写透？它们大多被视觉模型立即读取，但单个很小。默认门槛 64 KB 会把它们包含进来，每月大约多 10–20 万次 R2 写入，仍在免费额度内。
