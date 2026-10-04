# Multi-angle Skill：叙事与机位第三轮

## 目的

上一轮直接输出仍偏向人脸近景和源轴裁切，转折的视觉证据不足。本轮改写 Skill 的导演阶段，保持同样的四条原片、同一句普通请求与 H3 Max 15s 路线。人工只更新可复用 Skill 和制作对比报告，不改写这轮 Chat 的分析、分镜或模型提交脚本。

重新学习 [fal 教程](https://fal.ai/learn/tools/how-to-create-multi-angle-video-seedance-2-5)：将一个已完成的表演按实测动作与讲话时间分配给明确的虚拟机位；前景、焦点、机位高度和景别变化构成观看过程。其 Seedance editing 模式和当前 H3 feature reference 并非相同的保真合同，成片仍需单独验收。

## Skill 改动

- 先写视觉叙事句，再设计中心转折、铺垫与结果。
- cameraMap 描述物理机位位置、高度、看向、地标和前景，区分真正换机位与源轴裁切。
- 每镜明确画面边界、主次、遮挡、深度、焦点、运动起止和当前动作状态。
- 从同一句话内的真实动作微阶段获得切点；15s 活跃表演先探索7–10镜，再按实际含义删减/保留，避免固定配方。
- 允许有目的的低机位升起、物体旁滑移、转折重构图与少量弧线运动；对齐原表演而不靠演员新动作完成机位。

## 测试身份

- 分支：codex/multi-angle-video，Skill commit 969a7e83。
- Preview：https://ai-image-editor-brupoxzcc-vegekyd-sys-projects.vercel.app
- 请求：把这个视频做成更专业、有故事感的15秒多机位视频，保留原声，直接生成。
- 四条：courtyard、product、golf、coaching，同前轮15s源文件。
- 每条最多一次成功的 H3 付费生成；自动续跑原生 QA 与交付，不人工接管创作。
- 本地 lint、startup/video reference合同、webpack build、frontmatter验证通过；Vercel构建和健康检查通过。
- 实际成片与验收结果待收集，不以健康检查认定通过。

## 结果

四条均完成一次 H3 Max 生成，模型提交脚本完全来自 Chat + Skill，没有人工修改。计划镜头数量分别8/7/9/8。自动后续三条正常，coaching 被 Agent 错设为 confirm；为完成检查，人工执行其原样保存的 QA 指令，未介入创作或追加生成。因此本轮不能声称四条自动流程全通过。

| 样本 | 观察到的改善 | 未通过的关键问题 |
|---|---|---|
| courtyard | 桌面俯视、杯子插入、近远景切换明显增加 | 规划就把约12.2s的抛苹果提前到10.65s区间；成片10.6–10.9s有抛接，非自动QA所称“完全省略”，咬苹果也提前；电脑合盖后重开 |
| product | 侧脸和产品视觉占比更明确 | 实际多数仍为源轴裁切/重构；包装细字改变、原生语音检查不可靠，未通过原声同步 |
| golf | 低机位球/杆细节、躯干纠正、侧向收杆对比更明显 | 约8.5s和结尾出现户外/玻璃网栏场景变化；错误脊柱关系镜头被腿/球细节替代，未真正解释错误 |
| coaching | 肩后学员反应、球位低机位、胸前球杆近景，比前轮有信息层次 | 8s附近的细节拍成持杆准备，原片在解释身体远离球；核心胸球关系和姿态时钟仍弱。QA需人工启动 |

结论：景别与信息细节有进步，四条均不满足整体验收。计划更多镜头不是通过标准；真正换投影、中心关系可读与源时钟一致仍有失败。

四格统一为左上原片、右上人工H3、左下上一轮Preview Skill、右下本轮Skill；共用原片音轨，仅为比较。四个文件均15s、360帧、完整解码，AAC包摘要与各自原声相同。Chrome四个实际CDN播放器都完整播至15s，readyState4，无媒体错误。原生文件单独保留，不以四格原声宣称同步通过。

本轮支出2727 credits：四次 create_video 各676，共2704；其他分析23。追加无生成草案检查另花3 credits；整个本轮共2730，仍只有四次视频生成，没有 paid retry。

## 本轮反馈后的补丁

追加 b3e24225：快速动作必须在付费前查看已解码带实测PTS的密集源帧，锚点落到对应分镜区间，并将同一动作钟表带入提交提示；明确 Shot时长与[start–end]共存；“保留原声，直接生成”使用auto后续策略。

补丁 Preview：https://ai-image-editor-gn9f2h3lp-vegekyd-sys-projects.vercel.app 。该部署构建通过；以上四条付费结果来自969a7e83，不是补丁版本的出片复测。补丁另做禁止生成的庭院脚本检查：同样source-only上传、选Skill，普通请求“把这个视频做成15秒多机位，保留原声，先给我脚本，不要生成”。输出了8镜草案，仍将抛接放在10–11.5s，未运行密集源帧测量。因此这份草案不能作已测时钟的提交脚本，补丁效果未获确认；该流程尚未走到付费前验证，不能据此声称最终门禁通过。补丁未再付费出片。


- courtyard：[项目](https://ai-image-editor-brupoxzcc-vegekyd-sys-projects.vercel.app/projects/a580e692-2f9a-4b47-a718-dbd3831c3653) / [四格](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/a580e692-2f9a-4b47-a718-dbd3831c3653/uploads/0279221e-cd41-404a-98ed-70595782f714.mp4)

- product：[项目](https://ai-image-editor-brupoxzcc-vegekyd-sys-projects.vercel.app/projects/12f74bfe-6126-4626-9128-8f09c3434c58) / [四格](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/12f74bfe-6126-4626-9128-8f09c3434c58/uploads/88043705-201c-4800-a57a-af601722a747.mp4)

- golf：[项目](https://ai-image-editor-brupoxzcc-vegekyd-sys-projects.vercel.app/projects/fb42bf5b-7e1b-43cf-a836-25e4492c858d) / [四格](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/fb42bf5b-7e1b-43cf-a836-25e4492c858d/uploads/bade8ba9-1ac1-46e2-9aa1-e16e1d012915.mp4)

- coaching：[项目](https://ai-image-editor-brupoxzcc-vegekyd-sys-projects.vercel.app/projects/0b5afe36-5c5c-444a-bf16-7bc85b2e8bbc) / [四格](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/0b5afe36-5c5c-444a-bf16-7bc85b2e8bbc/uploads/4763c71c-71da-4ed3-b4fd-6c1b5587ad4b.mp4)

证据：`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-h3-narrative-v3/`；`submitted-scripts.md` 为原样生成脚本，video_snapshot.videoMeta.prompt与tool输入逐条相等。QA自动分析与人工解码证据有冲突时，采用实际解码证据，详见courtyard密集帧。
