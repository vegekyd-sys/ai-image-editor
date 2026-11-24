# 图片变换由 Worker 接管：上线前验证报告（2026-11-24）

- 时间：2026-11-24 09:58–12:20 CST
- 被测对象：测试 Worker `makaron-media-r2-cache-test`（`cdn-r2-test.makaron.app`）。最终版本对应提交 `01747078`。
- 对照组：生产 `cdn.makaron.app`，也就是 Supabase 自己的 `/render/image`。
- 方法：同一个 URL、同一个 Accept 头，分别请求两边，比较以下几项：
  - 状态码；
  - `content-type`、`etag`、`cache-control`、`vary`、`access-control-allow-origin`；
  - 输出尺寸、是否有透明通道；
  - 像素差。两张图都缩到 64×64，分别叠在白底和黑底上，取每通道平均差的较大值，记为 d64，范围 0–255。
- 实现说明见 `services/media-r2-cache/README.md` 的 2026-11-24 一节。

## 0. 结论

**可以上线。** 真实数据上的 3,654 组请求、合成边界样本上的 1,144 组请求，以及 27 项协议和行为检查都已完成。验证中发现 6 处真实的行为不一致，全部修复后复测通过。

剩下的差异只有以下几类，都已逐项确认不影响使用：
- 缩放算法不同带来的轻微锐度差别，主要出现在 150px 以下的小缩略图上；
- `contain` 模式偶尔差 1 像素；
- CMYK JPEG 的颜色略有不同；
- Supabase 自身返回的 Vary 头不稳定。

## 1. 覆盖范围

| 样本 | 数量 | 说明 |
|---|---:|---|
| 公开项目里的图片 | 200 张 | 公开项目共 25,226 个，属于 443 个账号。按“格式 × 文件大小”分层随机抽样，每个账号每种格式最多 1 张，覆盖 166 个账号。包括 JPEG 148 张、PNG 64 张、WebP 11 张，以及 GIF、HEIC、SVG、octet-stream、mp4 各 1–3 个 |
| Agent 工作区产出 | 30 张 | 近 60 天的 `workspace/*/media/*.png|jpg`，含 ffmpeg 抽帧、截图、透明 Logo |
| 超过 20 MB 的 PNG | 6 张 | 20–35 MB |
| 扩展名和真实类型不符 | 12 个 | `.jpg` 文件里存的其实是 PNG（这类在库里普遍存在），以及反过来的情况 |
| 头像、技能图、模板图 | 12 张 | `skills/`、`marketplace/`、头像 |
| 特殊路径 | 1 个 | |
| 合成边界样本 | 26 个 | 见 §4，测完已删除 |

参数共 21 组，**全部取自应用代码里真实拼出来的组合**（`getOptimizedUrl`、`getThumbnailUrl`、`getOriginFormatThumbnailUrl`、`layer-preview` 的调用点）：
- `width=2000&quality=95&resize=contain`；
- 只给宽度的 `800/75`、`600/80`、`600/85`；
- 宽高都给的 cover：`200×250`、`400×533`、`128`、`400/50`、`40`、`400/90`、`144`、`88`；
- `format=origin` 的变体；
- contain：`340×1000`、`512×1000`、`680×2000`、`1024×2000`、`128`、`144`；
- `format=webp` 和 `format=origin` 的 640。

真实样本每张图取 6 组参数，合成样本 21 组全跑。

Accept 头有三种：
- Chrome：`image/avif,image/webp,...`
- Safari：`image/webp,image/avif,image/jxl,image/heic,...`
- 服务端 / Remotion：`*/*`

## 2. 结果

### 2.1 真实数据（3,654 组请求）

| 检查项 | 结果 |
|---|---|
| 状态码 | **全部一致**：200 有 3,612 组，400 有 28 组（音频、视频路径），500 有 14 组（一张 7.7 KB 的损坏 JPEG，Supabase 也报 500） |
| content-type、etag、cache-control、CORS | **全部一致**。三种 Accept 下输出格式完全相同：Chrome/Safari 拿到 WebP，`*/*` 拿到原格式 |
| Vary | 一致。仅 4 组 Supabase 自己返回的 Vary 和它自己的规则不符，见 §5 |
| 尺寸 | **全部一致**。有 232 组差 1px，是 contain 模式取整方式不同 |
| 透明通道 | 透明度数值一致。少数不透明的 PNG，Supabase 输出时多带一个全不透明的 alpha 通道，Worker 不带，显示上没有区别 |
| 像素：输出 >150px（2,734 组） | d64 中位数 0.32，只有 25 组（0.9%）超过 4 |
| 像素：输出 ≤150px（584 组） | d64 中位数 3.0，有 211 组超过 4，集中在 40、88、128、144 这几档小缩略图 |
| 转交 Supabase 的部分 | WebP 140 组、超过 20 MB 的 84 组、GIF 42 组、HEIC/SVG/octet-stream/mp4 各 14 组，以及那张损坏的 JPEG。结果和 Supabase 完全相同，因为就是它返回的 |
| 输出字节 | Worker 是 Supabase 的 1.016 倍，基本持平 |

**像素差最大的 10 组已逐张并排目视检查**（最大 d64 是 21.7，一张 40×40 的缩略图）。构图、裁切、颜色都一致，差别只是缩放后的锐度和颗粒感。缩略图在页面上本来就是 40–144px 显示，肉眼分辨不出。

### 2.2 合成边界样本（1,144 组请求）

| 检查项 | 结果 |
|---|---|
| 状态码、响应头、尺寸、格式 | 全部一致（Vary 按 §5 的规则） |
| 像素 | d64 中位数 0.63。超过 4 的 98 组都是刻意构造的极端图：1–3px 宽的细线栅格、4000×100 和 100×4000、CMYK |

## 3. 验证中发现并修复的问题

| # | 问题 | 怎么发现的 | 修复 |
|---|---|---|---|
| 1 | **ffmpeg 抽帧的 PNG 整体偏亮**（d64 约 9.5） | 一张 1080×1920 的工作区截帧在不缩放的情况下仍有差异。原因是 PNG 带 gAMA 0.51 和 cHRM 块：Supabase 忽略它们，输出和原图逐像素相同；Cloudflare 会按它们做 gamma 校正 | 变换前去掉这两个块，只删元数据，不动像素。修复后差异为 0 |
| 2 | **WebP/AVIF 原图在 `*/*` 下格式不同** | Supabase 会把它们转成 JPEG（不透明）或 PNG（透明），Worker 原样输出 WebP | 只在这里变换 JPEG 和 PNG，WebP/AVIF/动图转交 Supabase。第一次判断后在边缘缓存里记下，之后不再读 R2 |
| 3 | **扩展名或类型标错的文件** | Supabase 按真实字节判断格式，Worker 按标注的 content-type | 改成按文件头字节判断 |
| 4 | **超大图只给宽度时高度不同** | 9000×9000 的图 `width=600`：Supabase 输出 600×8192，Worker 输出 600×9000 | 由原图推出的那一边封顶到 8192 |
| 5 | **带 Range 头请求缩略图** | Supabase 返回 206 部分内容，Worker 返回 200 整张 | 带 Range 的请求转交 Supabase |
| 6 | **并发请求同一张新图时，部分退回 Supabase** | 没抢到补缓存锁的请求退回了 Supabase 变换，这张图当月会被 Supabase 计费一次 | 没抢到锁的请求通过 Supabase CDN 读一次原图，自己变换。24 个并发冷请求全部由 Worker 完成、尺寸全对 |

同时做的性能修正：
- **命中缓存不再先查 R2**：缓存键不再依赖 etag，60 秒内直接返回，之后用一次 R2 head 确认原图没变。
- **新图首次请求更快**：直接用源站读到的字节变换，写 R2 放到后台，不等写完。

## 4. 边界情况逐项结果

| 情况 | 结果 |
|---|---|
| EXIF 方向 3/5/6/8 | 两边都按 EXIF 转正，尺寸、方向、内容一致 |
| CMYK JPEG | 尺寸一致；**颜色有轻微差别**（Supabase 偏暗，Worker 偏亮）。手机照片和 AI 生成图都不是 CMYK，实际很少见，可以接受 |
| 带 sRGB ICC 的 JPEG | 一致 |
| 灰度、灰度带透明、16 位 PNG | 一致 |
| 半透明 RGBA、调色板透明 PNG | 透明区域一致；调色板图的边缘透明度略有差别（d64 约 4.5，叠在白底上看不出来） |
| 渐进式 JPEG | 一致 |
| 1×1、12×9（比目标框小） | 都不放大，一致 |
| 4000×100、100×4000 | 尺寸一致（个别差 1px） |
| 9000×9000（81 MP） | 见 §3 第 4 条，已修 |
| 5000×3000 WebP、无损带透明 WebP、AVIF、动图 WebP、GIF | 转交 Supabase，一致 |
| 扩展名大写 `.JPG` | 一致 |
| 文件名带空格、括号、`+` | `%20` 编码时一致；用 `+` 表示空格时两边都返回 400 |
| 中文、`#` 文件名 | Supabase 不允许这样的键，不存在这种情况 |
| 不存在的文件、其他 bucket、authenticated/sign 路径 | 两边返回相同的 400 |
| 非法参数：重复参数、`resize=COVER`、`quality=10`、`width=0`、`width=3000`、不带参数、`t=`、`download` | 全部转交 Supabase，结果相同 |
| 末尾多一个 `&`、只给高度、只给高度加 contain | 一致 |
| HEAD、OPTIONS 预检、POST | 转交 Supabase，一致 |
| If-None-Match | 两边都返回 304 |
| 不带 Accept 头 | 都输出原格式，一致 |
| 原图被覆盖（upsert） | 两边都继续返回旧图约 20 秒，到第 70 秒都切到新图。Supabase 自己的 CDN 也有这段延迟，两边一致 |
| 24 个并发冷请求（同一张新图、不同尺寸） | 全部 200，全部由 Worker 处理，尺寸全对 |
| Images 免费额度用完（9422）、绑定报错、开关关闭、没有绑定 | 单测覆盖：转交 Supabase，9422 后该实例暂停尝试 10 分钟 |
| 单测 | `test/render.test.mjs` 加原有测试，共 29 项，全部通过 |

## 5. 不是我们的问题，但要知道

- **Supabase 的 Vary 头不稳定。** 它第一次生成的响应带 `Vary: Accept`，之后从自己的 CDN 返回时，有时带、有时不带，还会把 `format=origin` 和不带 format 的两种变体混用。Worker 的规则是固定的：除 `format=origin` 外都带 `Vary: Accept`。
- **Supabase 只给宽度时的行为。** 只给 `width` 不给 `height` 时，它不是等比缩小，而是从原图正中裁出一条原图高度的竖条，例如 `width=200` 得到 200×1207。应用里时间线（`800/75`）和首页卡片（`600/80`、`600/85`）用的就是这种 URL。这次照原样复刻，保证上线后画面不变。要不要改成等比缩放，可以另外决定。

## 6. 速度（从上海测，经 Cloudflare 新加坡）

| 场景 | Supabase p50 | Worker p50 |
|---|---:|---:|
| 命中缓存（同一 URL 再次请求，连接复用，TLS 之后的 TTFB） | 147 ms | 135 ms |
| 命中缓存（全量测试统计） | 589 ms | 547 ms |
| 首次生成，原图已在 R2 | 1,063 ms | 961 ms |
| 首次生成，原图从没被读过 | 1,186 ms | 1,714 ms |
| 全量测试的首次生成（混合情况） | 729 ms | 775 ms |

只有“原图从没被读过”这一种比 Supabase 慢约 0.5 秒，原因是要跨区去东京读原图。每张新图只有第一个尺寸受影响，后面的尺寸都快。以后做“上传时写透 R2”，这一项也能消掉。

## 7. 费用

- **Supabase：** 由 Worker 处理的 JPEG/PNG 不再计入 Supabase 的源图数。WebP、GIF、超过 20 MB 等仍由 Supabase 处理，按本次抽样约占请求的 6–8%。
- **Cloudflare：** 按“当月不同的（原图 + 尺寸参数）”计费，`format` 和 `quality` 不计，同一组合当月只算一次。
  - 免费档每月 5,000 个。
  - 估计每月 7–15k 个，超出免费档的部分会自动转交 Supabase，不会出错。
  - 想全额省下约 $30–38/月，需要在 Cloudflare 开通 Images Paid（超出部分 $0.50/1000），这一步要站长自己开。
- **本次测试的消耗：**
  - Cloudflare 免费额度：本月约 2,500–3,000 个，12 月 1 日重置；
  - Supabase 变换计数：约 290 张源图，约 $1.5。

## 8. 测试对线上的影响

- 在生产桶里上传了 28 个测试文件，都在 `r2c-verify-20261124/` 前缀下，测完已全部删除，复查剩余为 0。
- 测试 Worker 和生产 Worker 共用 R2 桶 `makaron-cdn-media`：测试期间读过的原图会被补进 R2，7 天后过期，无害。
- 生产 Worker 和路由在验证期间**没有改动**。

## 9. 上线和回滚

- **上线：**
  - 在 `services/media-r2-cache` 下执行 `npx wrangler deploy`；
  - 会新增路由 `cdn.makaron.app/storage/v1/render/image/public/*` 和 Images 绑定。
- **上线后检查：**
  - 用 `x-makaron-cache` 看 `IMAGE` 和 `HIT-IMAGE-EDGE` 的比例；
  - Worker 日志里的 `render_fallback`（重点看 9422 什么时候出现）；
  - 次日 Supabase Usage 里 Storage Images Transformed 的增速。
- **回滚**（三选一）：
  - `npx wrangler rollback` 回到上一个版本；
  - 把 `RENDER_DISABLED` 设为 `1`；
  - 只删掉 render 这条路由。
