# Layerize 候选接入

CUI `decompose_image` / `get_layerize_status`、CLI `makaron layerize` / `layerize status` 与 `/api/layerize` 使用同一服务。供应商为现有 EvoLink 账号，精确 ID `doubao-seedream-5.5-layerize`；计费 SKU `seedream-5.5-layerize`。独立异步任务，不在普通单图模型选择器或 Auto 中注册。

输入一张已上传的 HTTPS PNG/JPEG 原图，EXIF 旋转/镜像先归一化为实际像素并另存供应商输入副本，原图与请求 fingerprint 保留，尺寸 >14px，最多 30MB/36MP、比例 1:16–16:1。最大输出数 2–100（包含背景，默认8），quality=auto/1K/1.5K/2K，产品、Agent、CLI/API 默认 1K。供应商只有整次任务的 quality，没有逐层分辨率参数；auto 跟随整张输入的像素预算，并非按每个物件的 bbox 分配尺寸。保留显式 auto/1.5K/2K；不自动提高分辨率，也不为高分辨率背景额外提交一次任务。已有任务回执、素材和已保存设计不迁移。不接受单图模型的 size/aspect/crop_layers 参数。

背景为0，保留供应商 z_index 作为图层身份。发布前在归一化原图上比较重叠区域，推断前后顺序，再比较完整重组误差；只有整体误差确实降低才采用新顺序，否则沿用供应商顺序。manifest.stackOrder 保存接受的底到顶顺序，reconstruction 保存比较指标；它不能消除供应商本身的重绘差异或补全缺失。独立 PNG 按背景坐标系中的 absolute bbox 放回画布；不能将图层自身的像素尺寸当作位置。每层有独立 source prop、标准 image EditableField，组件入口使用 Composition，field.id 与 propKey 一致以满足现有 React Proxy 的媒体所有权合同；复用 DesignPayload、Img、Proxy、DesignOverlay、web-renderer、保存与导出。GUI 支持图片图层拖动、缩放，以及全部拆层元素（含 OCR 文字）的上移一层、下移一层、删除和恢复。现有 DesignEditPanel 从上到下显示图层；`props._layerState` 一次保存完整的底到顶顺序与删除列表，保留源文件和位置以支持重开后恢复。共享 React Proxy 调整真实子节点顺序、移除已删节点，Preview 与 web-renderer 导出共用同一合同，不用仅 GUI 生效的 z-index。旧 manifest 设计在第一次编辑时补齐该属性。拆层沿用原图固定画布，窗口尺寸变化或移动图层不触发长图内容自适应增高。同一设计的客户端保存串行执行，避免先前的慢请求后写覆盖删除状态。CUI 默认要求拆出全部可见标题、标签和物体上的字，默认保留字形 PNG，可独立移动、缩放和通过选中图层的 CUI 局部改字。用户明确要求原生文字时传入 editable_text。CLI/API 沿用显式开关。开启后，有效 OCR 行成为普通 text editable：内容未改时保留拆出的原始字形 PNG；改字后使用从真实透明字形匹配的字体、字重、旋转及缩放矩阵渲染 SVG 文本。字体资源沿现有 pinned catalog 在 Preview/Export 共用，不依赖用户系统字体。当前字形匹配覆盖拉丁文字；其他文字退回 OCR 相似字体。视觉近似不代表识别出了原字体文件，不能保证改字后与原图字形完全一致。缺失或无效 OCR 保留 PNG。原图、PNG 图层和 manifest 均保留。无新图层编辑器或渲染服务。

最多四路并发下载/持久化独立图层。发布前必须持久化所有资源并通过现有 design-harness，纯图片或保留原字形的初始设计直接用原图层合成 JPEG poster；需要重排版的设计使用现有 renderDesignFrame。拿到 poster 后再写快照。Agent 与此工具复用 publishDesignSnapshot；已发布设计后续 CUI 事件只关联消息，不覆盖 GUI 编辑后的 props 或已有 message_id。拆层设计使用图层编辑入口，不自动启动普通照片 Tips；只读访问也不启动自动 Tips，尚在加载 design 的快照先等待合同恢复。App 直接把服务端已就绪的 poster 与 design 加入当前页面并定位，不再等待一次浏览器截图或重复保存。持久化 render 事件保留 previewUrl，重连使用相同路径；focus_snapshot 先于 render 或只发送定位事件时，从项目媒体和 canonical design 恢复缺失快照，已有 GUI props 不覆盖。App 在当前页面直接定位可编辑结果，完成回复简短、不重复展示项目链接。完成任务重查只发 `focus_snapshot` 导航事件，不重发 render，不覆盖 GUI props 或 message_id；SSE 和事件重连均处理该导航事件。CLI chat 和独立 CLI 继续交付 projectUrl；JSON 保留完整恢复回执，普通完成反馈不展示 jobId 或 workspace 路径。

遮挡补全仍在实验，未开放自动模式。普通选中元素内容编辑继续保持原透明区域。2026-11-14 对真实人物切片测试了原资产＋场景参考和显式原生遮罩；前者出现重复人物，后者改善轮廓但仍改变可见细节并产生背景光晕，均未通过质量验收，不发布到用户原项目。后续需要同时验证原像素锁定、补全连贯性、透明边缘和原布局保留，不能仅凭生成成功宣称支持。

字体准备分为两步：首次发布只裁出原始透明字形，不下载或匹配字体；先用原始图层合成 poster 并展示。字体匹配是独立的可恢复后台任务，结果写入 text-fonts.json，绝不回写 canonical design、snapshot 或计费记录。App 只将匹配数据合并到当前最新 props；已输入文字、拖动缩放和撤销历史保留。匹配尚未完成时可先输入，画布暂保留原字形并提示；匹配与 pinned 字体加载完成后再更新文字预览。首屏不等待字体文件；后台匹配完成后预热所选 pinned 字体，再启用匹配后的文字预览。未改字的导出无需等字体匹配；已改字的导出会读取同一份匹配结果。GUI 历史恢复为 pending 时重用已完成结果。失败释放独立租约，后续页面/状态读取重试同一字体任务，不再调用图片模型。Fontkit 在 Next 服务端保持原生 ESM 入口，发布门禁检查其 Unicode 二进制数据，避免开发/云端打包差异。

每个任务单独计费：$0.0064 输入 + 每张实际输出（包括背景）≤2,610,000像素 $0.016，否则 $0.028。完整费用乘精确 token_rates.markup 后只取整一次，1 credit=$0.01。默认 markup=2，五张低档输出共 $0.0864 →18 credits。Agent 推理另计。候选价格迁移只在隔离 PostgreSQL 验证，不写共享库；缺少精确启用价格行会在供应商提交前拒绝。

供应商提交前按 n 个最高档输出检查最大余额；产品在输出已下载、校验并准备好 poster 后按实际产物扣费。复用已有原子任务扣费 RPC（历史名称含 mcp_video），仅写 reserved→completed，绝不进入 submitted，因此不进入视频轮询 cron。相同 UUID/fingerprint 只扣一次，失败或未知任务不扣产品图片费。供应商已发生的费用与产品 credits 分开审计。

workspace_files 的唯一(user_id,path)行在付费 POST 前声明任务；同 requestId 参数冲突拒绝，传输未知不重发。任务归属始终验证 project.user_id，不能通过任意供应商 taskId 查询或接管他人结果。GET 只恢复原任务。完成发布用可恢复租约互斥；存储或扣费中断可重查原 job。编辑后的 canonical design 不重写；已完成状态查询不再次发送设计发布事件，避免客户端回放覆盖尚未保存的 GUI 状态。动态回执和 canonical design 用唯一版本参数绕过媒体缓存；任务回执经服务端 HMAC 签名，用户修改供应商任务、markup 或归属时拒绝读取。不确定的提交需要查供应商历史后人工处理，不应新建任务重试。

验收与部署状态分别记录，不把本地验证视为生产发布。真实媒体、计时和录屏证据保存在工作区外的验收目录。图片快照共用持续挂载画布，切换先保留当前画面，下一张解码后短淡入；普通生成图片与分层 poster 复用解码缓存，分层 JPEG 不重复经过冷图片变换。GUI/CUI 仍互斥挂载。

官方合同：[EvoLink Layerize API](https://evolink.ai/docs/en/api-manual/image-series/seedream-5.5/seedream-5.5-layerize-image-generate)。
