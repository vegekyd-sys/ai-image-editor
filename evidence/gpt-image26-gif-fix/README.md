# Native GIF 原帧画布修复与旧 skill 评估

用户项目 `167c6efb-2e07-4f82-8571-f0abedbe788b` 的七个原生 GIF 请求均返回422。这里只读查询原 accepted request ID，未重新提交用户照片、未改该项目或中止其任务。

供应商错误是 image_size 的动画帧拼版限制，不是 GIF 整体不可用：8帧1008×1008导致4032×2016或2016×4032，6帧及2帧1024×1024导致4096×2048或2048×4096，超过3840长边。原逻辑仅计算所有帧总像素，漏掉拼版长边限制；减少帧数反而使默认帧回到1024。

候选修复 `860ba4d8`：

- GIF每帧边长保守限制960，保留既有总像素和最小帧面积约束；2/6/8/9帧、显式1K均在提交前规划。9帧默认不变。明确2K/4K每帧请求提前拒绝，不偷偷放宽。
- 422错误保留受限字段的参数原因，过滤源URL和prompt回显，原request ID继续保留，不重发POST。
- System prompt只明确意图路由：新创作GIF走原生图片生成，已有帧拼接/精确时序才用animated-gif。供应商尺寸仍在能力层和adapter，工具合同自包含。
- CLI帮助与README同步。131项定向测试、TypeScript、CLI测试、Skill sync检查通过；3项受控真实路由预检通过，媒体操作0。

旧 `animated-gif` 存在共享 workspace 版本，不是当前src/skills的内置文件。主体功能是已有帧的顺序/时长与GIF编码；它仍能支持原生生成不能严格满足的既有图保真、指定顺序、不同帧时长，以及无需重生成的打包。因此建议 **保留为existing-frame assembler，退出泛化“做GIF”的入口，不整体删除**。候选system路由已收窄；[共享skill文案修订草案](animated-gif-proposed.md)供审查，未覆盖共享DB文件或用户自己的skill。

第一条mascot原生GIF在旧Preview成功：960×960、9帧、160ms、无限循环，9帧内容不同。它证明“GIF通道一律坏了”的Agent结论不成立。剩余两条用修复版Preview走makaron CLI chat，分别选择8帧、6帧，验证真实失败组合的修复；结果见后续live.json。

仅Preview部署，未合入、未生产发布、未发NPM，未占共享alias。旧不可变Preview地址不会自动更新。

## 已完成的真实验收

修复版Preview：[https://ai-image-editor-cusg0fka8-vegekyd-sys-projects.vercel.app](https://ai-image-editor-cusg0fka8-vegekyd-sys-projects.vercel.app)。6帧和8帧均通过CLI chat原生生成、960×960、多不同帧及无限循环。8帧还使用显式1K、参考图编辑、默认图片路由，未手动指定模型，实际为2.6 Flare。

6帧首版视觉失败（邻帧漏入），Agent做过一次原生修正，最终六帧已逐帧查看，无裁切/串帧。末尾预览卡颜色有重置，不标成完美无缝。见live-six.json和live-eight.json。额外8帧回归不算用户六件成品之一。第二条9帧是在暂停本地调度器前已获得run的请求，已恢复原ID，无重复提交。

交付选择为3个GIF（灵感来了、正在施法、搞定啦）与3张meme。素材及ZIP在 outputs/makaron-mascot-20261105/；该目录不进入业务仓库/应用部署。本轮不发布生产，不覆盖共享skill。
