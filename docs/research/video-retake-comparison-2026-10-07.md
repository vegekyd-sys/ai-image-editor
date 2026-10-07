# Retake：旧入口升级与实际对比

2026-10-07，本地候选分支 `codex/video-retake`。尚未合并、发布。

## 产品行为

每条视频原有的“从这儿开始编辑”入口在原 TipBot/pill 位置变为紧凑时间线：缩略图带和两个可拖动端点，上方原视频同步定位。选择 0.1–15 秒后点右侧修改按钮进入聊天，自然草稿为“把 @N 的开始–结束秒换成：”。修改要求和指定模型都在聊天输入，pill 不再放独立播放器、表单或模型下拉框。Agent 直接执行 Retake；不再把截图、分析定位、确认脚本、生成短片、确认拼接串成多轮操作。

GUI、CLI、Agent 和 MCP 共用同一条任务合同：源视频 + start/end（原视频秒数）+ 修改要求 + 模型。当前提供 Seedance 2.5、FAL H3 Max；2026-10-08 用户验收淘汰 LTX，不上线。H3 保留为默认，Seedance 保留为备选。H3要求源片至少2秒，更短源片需指定Seedance。H3 Turbo 不接受源视频，未列入此功能。

模型可以获取稍长的参考片段，最终只替换用户选区。最终成片保留原视频时长、尺寸、帧率和原声；生成、落盘、拼接及任务状态可续查。相同 request-id 重放不重新生成、扣费。取消显示不取消已经提交给供应商的任务。

```sh
makaron video retake --video ./source.mp4 --project PROJECT_ID \
  --start 10 --end 23 --model seedance-2.5 \
  --prompt "机器人滑板段切换多个机位，保持角色和动作连续" \
  --request-id UUID --wait --json
```

## 同片、同修改要求的实际试验

源片 5.184 秒，1920×1080、24fps、AAC。选区 2–4 秒：把蓝色书改成红色书，保留人物、动作、光线和镜头。每条路线仅一次成功样本，不据此推断普遍性能。

| 路线 | 记录到的完整等待 | 供应商生成阶段观测 | 产品积分 | 观看结果 |
| --- | --- | --- | --- | --- |
| 新 Retake · Seedance 2.5 | 6分51秒 | 3分02秒 | 260 | 选区内书持续红色，动作节奏最接近原片；本样本首选 |
| 新 Retake · FAL H3 Max | 2分27秒 | 52秒 | 213 | 书变红，但动作放慢，回接原片处姿态跳变 |
| 新 Retake · LTX 2.3 | 2分59秒 | 1分12秒 | 40 | 动作接近，但约3.5秒书变回蓝色，未完整满足选区修改 |
| 旧流程 · H3 Max + Agent 拼接 | 10分38秒，从定位到最终完成 | 未取得独立可靠计时 | 183净积分 | 改色成功，但选区入口和出口动作跳变较明显 |

计时限制：新 Seedance 和 LTX 的完整等待包含本次开发过程中供应商文件下载网络修复的额外等待；H3 包含后续已优化掉的重复源视频上传。旧流程完整等待包含确认间隔和一次失败的 Seedance Eco 尝试，不能当作纯计算耗时。旧流程四次 Agent 活跃时间合计 4分37秒，包含失败尝试、未完整包含供应商等待；仅成功定位/生成/拼接三个回合合计 3分37秒，同样不是完整耗时。不能使用这些数值宣称稳定加速倍数。

旧入口指定 Seedance 2.5 后被现有普通生成路由映射到 Eco，480p生成失败；117积分已全额退回。随后使用 H3 Max完成旧流程基线。Retake 的 Seedance 路线直接使用原生视频编辑能力，未经过 Eco。

成本来自本次任务实际产品账单；供应商报价分别约 Seedance $1.30、H3 $1.064、LTX $0.20。参考片段长度及价格版本不同，积分不能直接用来推断模型单价优劣。

## 可观看结果

- [原片](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/706c9cb3-4666-419c-b8e4-67a6156900e9/videos/f72ee11f-482d-4fa2-bf49-c07e4b24b6f5.mp4)
- [Seedance Retake](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/5df2db22-db5c-49c4-b9c8-347c76934434/videos/retake-ee6ec05c-cfa9-4f7a-8d44-39d821c876b9-final.mp4)
- [H3 Max Retake](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/5df2db22-db5c-49c4-b9c8-347c76934434/videos/retake-d19a46d7-c15a-4f2f-a36c-dd184710c31c-final.mp4)
- [LTX Retake](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/5df2db22-db5c-49c4-b9c8-347c76934434/videos/retake-37200cd4-1279-4ddd-b724-f5d10b92a6ad-final.mp4)
- [旧流程 H3 最终片](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/5df2db22-db5c-49c4-b9c8-347c76934434/media/1791368620081-book-red-full-repaired.mp4)

本地证据在 `artifacts/video-retake/`：`new-path-evidence.json`、`old-usage-evidence.json`、`agent-run-timing.json`、各次 Agent 回执及完整 MP4。该目录忽略入库，实际文件保留在候选 worktree。对比页 `comparison.html` 支持同步播放、定位至选区和3.5秒。

## 验证与实际状态

- 已走通 CLI提交/轮询、Agent调用、已有任务重放，以及浏览器时间线选区进入聊天。
- 三条新路线输出均为完整原时长、原尺寸/帧率、AAC视频，非供应商中间短片。
- 合成视频验证准确替换选区，选区外画面保持，原始压缩音频哈希相同。三条真实新路线均完整解码通过、压缩音频哈希与原片相同，选区外平均PSNR约48.2–48.3dB。旧流程完整解码通过，但音频哈希不同（重新编码），选区外约47.5dB。证据 `media-verification.json`。
- 8组针对性测试31项通过，CLI smoke通过；原视频时间到模型参考片段时间的换算另有回归断言。
- 桌面及463px手机视口验证：真实30秒原片显示8张缩略图，10–23秒区间及模型选择正确进入聊天，验证草稿已清除。生产构建使用项目既有worktree的webpack路径通过，CRC32C 10条API trace、FFmpeg 9条trace通过。独立`tsc --noEmit`通过。
- 新增服务专用 Retake 任务表及 LTX定价已添加至共享数据库，未修改已有表/模型价格。功能代码仍为本地候选。

实际产品收益首先是把多轮复杂流程收敛为一次选区操作、一次任务和自动成片。模型效果仍需更多动作、人物和切镜样本检验；本次机器人滑板多机位编辑属于独立真实需求，不与改书颜色的基线混算。

## 用户真实素材：机器人滑板多机位

原片 `eco-720p-final.mp4`，30.048秒，1280×720、24fps。只替换10–23秒，保留两端内容及原声。首版新角度较少，原片全局时间与13秒模型片段时间容易混淆；保留首版，修正时间换算后明确使用片段局部时间加强镜头指令，再做一次生成。

最终版能明确看到远景、贴地轮子特写、侧面跟拍与低机位起跳；没有严格实现计划中的顶视俯拍，不将此项算作通过。它明显替换了原片中间的吉祥物/悬浮相机镜头，镜头切换更集中于机器人滑板。模型仍保留了后半部分原有叙事，无法保证严格执行六镜头脚本。

最终输出完整解码通过，720帧、30.048秒，原始AAC压缩音频哈希相同。交付 `/Users/tianyicai/Downloads/eco-720p-multicam-retake.mp4`；项目 `d78fcc10-2909-4ce6-addf-a49059631a00`，最终任务 `60ab05b4-aead-49a4-bc43-6ea10c6a459f`。

首版完整任务5分15秒，最终版7分25秒；最终版生成阶段6分01秒的观测值包含本地开发服务器编译造成的轮询延迟，不等于纯供应商耗时。两次不同创意生成各有独立任务回执，各845积分，合计1690积分（供应商报价合计约$8.45），未复用任务ID隐藏额外费用。真实素材证据：`user-job-evidence.json`、`user-billing-evidence.json`、`user-final-verification.json`、两版完整成片与联系表。


## 滑板：旧流程与三模型的同片对照（补充）

这组直接复用用户同一原片，源10–23秒、13秒参考、30fps与最大1280的参考制作合同、同一份片段局部六机位英文修改要求。完整成片均统一回1280×720、24fps、30.048秒，并保留原片AAC音轨。Seedance复用第二版已成功任务，不额外付费再跑。旧流程也使用H3 Max，用于隔离流程区别；并在第二轮继续执行已经授权的拼接。

| 路线 | 产品积分 | 供应商耗时 | 记录到完整交付 | 实际观察 |
| --- | ---: | --- | --- | --- |
| 旧流程 · H3 Max | 581 | FAL inference 84秒 | 6分53秒 | 切镜清楚，有轮子近景、侧面、低机位与俯拍；需要第二轮Agent拼接 |
| 新 Retake · H3 Max | 580 | FAL inference 78秒 | 6分14秒 | 与旧流程画面接近，机器人保住；俯拍与跟随镜头明确，全片自动拼回 |
| 新 Retake · Seedance 2.5 | 845 | EvoLink任务duration 331秒 | 7分25秒 | 保持原片角色、质感和后半动作，新增近景；保留后半原镜头，未完整执行六机位 |
| 新 Retake · LTX 2.3 | 260 | FAL inference 255秒 | 6分02秒 | 实现轮子、侧面、跳跃和俯拍，但方屏机器人变成圆头角色，Spark也变成另一只紫色角色 |

计时口径不同，不能直接把Seedance的任务duration与FAL inference视为完全相同指标。新H3生成阶段观测5分09秒而FAL inference为1分18秒，差值包含排队、未持续轮询和开发等待；本次总耗时不是生产稳定性能。旧流程两轮Agent活跃时间合计4分57秒，含定位/参考准备/提交与拼接，但不等于纯供应商等待。不能据此宣称新流程稳定快了多少倍。可确认的是新流程无需第二轮交接、脚本生成与发布指令。

同一核心要求不等于字节相同的供应商请求：旧Agent给英文要求加了一个标题，旧参考容器因AAC尾帧为13.032秒，新参考报价按13秒；因此旧H3比新H3多1积分。新H3/Seedance附带Retake的保留与区间合同提示，LTX原生Retake使用核心要求。H3的供应商输出为1344×768且约13.7秒，LTX为1920×1080/13秒，Seedance约12.736秒；新流程会统一映射到源13秒的312帧。旧Agent采用裁齐方式，完整视频721帧，比新流程720帧多1帧，但容器总时长一致。模型随机性与原生输出约束均保留在对比中，不把单次样本包装为严格可重复benchmark。

默认决定：首版使用FAL H3 Max，原因是这次真正完成较明显的新机位覆盖、保持源机器人，成本低于Seedance，供应商推理也较快。Seedance在改书颜色样本的局部保真更好，可由聊天指定。LTX便宜但当前两个样本分别有改色回退与角色变化，暂不默认。这是两个案例下的候选策略，未证明所有编辑类型的优劣。

官方合同：[LTX原生Retake](https://fal.ai/models/fal-ai/ltx-2.3/retake-video/api)支持start_time、duration与replace_video；[H3 Max reference-to-video](https://fal.ai/models/minimax/h3-max/reference-to-video/api)通过参考视频生成新短片。产品的区间裁取和完整成片合同由Makaron统一完成。

查看 `artifacts/video-retake/skateboard-matched/comparison.html` 可同步播放五条完整成片；`skateboard-five-way.mp4`为同一选区13秒同步对比。`new-jobs.json`、`new-billing.json`、`*-provider-status.json`、`seedance-provider.json`与两轮`old-*-run.json`保存时间、工具输入和账单证据。四条输出完整解码通过，压缩AAC哈希均与原片相同。主片的首尾未重新生成，选区外画面由源片重新编码，因此不是压缩视频字节相同。

新版pill验收：移动视口实测拖动将0–4秒扩成8–23秒（最长15秒），再调到10–23秒；主视频暂停并定位至10秒。右侧按钮自然带入聊天草稿，不提交生成、不出现截图附件。桌面与移动视口还检查既有pill位置和8张缩略图，截图留在同一证据目录。代码仍在独立候选worktree，未合并或发布。


最终候选验证：5组针对性测试15项通过，CLI smoke通过，`tsc --noEmit`、UI四语言检查与webpack生产构建通过；10条CRC32C、9条FFmpeg API打包trace通过。完成态Retake接入现有封面修复器，首次拼接复用已下载视频bytes抽封面，已有完成任务也可补封面；本次H3与LTX卡片已有真实poster。五路对比页浏览器实际播放时，五条视频均readyState=4，时间差小于0.02秒；拖到源18.5秒可同时看旧、新H3俯拍、Seedance保留原镜头与LTX角色变化。首版H3完整片及五路对比已保存至Downloads，未覆盖先前Seedance交付。

## 2026-10-08 验收修改

用户明确淘汰 LTX：删除未上线的供应商适配器，GUI/Agent/MCP/CLI 不再接受该模型，CLI 和公开技能说明同步更新。共享数据库中唯一的 LTX 实验定价已置为 inactive；两条已完成历史任务及其成片保留，新迁移记录停用定价。

H3 在完整视频 10–11 秒的动作重启来自原要求的“0–2 秒滑向斜坡”，而源片 10 秒已经起跳。修正后提取参考区间首尾状态图片，作为已验证和计价的 H3 图片参考，明确继续已有动作、切镜推进动作而非回放，并禁用提示词扩写。Seedance 路径未变化。首尾状态参考与修改开场要求共同改变，因此这一轮没有把提升归因到单一因素。

原生 image_url/end_image_url 约束试验 `be7a437c-f56b-4bf2-96dd-399cda8f7233` 队列显示 COMPLETED，但结果是 HTTP 504、结构化 downstream_service_unavailable，未产生视频；产品 587 积分已退还。该试验不作为效果和耗时样本，也不保留原生首尾帧约束进入候选产品。轮询新增了只在已结束队列加结构化供应商推理失败时终止的处理，普通 5xx/网关错误仍保留原任务继续查询，不自动再生成。

最终使用参考生成的任务 `73fe6efe-9a51-46a7-a7ad-90557bc752e7` 完成：587 积分，FAL inference 63.947 秒，Retake 任务总墙钟 147.081 秒（约 2分27秒，包含准备、供应商等待、下载与拼接）。失败试验的等待单独记录，不计入成功任务耗时；单次成功不证明稳定速度优势。新成片在 10–11 秒接着起跳，后续有轮子近景、侧拍、俯拍和跟拍切换，机器人身份保持。候选默认继续使用 H3，Seedance 2.5 保留。

- [新版 H3 完整视频](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/d78fcc10-2909-4ce6-addf-a49059631a00/videos/retake-73fe6efe-9a51-46a7-a7ad-90557bc752e7-final.mp4)
- 本机完整成片：`/Users/tianyicai/Downloads/eco-720p-multicam-retake-h3-fixed.mp4`，未覆盖旧 H3 与 Seedance 成片。
- 验收 UI：`http://localhost:3039/projects/d78fcc10-2909-4ce6-addf-a49059631a00`；修正前后对比：`http://localhost:3041/h3-entry-comparison.html`。

产物检查：1280×720，24fps，720帧，30.048秒，完整 FFmpeg 解码通过，原 AAC 音轨 SHA256 与源片一致。新任务已发布至项目 snapshots，带真实视频封面。浏览器四路视频 readyState=4，正常速度同步播放时相差小于0.04秒；10.5秒画面可见原片和新版 H3 都在空中，旧 H3 已重新滑行。GUI pill 拖动与键盘选出10–23秒后，主视频暂停在10秒；聊天自动填入“把 @1 的 10.00–23.00 秒换成：”，未发送新的聊天生成。

验证：四组针对性测试43项通过，CLI smoke、TypeScript、四语言UI检查、公开技能生成检查通过；最终 webpack 生产构建通过，10条 CRC32C 与9条 FFmpeg API traces通过。本轮保留本地候选和验收服务器，未合并、未部署生产。
