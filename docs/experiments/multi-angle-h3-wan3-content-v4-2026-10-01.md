# Multi-angle：内容保真优先，H3 与 Wan3 对照

用户认可上一轮切镜改善，但指出原片内容被改变。本轮只允许改机位方向、景别、焦点、镜头运动和切点；保留台词、可见动作、道具状态、动作钟、人物与场地。

## 改动与实验控制

- Skill commit 8f2ade5d，分支 codex/multi-angle-video，沿用独立 worktree。
- 建立 contentLedger、sourceStateEvidence、cameraOnlyDelta，严格区分说的内容与实际动作。说“关闭邮箱”不能自动变成合上电脑。
- 新机位约束到已观察空间；不另造户外场景、包装文字、动作结果。源片既定表演与实测动作钟先于镜头清单。
- 保留上一轮更强的机位/景别设计，以内容保真优先验收。
- 用户选择 Wan3 时路由 wan-3.0 Standard，默认1080p；H3 Max默认768p。两者均为当前产品的参考生成路线，非不可变像素编辑。
- 明确比较流程共用同一已审分镜、同一源片与原声参考，模型提交不人工改写。
- 四条原片各15.000s，共四条 Chat，各生成 H3/Wan 各一条，禁止 paid retry。
- 唯一普通请求：用H3 Max和Wan3各做一个15秒多机位，只换镜头，内容和原声别改，直接生成。
- Preview：https://ai-image-editor-c8oo3j7cr-vegekyd-sys-projects.vercel.app
- lint、startup/video-reference合同、webpack build、frontmatter验证通过；Vercel部署成功。

## H3 实测与 Wan3 阻塞

四条 H3 均完成，文件解码无错误。实际容器均15.104s，视频流15.083333s；庭院1344×768，另外三条768×1344。Chrome实际播放器已确认四条15.104s。不能采用Agent分析给出的15.23s。

| 素材 | H3 实际表现 | 验收 |
|---|---|---|
| 庭院 | 有打字、杯碟、苹果近景。源片约12.3s抛出/13.0s接住；候选约10.5s已腾空/11s接住，动作提前。native ASR也报告短语重复。 | 内容保真未通过 |
| 电商 | 多数仍近原轴线或裁切，另增加中段全身景；包装细节与表演变化，举管提前的精确时点仍需稠密帧验证。 | 未通过，弱机位与内容偏差 |
| 高尔夫 | 保持室内，无上一轮另造户外；约7–9s有上身与手/球杆特写。原片2.5s收势，候选同钟已回到设置姿态；源片6.5s杆头尚下垂，候选6.5s杆身已直立。 | 内容动作钟未通过 |
| 教练 | 多机位与肩后镜头明显，但原片2.5s仍学生准备动作，候选变成教练裤腿/杆头/球特写；球杆/手持状态与后段教学姿态改变。 | 内容保真未通过 |

以上来自实际源片/候选同钟画帧。自动QA把“结尾景别不同”当失败、漏认高尔夫特写、估错时长，均不能直接作为事实。允许的景别/机位变化不是内容失败；看不清动作只能记未确认。已把区分规则和原件probe要求补回Skill。

四条Wan3 Standard1080p都在创建任务前被MuleRouter 402拦截：每条要求180个供应商credits，上游钱包available160.596或70.596。不是Makaron用户余额（现场约5.5万）。没有Wan任务或成片，不能评价Wan质量。用户选择自行充值后通知，到账前不再调用供应商。

计费已查：四条H3各676，共2704 Makaron credits；四条Wan预扣各360均已退款，共退1440；加当前分析，四项目净2736。没有H3付费重试。

## 路径与版本边界

- 创作测试版本8f2ade5d；初始source-only Chat提示不包含人工分镜。三个组H3与Wan完整prompt字节相同；高尔夫仅最后一句少“视角”两字，镜头计划相同，但不是严格字节相同，恢复Wan应复用实际H3完整prompt。
- 初始Skill误写generate_animation.media_refs:[N]，工具schema拒绝，Chat自行修正再提交。已改为用story_prompt中的timeline marker选择视频，省略media_refs；run_code数字media_refs合同不受影响。
- 初始对照续跑挂在最后Wan提交，Wan失败后使三条H3没有自动QA。高尔夫自行挂H3 auto action完成QA；另三条用同项目Chat继续核验，没有人工改分镜/视频模型prompt，也未重生成。此处尚非完整自动端到端通过证据。
- 93a842ed修正参数合同并每个模型独立QA；935c72d8修正允许机位变化的QA分类；后续补native probe测量合同。后续变更不倒推为初始H3已通过的证据。
- 后续Preview独立部署，不改变生产、共享alias或共享变量。

## 给用户审查

四格结构：原片、上一轮H3、本轮H3、Wan3待充值占位。严格15s/360frames，共用源片完整音轨（AACpacket hash一致），只用于审查，不宣称候选口型/动作同步通过。Wan出片后替换第四格；不以别的片子填充Wan。

原始请求、每次generation输入、实际成功H3输入、完整模型脚本、native视频/probe、Agent QA、账单与四格交付收据保留在证据目录。

证据目录：`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-h3-wan3-content-v4/`。
