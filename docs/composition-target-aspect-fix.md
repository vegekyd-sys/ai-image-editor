# 明确目标画幅优先

## 问题与行为

原 `validateCompositionMediaAspect` 在选中素材画幅一致时，强制输出与素材一致。1280×720 展会视频即使被明确要求包装成 1080×1920 TikTok，仍会被拒绝，诱发 Agent 改走 FFmpeg。

`run_code.target_aspect_ratio` 现在承载 Agent 从用户请求中确认的输出比例。声明目标时校验成片与目标一致（容许 1% 的像素取整误差）；不再用源比例拦截。未声明时保留原来的源画幅默认规则与混合画幅行为。该参数适用于每次 Composition 执行/修改，不用于改变 Node 导出行为。

素材比例仍由 Composition 保持：使用 contain 和同源模糊/品牌背景，只有获准时裁切。工具说明禁止为绕过报错而虚构目标。缺少参数时的拒绝信息明确给出保持目标并补参数的恢复方式，不再只要求改成横屏。

## 验证

- `compositionTargetAspect.test.ts`：12 项通过；执行真实工具工厂和校验函数，仅隔离外部副作用。覆盖源画幅拒绝→补 9:16 后保存、反向转换、1:1、4:5、错误输出目标、默认竖屏保护、混合素材和非法比例。
- Composition 持久化、workspace runner、工具注册及 editable 合同相关测试通过。
- 自然语言 Agent 检查：同一横转竖请求，当前/legacy Core 配合新工具 schema 均读取指南并提交 `target_aspect_ratio: "9:16"`。这是两次单样本首动作验证，不是生产可靠率。
- TypeScript、Agent startup 和 core prompt 合同检查通过；ESLint 无错误（agent-tools 保留既有 unused locale warning）。
- 历史 core prompt baseline 保持冻结；两份指南的有意修正记录在 `benchmarks/core-prompt/contract-amendments.json`，继续严格检查其他创作合同和 legacy rollback。

原始草稿本地 Remotion 成功输出 1080×1920、H.264/AAC、30.059 秒 MP4，完整解码无错误，并检查了 3 个 Preview 帧和编码后抽帧。

本地真实素材渲染证据保存在忽略的 `artifacts/composition-aspect/`。使用项目原始 Remotion 草稿，源视频仅取授权片段并将绝对 trim 转成本地片段偏移。该检查仅验证 1080×1920 合成执行，不宣称修好了原稿的裁切、字幕设计、旧展信息及创作品质；没有覆盖或重新发布用户项目。Hosted Preview/Export 与生产部署尚未执行。
