# 选中 Editable 的 CUI 编辑

普通 Remotion Editable 和 Layerize 使用相同合同。前端只发送 `selectedElement: {snapshotId, fieldId}`；服务端按当前用户、项目和 Snapshot 解析字段及原素材，客户端不能指定替代 source 或 propKey。切换快照清空选中状态，显式 `@N` 引用优先于选中对象。请求发出前等待 GUI 属性保存。

- `inspect_element` 返回该字段的真实素材、原始像素尺寸及当前位移/缩放。文字模型通过实际图片分析取得视觉描述。
- `edit_element` 的 transform 使用画布像素增量和缩放倍率，不调用图片模型；text 修改原生文本属性。
- content 必须先检查同一素材。原素材始终作为图片模型的真实输入；局部 region 使用原素材像素坐标，裁剪图作为编辑基础、完整原图作为参考。输出归一到原素材画布，局部区域外逐像素保留，区域内部边缘羽化。
- 同一次请求的多个操作累计在 receipt；发布时以最新原 Snapshot 为底合并，只更改允许的目标属性。内容替换不能改写 `_pos_*`、`_scale_*` 或层序。目标图片已被替换则保留生成候选并返回冲突。
- 每次编辑加入已有 `_editHistory`。生成期间保存的位置、缩放和文字也被保留。收到发布事件时，若浏览器还有更新的 GUI revision，再应用受限操作并保存。
- 读取 canonical JSON 绕过进程、本地镜像、Next fetch 和可变对象边缘缓存。每次使用短时签名 URL 加唯一查询标识，不记录或返回签名 URL。
- `edit_element` 纳入现有 durable 幂等和输入版本门禁，付费编辑不因 worker 重试重复提交。发布继续使用真实 poster 与 `publish_draft`。

这次没有改变渲染属性 ABI；继续使用隔离的 r8 runtime，Preview/Export 都读取同一份素材和属性。没有新增 CLI 参数或改变 npm 打包文件：GUI 选中身份通过聊天请求传递，普通 CLI chat 合同保持不变，CLI 仍走原先验收检查。生产及共享 Snapshot 不随此 Preview 晋升。

覆盖：`elementEdit`、`elementImage`、`selectedElementTool`、`workspaceFreshEditable`、`agentCallbacks`、`agentStreamAutoResume`；完整发布门禁与实际浏览器/模型验收分别记录。
