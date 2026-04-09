# Handoff: Remotion 渲染引擎 + Design 系统

## 当前分支
`dev`

## 2026-04-10 更新

### 架构

- **显示**：Canvas 和 CUI 都用 Remotion Player（still + animation 统一，`designsMap`）
- **截图**：`renderStillOnWeb` + `resolveCodeUrls`（CORS workaround）→ poster 用于 snapshot.image、tips、CUI 缩略图
- **编译**：Sucrase 优先（bundle 内），Babel CDN fallback
- **Harness**：`design-harness.ts` — 编译检查 + 图片引用检查 + URL 有效性检查

### 已知问题

- iOS Safari 本地 HTTP 环境 CUI 截图可能无图（CORS），线上 HTTPS 待验证
- Agent 偶发生成非法 tool name（Bedrock 报错）
- renderStillOnWeb 不支持 Safari CSS filter

### Preview
`https://ai-image-editor-8p6f73nf5-vegekyd-sys-projects.vercel.app`
