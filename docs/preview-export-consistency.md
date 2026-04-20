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

原版 web-renderer 的 canvas drawing 只读 `style.transform`/`style.scale`/`style.rotate`，**漏了 `style.translate`**。我们通过 `patches/@remotion+web-renderer+4.0.446.patch` 补上了 translate 支持。

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
| `patches/@remotion+web-renderer+4.0.446.patch` | web-renderer translate 支持 |
| `src/app/moveable-test/page.tsx` | 验证 demo |
