# Preview = Export 一致性原则

## 核心原则

**用户在预览中看到的，必须和导出的完全一致。** 这是不可妥协的产品要求。

## 架构

```
┌─────────────────────────────────────────────┐
│  Preview (Remotion Player)                   │
│                                              │
│  Agent 组件 → React 渲染 → DOM              │
│         ↓                                    │
│  Proxy 注入 style.translate/scale           │
│  DesignOverlay.applyStoredOffsets 同上       │
│         ↓                                    │
│  用户看到最终效果                              │
└─────────────────────────────────────────────┘
                    ‖  (必须一致)
┌─────────────────────────────────────────────┐
│  Export (renderStillOnWeb / renderMediaOnWeb) │
│                                              │
│  同一个 Agent 组件 → React 渲染 → 隐藏 DOM   │
│         ↓                                    │
│  Proxy 注入 style.translate/scale (同上)     │
│         ↓                                    │
│  web-renderer canvas drawing 读 DOM → 视频   │
└─────────────────────────────────────────────┘
```

## 关键机制

### 1. Proxy（evalRemotionJSX.ts）

`PATCHED_REACT` 拦截 `React.createElement`，给 `[data-editable]` 元素的 style 注入 CSS 独立属性：

```typescript
style: {
  ...existingStyle,
  translate: `${pos.x}px ${pos.y}px`,  // 用户 drag 的位移
  scale: `${sc.w} ${sc.h}`,            // 用户 pinch/resize 的缩放
}
```

**为什么用 CSS 独立属性（translate/scale）而不是 style.transform：**
- `getComputedStyle().transform` 对独立属性返回 `"none"` → Moveable 不受干扰
- 浏览器 hit-testing 不受影响 → 无 ghost pointerdown
- `style.transform` 会被合并到 computed matrix → 干扰 Moveable + 触发 ghost pointerdown

### 2. @remotion/web-renderer patch

原版 web-renderer 的 canvas drawing 只读 `style.transform`/`style.scale`/`style.rotate`，**漏了 `style.translate`**。我们通过 `patches/@remotion+web-renderer+4.0.527.patch` 补上了 translate 支持，包括新版的 transform style cache 与 reset/restore 路径。

**升级 @remotion/web-renderer 时必须：**
1. 检查新版是否已支持 `style.translate`
2. 如果没有，重新生成 patch：`npx patch-package @remotion/web-renderer --patch-dir patches`
3. 验证 `/moveable-test` demo 页面导出是否正确

### 3. DesignOverlay.applyStoredOffsets

预览时 DesignOverlay 在 measure 阶段也设 `style.translate`/`style.scale`（跟 Proxy 设同样的值）。这是为了让 Moveable 测量到正确的元素位置。

## 不允许的做法

| 做法 | 为什么不行 |
|------|-----------|
| 在 editable 元素上设 `style.transform` | Moveable 读 computed transform → 框错位 + ghost pointerdown |
| 用 `useLayoutEffect` 做 DOM 后处理 | `renderMediaOnWeb` 不为每帧触发 effects（450 帧只跑 6 次） |
| 用 `React.Children.map` + `cloneElement` | 无法穿透 Sequence/AbsoluteFill 等 Remotion 组件边界 |
| 预览和导出走不同的代码路径 | 违反一致性原则，一定会出 bug |
| 在 DesignOverlay 里改 DOM 但不在 Proxy 里改 | 导出时没有 DesignOverlay → 位置丢失 |

## 添加新的可视化编辑功能时

如果要给 editable 元素添加新的用户编辑属性（如旋转、透明度等），必须：

1. **Props 层**：定义新 prop 格式（如 `_rotate_{id}: number`）
2. **Proxy 层**：在 `_patchedCE` 里注入对应的 CSS 独立属性（如 `rotate: '45deg'`）
3. **DesignOverlay 层**：`applyStoredOffsets` 同步设同样的值
4. **web-renderer 兼容**：确认 web-renderer 能读这个 CSS 属性（可能需要新 patch）
5. **测试**：用 `/moveable-test` demo 验证预览和导出一致

## 测试方法

### 手动测试
1. 打开有 editable 的 design
2. Drag 移动 + pinch 缩放
3. 导出（Save）
4. 对比预览截图和导出结果

### Demo 页面
`/moveable-test` — 可拖拽方块 + Export 按钮，验证 `renderStillOnWeb` 导出包含 translate/scale。

### 自动化测试
`__tests__/editableTransforms.test.ts` — 8 个测试验证 `applyEditableTransforms` 使用独立属性。

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/evalRemotionJSX.ts` | Proxy 注入 translate/scale + HOC wrapper |
| `src/components/DesignOverlay.tsx` | 预览时 applyStoredOffsets + 交互（drag/scale/pinch）|
| `src/components/RemotionRenderer.tsx` | captureDesignPoster / exportDesignVideo 调用 |
| `patches/@remotion+web-renderer+4.0.527.patch` | web-renderer translate 支持 |
| `src/app/moveable-test/page.tsx` | 验证 demo |

## Lambda 横向重影回归

项目 `6eb73527-e997-4622-8bbf-df3df5479a16` 的 @15 在 19 秒 Preview 正常，但 @16/@17 MP4 的首页、标题、输入框按横向条带重复。旧 Lambda 的单帧 PNG 也能复现；同一源码与已部署 site 在本机 renderer 正常，排除了 MP4 编码与源码版本漂移。

上游 [Remotion #11428](https://github.com/remotion-dev/remotion/issues/11428) 记录了同类软件栅格化缺陷；[修复 #11446](https://github.com/remotion-dev/remotion/pull/11446) 仅在 Lambda 内加入 `--disable-gpu-rasterization`。本候选统一锁定所有 Remotion 包到首个包含该修复的 **4.0.527**，不改用户作品或强制给每个元素增加 compositor layer。

升级验收必须使用真实 Lambda，不能用本机通过代替：比较 19 秒、24 秒转场和其他代表帧；下载完整 MP4，核对时长、音轨与画面，并保留旧输出供对照。

`public/remotion-runtime.json` 的 `remotionVersion` 必须与应用依赖一致；导出 fingerprint 也包含版本，避免复用升级前的错误成片。发布时将 `REMOTION_LAMBDA_SERVE_URL`、`REMOTION_LAMBDA_FUNCTION_NAME` 与可选 `REMOTION_LAMBDA_RENDERER_FUNCTION_NAME` 一起切到兼容的 site/function，并保留旧值供回滚。可用 `npm run ops:remotion-lambda-provision -- --site-name <isolated-name> --with-function` 准备候选；该命令只创建版本化资源，不会自动更新生产配置。

### 2026-10-09 候选验收

`codex/remotion-export-parity` 使用原 @15 代码、props、素材和 60 秒时间线，未修改项目记录。隔离的 4.0.527 site/function 完成真实 Lambda MP4（render ID `s07mq59y03`，58,928,585 bytes），无渲染错误；视频为 1920×1080、30fps、1800 帧，保留 AAC 音轨。已查看成片的 1、12、19、24、24.3、28、36、48、58 秒：旧 @17 的横向重复条带在 19/24 秒消失，其余抽查帧正常。

本机 4.0.527 另渲染 frame 570/720 作为对照，构图正常；本机与 Lambda 仍有平台字体栅格化差异，本次验收针对重复条带，不声称逐像素相同。浏览器 `/moveable-test` 实际拖拽 `(111,55)` 并缩放 `1.20×` 后 PNG 导出，位移和尺寸与 Player 保持一致，迁移后的 translate 补丁生效。

相关测试 25 files / 133 tests 通过；服务器版本入口调整后追加的 4 files / 28 tests 通过（与前者有重叠），TypeScript、改动文件 ESLint、Next.js production build 和服务器依赖 trace 检查通过。此记录仅代表隔离候选验收，尚未合并或切换生产配置；原项目 @17 仍是旧输出，发布后需重新导出。

### 2026-10-09 正式站与共享 Preview 发布验收

修复已合入并推送 dev（`7f0eaae5`）。本次正式站按上一已验证生产版本加本修复发布，源码为 `7760ccbc`，部署 `ai-image-editor-2iz67he9v-vegekyd-sys-projects.vercel.app`；dev 中其他视频局部编辑改动未随本次正式站发布。共享 `ai-image-editor-git-dev-vegekyd-sys-projects.vercel.app` 已绑定重新部署的 dev（`ai-image-editor-672wmpr3y-vegekyd-sys-projects.vercel.app`）。Production、共享 Preview 与本机三个 Remotion 运行时变量均同步到 4.0.527 的 function/site；旧值和旧资源保留供回滚。

正式站用 registry 新取回的 CLI 0.16.0 对原 @15 执行真实 `materialize --profile source --publish`，完成 job `cf2466f8-551d-4adc-8300-44e2cece00db`，发布为原项目 **@18**。共享 Preview 另有独立 job `80c1ca78-3dcf-4167-aaf7-d0e08be7d970`，不发布到时间线。两者任务记录均确认调用 `remotion-render-4-0-527-mem10240mb-disk5120mb-900sec`，完整 MP4 为 1920×1080、30fps、1800 帧，保留 AAC 音轨。实际正式站播放器和两份 MP4 的 19/24 秒横条消失，24.3 秒转场正常；正式站另抽查 1/12/36/48/58 秒。旧 @16/@17 仍保留，原 @15 未修改。

合并后的 dev 全量 2332 tests 和仅修复生产版本全量 2181 tests 分别通过（两组有重叠），TypeScript、CLI 测试、lint 与生产/Preview 云端构建、服务器 trace 检查通过；两边健康检查各 12 healthy / 0 unhealthy。本次 CLI API 合同未变，npm `latest` 保持 0.16.0；registry tarball SHA-1 为 `7139cd7c44acf96c19c18a8af6f82f8c6aae8d1f`，7 个打包文件与已接受生产 CLI 逐字节一致，真实 materialize 验收通过，无需新发包。


## 视频比例与主画面占比

视频 fit 在共享 `src/lib/remotion-video-fit.ts` 适配：组件级 `objectFit` 优先，其次兼容旧的 `style.objectFit`。`@remotion/media` 读取组件参数，原生 Video 读取 CSS；两种路径必须传递相同语义。适配覆盖 Player、web-renderer、DynamicDesign 及显式 OffthreadVideo/Html5Video。无 fit 时保留解码器默认值，不自动裁剪。

素材宽高必须是显示尺寸。`mp4-probe.ts` 按视频 track 的 tkhd matrix 计算旋转后的宽高；外部 range 导入用有超时和字节上限的 Range 探测读取 moov，跳过 mdat，并将真实尺寸写入 video_meta 和工具结果。无法测量时保持 unknown，不能回填一个猜测的 9:16。

画布比例正确不代表主视频足够大。`run_code` 的 render 和 patch 都会检查目标比例；素材与画布同比例时，还会拒绝所有可静态测量视频区域均小于半画布的主画面布局。显式要求小窗/分屏时可用 `video_layout: "inset"`，该角色随 draft 持久化。动态尺寸无法证明时交给 `preview_frame`，静态检查不替代实帧验收，也不自动重写已有作品。

Range 探测使用 64 KiB 窗口合并相邻 box 读取，避免带 ftyp/uuid/free/mdat 的手机文件耗尽远程往返预算。仍跳过 mdat、限制总字节和 30 秒总时长；实测这两个项目的 11 个源均能测得正确显示尺寸，单源只需 2–3 次请求。

修改共享运行时时同步提升 `REMOTION_EDITABLE_RUNTIME_VERSION` 与 `public/remotion-runtime.json`，重新构建独立渲染站点后再上线。旧 Lambda bundle 不会自动获得应用源码中的修复，版本门禁会阻止误用旧 bundle。


### 媒体与布局一致性审计（2026-10-22）

- 支持 WebCodecs 的 Player 与导出共用媒体解码器；不支持时保留原生 Video 回退。媒体 effects、音高、非首音轨和带自定义请求参数的视频使用媒体解码器，避免原生路径静默丢参。
- Video/OffthreadVideo/Html5Video 与 Audio 的 `startFrom/endAt` 统一映射到 `trimBefore/trimAfter`，显式现代参数（包括 0）优先。GUI 裁剪与可编辑位移/缩放识别所有视频别名。
- 媒体解码路径在切镜缓冲时用始终挂载的 Freeze 保留上一镜头最后一帧；不重建解码器，也不提前推进下一镜头。原生回退尾帧缓存使用视频实际布局框，保留 objectPosition、clipPath、滤镜、透明度、边框、transform/transformOrigin；缓存替代实时画面，防止透明度与阴影叠加。画布保留 alpha；`Sequence layout="none"` 不额外产生布局盒或传入非法 style。
- 适配后的 Video 保留显式媒体身份，缓冲、裁剪时长与尾帧发现不依赖包装组件的函数名。暂停定位在目标帧内部作 100 微秒校准，避免原生时间舍入落到前一帧；持续播放不偏移。

可重复验收入口：`benchmarks/remotion-parity/render.ts`。它生成带明确 BT.709 元数据的合成测试源、真实 Player 页面，以及媒体/离线解码器的同帧 PNG；通过内置浏览器逐项检查 cover/contain、objectPosition、变换、滤镜/裁剪/透明度、legacy trim/倍速、GUI 裁剪、尾帧、无布局 Sequence 与字幕。未声明色彩空间的素材不能用来声称跨浏览器原始 RGB 恒等；实际片验收还需检查其色彩元数据及连续播放。测试页保留原生回退案例，并提供下一镜头延迟 5 秒的连续切镜用例。

本次应用与渲染站点必须使用同一候选版本，独立站点地址通过单次部署或验收进程环境传入，不能拿旧渲染站点验收新应用。普通客户端默认不改变生产配置。

本机 renderer 与 Sandbox/export 共享 `collectPreviewMediaSources` 和 URL token 替换逻辑，包含 Scene 无扩展名的签名媒体端点。本机也先缓存源文件，再交给解码器，不能把远程下载时间算进浏览器每帧的 28 秒等待期限；缓存只改渲染副本，原始源地址、剪辑范围和画布保持原样。
