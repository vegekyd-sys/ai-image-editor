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
