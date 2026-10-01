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


最新Skill commit06596df3，Preview：https://ai-image-editor-hrjlwy350-vegekyd-sys-projects.vercel.app 。本轮未合并或发生产。四格已加入原测试项目；CDN新链接首次访问超时，交付保留公开origin链接。

| 素材 | 项目 | 四格审查视频（Wan待生成） |
|---|---|---|
| 庭院 | https://ai-image-editor-hrjlwy350-vegekyd-sys-projects.vercel.app/projects/c775d289-1308-4de5-a9c3-5c2c4d3587e4 | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/c775d289-1308-4de5-a9c3-5c2c4d3587e4/uploads/1c584cf6-9534-42e5-aaa3-c7062c881d28.mp4 |
| 电商 | https://ai-image-editor-hrjlwy350-vegekyd-sys-projects.vercel.app/projects/ee251be6-49ac-4660-a9fc-9bc33d576a7a | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/ee251be6-49ac-4660-a9fc-9bc33d576a7a/uploads/f98d2f32-18a6-4108-be82-30b0534a8240.mp4 |
| 高尔夫 | https://ai-image-editor-hrjlwy350-vegekyd-sys-projects.vercel.app/projects/73c93915-06df-4052-9f62-c4032dfc6b74 | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/73c93915-06df-4052-9f62-c4032dfc6b74/uploads/00b175c6-e4f0-42ef-bba8-57730e7d3e9b.mp4 |
| 教练 | https://ai-image-editor-hrjlwy350-vegekyd-sys-projects.vercel.app/projects/65c105f9-c544-43cb-9e8f-49cdb68c6c1a | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/65c105f9-c544-43cb-9e8f-49cdb68c6c1a/uploads/3194dd1c-d42c-4a85-b107-05d3d97c1cca.mp4 |


## 充值后 Wan3 续跑（2026-10-01）

用户确认充值到账，复用原四项目通过 `makaron chat --skill multi-angle-video` 在06596df3独立Preview继续；请求：Wan3充好了，按本轮H3实际提交的同一脚本做15秒，只生成Wan3，不重做H3；原片内容和原声别改，直接生成。

四个供应商任务均完成，四条原件已实际下载并解码验证；原件视频流均15.000s，容器含AAC尾包15.022993s，1920×1080/1080×1920。四条auto continuation都实际启动并完成QA。每个初始调用仅一次；模型wan-3.0 Standard1080p、15秒、源片media_1以及原声引用。每条挂auto completionaction，原件返回后自动QA。

| 素材 | Chat run | Wan task | Prompt SHA256 | 与H3一致 |
|---|---|---|---|---|
| courtyard | 6aa1fb59-21c4-4ddd-b7ad-df39f216a715 | mr-wan30-4a0ef793-332d-4930-8315-5557f537b156 | 7361b7545960bc9ee0c130908022573491ec7e30f778834eed9b77d3f96dd48a | exact |
| product | 298addc7-4119-4138-b166-b7d8d17683be | mr-wan30-bf1729bc-f53c-4115-9215-fbd7beba2cba | 3b731fd434afaf90a1d845c9f13953f4e92537df33abf250fc22929e5a3021b2 | exact |
| golf | ca1518db-45ba-4a34-a0f5-d6802869ec4f | mr-wan30-8879ff9c-af13-452d-9f54-6f88646975c5 | a5c82a54f3cb1d1738a4d7ab347b2685b06001129e6281267dea6eedd757717d | 高尔夫末句多视角两字；分镜不变 |
| coaching | fe369973-b42d-414c-b7cf-62073be7f21c | mr-wan30-ed6ebdf3-bf90-4995-8ca8-f99082fba5ff | 82377f67106887ad61c7e2676359af0d3ef23fa71ee86b6cd9e7c05e91884970 | exact |

本次四条Wan生成预扣共1440 Makaron credits；上一轮因供应商余额不足失败的1440已退款，H3没有新增生成。

供应商配置：当前Wan适配器默认prompt_extend=true。这里记录Makaron实际提交脚本，不能声称知晓供应商内部扩写后的prompt。

### 实际结果与自动QA修正

| 素材 | Wan3实测 | 与H3对照/严格验收 |
|---|---|---|
| 庭院 | 机位/景别/空间视差更明显，完整台词ASR与源相同，波形相关0.965（非样本相同）。12.25s已抛，12.5s已接，13s开始咬；源12.5s仍腾空、13s刚接、13.5s咬。 | 偏差从H3约2秒缩小到约0.3–0.5秒，但严格动作钟仍未通过。 |
| 电商 | 台词ASR逐句顺序与时点更贴近；有景别、背景视差和产品近景。0.8s已露出粉色管底部，源产品约5s首次入画。 | 口播更忠实，但提前揭示产品改变信息节奏，未通过。不能把允许的新景别本身判为内容错误。 |
| 高尔夫 | 保留起始挥杆、姿态纠正、结束随挥；明显左侧全身/胸前球杆近景，保持室内。末段14.5/14.9均有收势；13.5动作相位与源不同。 | 起始动作比H3更完整。auto QA误把12.5s准备姿势当结束，错误声称缺收势；补查尾段Chat已更正为收势存在/动作相位偏移。不能算无需人工QA修正的通过样本。 |
| 教练 | 多机位更明显，ASR同文，波形相关0.9833；动作阶段和手/球杆状态在同钟有偏移。 | 尚不能认定纯换镜头或原声口型已同步；未通过。 |

人工只做技术收集、实际文件测量、四格呈现与QA复核，没有改创作分镜或重提视频。源/native连续运动的严格逐帧同步未被认证；四格共用原声不能掩盖这一限制。

高尔夫补查通过同项目Chat选Skill（不生成），run fbef6813-6b08-471f-bbf9-ba3259e4c3fa。初始失败因一次超过preview_frame的2–6帧schema限制，后续分批遗漏了13.5/14.8，错误QA以12.5结束。补回Skill的检查清单要求分批时保留全部时点，并检查实际最后可用帧；也补回产品首次可见时间锁，禁止扩大景别提前揭示或虚构未知衣服/身体/场景。

商品与教学候选因文件超过38.5MB分析下载限制，全片analyze_video失败；已用抽帧、ASR和PCM/probe补查，没有把全片连续动作视为全部已验证。大小分别35.6/48.9/62.8/43.2 MB；低码率完整时钟分析代理是后续可改善的路径，不需要再次生成。

### 完整四格交付

四格原片/上一轮H3/本轮H3/本轮Wan3，15.000s、360frames，源音轨AACpacket hash一致，解码无错误。Chrome四条duration15/endedtrue/ready4/errornone实际播放通过；已加入四个原项目。仅审查用，非“严格保真通过”成片。

| 素材 | 四格公开链接 |
|---|---|
| courtyard | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/c775d289-1308-4de5-a9c3-5c2c4d3587e4/uploads/e8e3d711-96ec-4334-bd50-879c9b39e4b6.mp4 |
| product | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/ee251be6-49ac-4660-a9fc-9bc33d576a7a/uploads/6197054a-f2df-499e-87b7-78271e1018e9.mp4 |
| golf | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/73c93915-06df-4052-9f62-c4032dfc6b74/uploads/52e75dd0-b487-4605-8bfa-cb4faeea90b5.mp4 |
| coaching | https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/65c105f9-c544-43cb-9e8f-49cdb68c6c1a/uploads/cf2fdae8-0d7f-406d-8234-a9241698e197.mp4 |

实际模型脚本汇总：`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-h3-wan3-content-v4/actual-submitted-scripts-h3-wan3.md`。


四个项目最终账单净4194 Makaron credits：H3生成2704+Wan生成1440+分析50；前次余额失败Wan1440已退。每个模型各一次成功任务，无视频重生成。

提交脚本汇总记录工具调用边界 story_prompt。供应商适配器把media_1/audio_1机械替换成Video 1/Audio 1，已按代码还原保存；非provider payload抓包，Wan内部prompt_extend文本不可见。

QA后的Skill修订fd1a2652已发独立Preview：https://ai-image-editor-qnpinujy9-vegekyd-sys-projects.vercel.app 。本次Wan生成和automatic QA实际测试的是06596df3；后补规则尚未用新的付费生成验证。未merge、未发production。

用户查看四条结果后认可Wan3效果，并指定其为本Skill默认模型。默认改为Wan3 Standard（`wan-3.0`）720p（用户随后要求无需1080p），同步模型优先级、计划示例和源片时长规则；明确指定H3、Prime或其他模型时仍遵循用户选择。本次默认调整沿用已有四条生成证据，不新增付费视频生成，严格动作钟QA记录仍保留。

用户随后取消原声恢复和生成后的后续任务。当前Skill在源片分析、分镜自审与模型提交后，以模型自身画面和声音直接交付；不创建completion_actions，不自动核验、拼接原片或替换音轨。此前为本流程新增的Chat/CLI自动接续代码及专用测试已撤回，原有手动产物操作仍使用既有实现。上文QA和原声四格均为历史实验记录，不代表当前Skill的默认交付步骤。本轮不新增付费视频生成。
