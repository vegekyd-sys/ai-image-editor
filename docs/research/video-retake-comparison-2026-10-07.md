# Retake：旧入口升级与实际对比

2026-10-07，本地候选分支 `codex/video-retake`。尚未合并、发布。

## 产品行为

每条视频原有的“从这儿开始编辑”入口打开视频时间线：预览、缩略图、开始/结束时间、选区与模型选择。选择 0.1–15 秒后进入聊天，Agent 直接执行 Retake；不再把截图、分析定位、确认脚本、生成短片、确认拼接串成多轮操作。

GUI、CLI、Agent 和 MCP 共用同一条任务合同：源视频 + start/end（原视频秒数）+ 修改要求 + 模型。提供 Seedance 2.5、FAL H3 Max、LTX 2.3。H3 Turbo 不接受源视频，未列入此功能。

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
- 新增服务专用 Retake 任务表及 LTX定价已添加至共享数据库，未修改已有表/模型价格。功能代码仍为本地候选。

实际产品收益首先是把多轮复杂流程收敛为一次选区操作、一次任务和自动成片。模型效果仍需更多动作、人物和切镜样本检验；本次机器人滑板多机位编辑属于独立真实需求，不与改书颜色的基线混算。
