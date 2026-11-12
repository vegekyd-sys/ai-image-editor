# 图片角色恢复：最终 CLI 验收

日期：2026-11-12。分支：`codex/image-refusal-recovery`。范围：新增角色供应商对比、真实 Makaron CLI 全链路验收、普通图片隔离验证和代码自查。生产和 npm 发布不在本次本地验收范围内。

## 扩展角色实测

固定普通非色情角色插画描述，每条描述、每模型独立测两次。首轮拒绝后，分别另测一次同模型和一次跨模型；分支交替顺序，不混淆角色名或改写提示词。两个分支是比较实验，不是一条生产恢复链。

| 角色 | Flare 首轮 | Nano 2.1 首轮 | 老版 Nano 2 首轮 | Flare 拒绝后换 2.1 |
|---|---:|---:|---:|---:|
| 米老鼠 | 0/2 | 0/2 | 0/2 | 0/2 |
| 哆啦 A 梦 | 2/2 | 2/2 | 2/2 | 无拒绝样本 |
| 马里奥 | 0/2 | 2/2 | 2/2 | 2/2 |
| 蜘蛛侠 | 0/2 | 0/2 | 0/2 | 0/2 |

扩展轮共 **44 次图片提交、12 张产物**。已知成本 **$0.5419305 + 32 次未知拒绝成本**。未返回 usage 的拒绝没有计为免费。Flare 同模型重试 0/6，平均 11.08 秒；Flare → 2.1 恢复 2/6，平均 14.68 秒（含失败恢复）；2.1 首轮 4/8，平均 14.67 秒；老版 Nano 首轮 4/8，平均 10.08 秒。四次成功老版 Nano 平均 $0.06848，四次独立 2.1 成功平均 $0.03626。

结合先前皮卡丘/宝可梦实验，Flare 同模型重试合计 0/9，Flare → 2.1 合计恢复 5/9。不同角色的拒绝高度相关，不能据此承诺任意版权内容的长期成功率。供应商返回的通用审核标签也没有证明法律上的版权原因。

老版 Nano 的第一条米老鼠响应通过成功 HTTP 返回 `native_finish_reason=PROHIBITED_CONTENT`，没有图片。比较器初次把它误标为 unknown，已依据原回执纠正并修正解析器，未重新提交该次尝试；只读供应商回执查询返回 404，不能推断成本为零。

比较器：`scripts/image-copyright-benchmark.mjs --generate --extended`，老版另加 `--classic`。本地忽略证据在本 worktree 的 `test-output/image-copyright-extended-20261112/` 和 `test-output/image-copyright-extended-classic-20261112/`。12 张产物已逐张查看，角色与请求主题可辨识。

## 真实 CLI 最终验收

生图入口全部使用真实 Makaron CLI，未用供应商直连接口代替：

- `chat --project ... -b --json` 发起，`responses get --wait --json` 等待，再用 `--events` 核对工具调用与 NSFW 事件。
- `edit` 验证直接生图、恢复、原图抠图、文件格式与 NSFW 路由。
- `project media --json`、`usage --project --json`、`responses list`、`credits` 查询实际产物和计费。

后端是本机专用 runtime（端口 3039），使用真实供应商、应用鉴权、专用测试项目、持久化和计费。原有项目的数据未修改。CLI 使用打包后全新目录安装的 **0.17.17 候选包**；没有发布 npm 或部署 Production。

| 用例 | 实际观察 |
|---|---|
| 米老鼠 chat | 一次 `generate_image`，内部 Flare → 2.1 均拒绝，56 秒结束；0 图片收费，1 推理 credit；Agent 不再发起第三模型 |
| 同项目随后生成普通红杯 chat | 一次工具调用，默认 Flare 成功，44 秒；图片 6 credits + 推理 1 credit；没有角色恢复标记，没有 NSFW 事件 |
| 马里奥 chat | 一次工具调用，Flare → 2.1 成功，77 秒；图片一笔 8 credits + 推理 1 credit；输入保留 Mario 名称，没有 NSFW 事件 |
| 普通商品照 edit | Flare 成功，6 credits，1254×1254 PNG，不触发恢复 |
| 商品图 edit --image ... --background transparent | Flare 成功，9 credits；原尺寸 1254×1254，真实 alpha 最小值 0；主体形状、颜色保持 |
| 中性红布 edit --nsfw --benign-character | 直接 Qwen Spicy，3 credits，1024×1024 PNG；新标记不能覆盖 NSFW 路由 |
| 马里奥 edit --benign-character | Flare → 2.1 成功，8 credits；供应商返回 JPEG，CLI 正确保存为 .jpg |
| 马里奥 edit --benign-character --output-format png | Flare → 2.1 成功，8 credits；1024×1024 PNG，实际文件格式符合请求 |

CLI 图片与推理费用分别核对；不能把 9 credits 全部称为图片成本。比较实验的 USD 与应用 CLI 的 credits 分开报告。

完整回执和产物位于本 worktree 的 `test-output/image-copyright-cli-final-20261112/`。chat 的实际交付 URL 已取回查看；直接 edit 文件完整解码；透明图验证 alpha，不把黑底显示当成透明证据。最终测试项目在米老鼠拒绝后没有收到图片；普通杯子与马里奥各交付一张。

## 验收发现与修复

1. 第一版 CLI 米老鼠测试暴露 Agent 会在工具内恢复失败后继续改写请求、换模型。该 run 已通过 CLI abort 停止，保留了 17 credits 的 MJ 图片测试消费记录。修复复用了现有 `terminal` 工具合同及四语言 userMessage，让当前请求停止；不增加项目或 NSFW 状态。复测一次工具调用后结束，下一条普通图请求成功。
2. 最初全局收紧网络/5xx 切换会影响普通图片的旧故障恢复，自查后已收窄为新角色路径。普通图未开启该路径，保持原行为。
3. 2.1 有时返回 JPEG。明确要求 PNG 时增加解码像素的无损编码，单元测试比较转换前后的解码像素完全一致，真实 CLI 显式 PNG 用例通过。透明、GIF/SVG 等不降级或替换。
4. 全量测试发现新工具描述超出长度预算和创意 prompt 指纹变化。已恢复原工具描述，把参数合同留在 schema；没有放宽测试阈值或修改创意基线。
5. 第一次普通图 chat 在图片提交前遭遇执行权限查询的 `fetch failed`，供应商未被调用。用一条新验收输入复查后通过；未把该次中断算为生图成功，也未自动重发未知图片任务。

自查覆盖请求/参考图完整性、格式与 alpha、未知结果不扩散、备用前价格预检、用户一次图片扣费、取消/时限、Agent/worker 终止、NSFW 状态隔离，以及普通图片路由和供应商故障行为。没有剩余阻断项。

## 验证记录

- 全量 Vitest：**394 个文件、2912 项通过，2 项默认跳过**；付费用例另行显式运行。
- `tsc --noEmit --incremental false`、核心 prompt 保护、UI i18n 检查通过。
- Skill build/check 同步、受控路由预检 3/3（媒体操作 0）、CLI smoke/upload、包内容检查通过。
- 本地 0.17.17 tarball 全新目录安装、版本/help 和上述真实 CLI 命令通过；四份版本元数据一致。尚未发布 registry。
- 定点 ESLint：0 errors，保留一个原有未使用参数 warning。

## 本地复验入口

使用 dev 仓库中的 CLI，或本地已检查的 0.17.17 包；全局已安装旧版 CLI 的 chat 也可调用新后端，但直接 edit 的新参数需要候选 CLI。

```bash
MAKARON_URL=http://localhost:3039 node packages/makaron-cli/bin/makaron.mjs chat --project auto "画一张马里奥在花园里拿着苹果的插画，1:1，默认模型，直接生成"
MAKARON_URL=http://localhost:3039 node packages/makaron-cli/bin/makaron.mjs edit --benign-character --output-format png --out mario.png "Mario sitting on a garden bench holding a red apple, square illustration"
```

另测普通商品照、原图透明抠图，并在角色拒绝后继续一条普通图片请求。米老鼠/蜘蛛侠仍可能被多个模型拒绝；预期是尝试受限、如实说明、状态不污染，而不是保证出图。
