# media-r2-cache

`cdn.makaron.app` 前面的 R2 回源缓存 Worker：公开媒体文件只从 Supabase 读一次，之后由 Cloudflare 边缘缓存或 R2 直接返回，省掉 Supabase 的重复 egress（2026-11 复核约占账单 73%，同日重复读约 8.7×，见 `docs/ops/supabase-egress-review-20261105.md`）。

应用、Lambda、CLI 都不用改：URL 不变，Worker 只挂在已经橙云代理的 `cdn.makaron.app` 上。

## 读取路径

1. **边缘缓存**（每个机房各一份，TTL 60s）→ `x-makaron-cache: HIT-EDGE`
2. **R2**（`makaron-cdn-media`，APAC，与东京源站同区域）→ `HIT-R2`
3. **Supabase 源站**原样透传 → `MISS`，后台用 `waitUntil` 把完整文件写进 R2（R2 条件写当分布式锁，同一文件只回源一次）

只缓存：GET/HEAD、`/storage/v1/object/public/<bucket>/<path>`、媒体扩展名（视频/音频/图片）、无参数或只有 `?download=`。其余请求（`?t=`、JSON、签名 URL、REST）一律原样透传，没有响应头标记。

写入前检查：状态 200、媒体类型、非 private/no-store、identity 编码、强 ETag、有长度且 ≤1GiB；超过 512MiB 只进 R2 不进边缘。任何异常都回退为透传（fail open）。

## 覆盖写一致性

Makaron 绝大多数媒体文件名唯一，覆盖写很少，但要兜住：

- **触发器清除**（推荐）：`sql/purge-on-overwrite.sql` 在 `storage.objects` 更新（ETag 变化）或删除时调用 `POST /__r2c/purge`，秒级删除 R2 副本。
- **10 分钟复核**：R2 命中时，若距上次检查超过 10 分钟，后台用 1 字节请求比对源站 ETag 和大小，不一致就清除。
- **补缓存不读 Supabase CDN**：补缓存和复核请求带唯一 `r2c=` 参数直读 Storage，并要求 ETag 与本次返回给用户的版本一致，否则丢弃。原因是 Supabase CDN 按 Accept-Encoding 分别缓存且失效滞后，实测会把旧版本写回来。
- **边缘副本**：每个机房各存一份。配置 `CF_PURGE_TOKEN` + `CF_ZONE_ID` 后清除会对全部机房生效；没配时，旧副本最多保留 60 秒（与 Supabase 自身 CDN 的滞后上限相当，不比现状差）。

## 验收（2026-11-05，测试域名 `cdn-r2-test.makaron.app`）

- 单测：`npm test`，13/13 通过（含并发只回源一次、覆盖写复核、Supabase CDN 旧版本不写入）。
- 真实环境：`scripts/acceptance.sh`，15/15 通过：冷 Range 字节正确、48MiB 文件 sha256 一致、头/中/尾 Range 命中、HEAD + 304、`?t=` 透传、覆盖写后 R2 无旧版本且约 32 秒后各机房一致、清除接口鉴权、404 不缓存。测试对象写在 `images/r2c-acceptance/` 下，结束后自动删除。
- 测速（从 V 腾讯云服务器发起，7 次取中位数，缓存已预热）：

| 场景 | 直连 cdn.makaron.app | 走 Worker |
|---|---|---|
| 400KB 图片 | 124ms | 84ms |
| 32MiB 视频全量 | 3607ms | 2084ms |
| 拖动 1MiB Range | 601ms | 392ms |
| 首字节（0-0） | 283ms | 60ms |

**未验证**：Lambda（us-east-1）导出速度。按地理位置推断不会变慢：R2 与源站同在亚太，且美东机房的边缘缓存会吸收同一次渲染内的重复读取。上线后需要对比渲染耗时。

## 请求量与免费额度（2026-11-05 查 Cloudflare 分析）

Worker 只挂 `/storage/v1/object/public/*`。`cdn.makaron.app` 每天的总请求量是 50 万到 165 万次，其中大头是 `/rest/v1/agent_events` 这类轮询，不经过 Worker，也几乎不产生流量。真正会进 Worker 的请求每天大约 3.8 万到 10.7 万次（11-04 为 3.8 万，11-02 为 7.1 万，10-30 为 10.7 万），这部分对应的几乎就是全部 egress（11-04：64.4GB 中占 64.4GB）。

免费版 Workers 每天限 10 万次请求、每次请求限 10ms CPU，高峰日会超出。如果先用免费版，生产路由必须设置为 **Fail open**，超出额度后的请求直接回源 Supabase，效果等同于现状，只是少省一点钱。Workers Paid 每月 $5，在约 $100/月的预期节省面前很便宜，建议购买。

## 上线状态

- **2026-11-05 21:10 CST 已上线**：已购买 Workers Paid，生产路由 `cdn.makaron.app/storage/v1/object/public/*` 和 `/__r2c/*` 指向 `makaron-media-r2-cache`。
- 线上冒烟检查通过：真实视频和图片第一次是 `MISS`，第二次是 `HIT-R2`，sha256 与源站一致；Range 请求返回 `HIT-EDGE`，字节数正确；`?t=`、REST（401，与直连源站一致）、Auth、图片变换接口照常透传；CORS 正常；清除接口不带鉴权时返回 401。
- 覆盖写触发器已生效（Vault 密钥 `r2c_purge_secret` 已配置）。实测覆盖或删除后，R2 层的旧副本在数秒内被清掉，之后不再出现 `HIT-R2` 返回旧版本；其他机房的边缘副本仍可能返回旧版本，最多约 60 秒。
- 可选：配置 `CF_PURGE_TOKEN`，覆盖写就能在所有机房秒清。
- 待观察：响应头 `x-makaron-cache` 的命中比例、第二天的 Supabase egress、Lambda 渲染耗时。

**回滚**：把 `R2C_DISABLED` 改成 `"1"` 后重新部署，Worker 就会全部透传；也可以直接删掉路由，流量立即回到现在的直连路径。

## Lambda 回归（2026-11-05 22:00–22:40 CST）

上线后，Lambda 导出的每秒成片耗时中位数从约 750ms 升到约 1100ms。于是对同一位用户的同一批任务做了三段对照：

| 条件 | 样本 | p50 |
|---|---|---|
| Worker + R2（北美也走缓存） | 16 | 1075ms |
| Worker + 北美绕过（`BYPASS_CONTINENTS=NA`） | 7 | 1164ms |
| 暂时摘掉路由（上线前的原始路径） | 20 | 1173ms |

结论：变慢来自这一批任务本身（并发、内容更重），**和缓存无关**，所以恢复全量缓存（`BYPASS_CONTINENTS=""`）。在请求层面，美东 Lambda 冷读亚太 R2 时 p90 约 450ms，直连约 100ms，但端到端导出耗时没有差别。如果以后要让北美回到原路径，把这个变量改成 `"NA"` 重新部署即可。

后续可选优化：在边缘缓存命中后做后台复核，以便延长边缘 TTL；或者为美东单独加一个 ENAM R2 副本，减少跨太平洋冷读。

## 2026-11-06 修复：R2 命中整对象回 206

R2 的 `get()` / `head()` 不带 range 时也会返回 `range` 字段，旧版 `serveR2()` 因此把所有 `HIT-R2` 请求（包括不带 Range 的 GET 和 HEAD）都回成 206 + `content-range: bytes 0-(N-1)/N`。要求严格 200 的服务端读取（`readProviderImage`）会失败，影响 Retake 和 fal H3 Max 参考图预检，见 `docs/incidents/cdn-r2-206-impact-2026-11-06.md`。

修复：只有带合法 Range 的 GET 才回 206；不带 Range 的 GET 和 HEAD 回 200 + 完整 `content-length`；304 不变。单测里的 FakeR2 改成和真实 R2 一样总带 `range`，旧代码在新单测下会失败。

验收（2026-11-06 23:39–23:50 CST，只部署测试环境 `makaron-media-r2-cache-test`，version `ed106940-3c89-41d8-b8d3-77b9a729a012`）：
- 单测 `npm test` 17/17 通过。
- 部署前基线：测试域名上一个 13.6MB 的 mp4，不带 Range 的 GET 返回 `206 HIT-R2`（复现）。
- 部署后同一对象，两轮请求间隔 75 秒：curl HTTP/2 GET 两轮都是 `200 HIT-R2`，content-length=13618517，没有 content-range；Node `https.get`（HTTP/1.1）第二轮 `200 HIT-R2`，收到 13618517 字节；HEAD `200 HIT-R2`；`Range: bytes=0-0` 返回 `206 HIT-R2`，`content-range: bytes 0-0/13618517`；`bytes=-100` 返回 `206 HIT-R2`，content-range 正确。
- `scripts/acceptance.sh` 15/15 通过。

**2026-11-06 23:48 CST 已上生产**：version `c53679db-c4b7-46f3-846b-346fb1529196`（上一版是 `cbf223db-912d-4715-aee7-eb79ef7dcd54`，回滚用 `npx wrangler rollback cbf223db-912d-4715-aee7-eb79ef7dcd54`）。线上回归：不带 Range 的 GET 两次间隔 79 秒都是 `200 HIT-R2`；Node `https.get` 回 `200 HIT-R2`；HEAD 回 `200`；`bytes=0-0` 回 `206 HIT-R2`；真实的 `readProviderImage` 读取成功。acceptance.sh 生产模式（`TEST_HOST=https://cdn.makaron.app`，生产 purge 密钥）15/15 通过。

## 本地文件

`.secrets` 和 `launch.local.sql` 都已 gitignore，里面保存测试和生产环境的 PURGE_SECRET，不要提交。
