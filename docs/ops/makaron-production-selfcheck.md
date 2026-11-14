# 线上异常自检查

普通 Python 程序每 120 秒检查 `https://www.makaron.app/api/health`，读取当前 Makaron Vercel 项目 Production 的真实请求日志。健康轮次不调用 Codex、不生成媒体。运行在本机，Mac 休眠、断网、认证失效时存在空窗。

日志覆盖 HTTP 5xx，以及 HTTP 200 内的 error/fatal。Vercel 的 error 筛选返回请求，代表消息可能是 info，因此不能再次仅按返回 level 过滤。服务实测每次最多返回 50 请求；检测器按时间分窗补齐，超过有界读取预算则记录 partial，不推进成功水位。恢复时重叠读取，超过 24 小时的空窗明确记录。未知客户端异常、没有上报到 Vercel 的浏览器错误和生成质量不在此监控覆盖内；目前没有接入 Sentry。

新异常按路径和脱敏错误指纹合并，单个真实错误即可触发；健康探针失败再确认一次，连续三次日志不可读触发监控自身告警。持续同类错误及恢复只更新状态；未解决的同类复发至少间隔 24 小时。已关联待验收 PR 的指纹持续跟踪，避免重复开 PR。用户验收、合入和上线后，执行 `rearm --condition CONDITION` 重新武装对应指纹；这不会改变线上服务。

## 处理与验收边界

事件处理器优先沿用 Scene 已验收的桌面 owner/follower IPC，等待本聊天空闲再请求新回合；无桌面 owner 才执行现有 Codex CLI `--no-daemon exec ... resume`。不使用 `queue --resume`、不启动全局 daemon、不新建聊天、不覆盖模型与权限设置、不打断用户回合。保留 dispatch_id、接手和结束回执，启动请求不代表已处理；派发结果不确定时不盲目重试。

每次收到真实新异常，先复核线上证据并检查现有 PR；需要修复时从最新 dev 创建 managed worktree，完成相称验证，开 base=dev 的 PR 交用户验收。此机制不自动合入、不部署、不改生产数据/共享配置、不执行收费生成、也不操作 Scene、V 或夜班。

独立 worker、IPC 来自 Scene 2026-11-15 的已验收实现，复制在本仓库内并有独立测试；运行无 Scene 目录依赖。运行文件在 `~/.codex/monitors/makaron-production/`，安装使用当前分支文件；用户合入前的本地监控安装不表示产品修复已上线。

## 运行方式

`bridge-config.json`（0600）包含 base_url、Vercel 项目 ID、现有 vercel_cli/codex_cli 的绝对路径、原聊天 thread_id 和稳定 handler_cwd；不存账号密钥。Vercel 使用既有 CLI 登录态。

先运行 `scripts/install-makaron-monitor.py --thread THREAD --cwd CANONICAL_CHECKOUT --codex EXISTING_CLI`；安装默认暂停，保留既有状态并拒绝覆盖其他聊天或未完成批次。核对基线及已知 PR 后执行 bridge 的 enable。无需创建周期模型 automation。

```sh
/usr/bin/python3 ~/.codex/monitors/makaron-production/makaron_event_bridge.py --directory ~/.codex/monitors/makaron-production status
/usr/bin/python3 ~/.codex/monitors/makaron-production/makaron_event_bridge.py --directory ~/.codex/monitors/makaron-production disable
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.tianyi.makaron-monitor-event-bridge.plist
```

停用先 disable 再卸载 LaunchAgent。不要输出未筛选的 `launchctl print`，可能含继承的凭据。

`selftest --defer` 创建纯本地合成事件，由下一次普通 tick 走相同派发路径。实际新回合必须 claim、保存结果、complete；独立 worker 核对原聊天、新 turn ID、真实回执后才写 `wake-acceptance-BATCH.json` 的 passed=true。设置回合不得代写回执，单测不能代替真实唤醒验收。

## 2026-11-15 排查与候选修复

近 24 小时有界日志分页合并得到 297 个错误筛选命中的请求：284 个 MiniMax invalid task_id 请求、10 个 cron Agent 进程 SIGKILL 请求，另 3 个请求的代表消息是 info（不据此推断真实底层错误）。同窗 HTTP 5xx 查询无结果，健康端点 13 项正常；健康页不足以证明业务无错。

只读核对发现 3 个 2026-09-08 的 MCP 视频账单记录仍为 submitted。候选修复区分“查询 ID 被明确拒绝”和“生成失败”：仅旧于 24 小时、明确 invalid task_id 且 queryFailed 的记录转 uncertain，保留 task_id 与 credits，不退款、不重新生成；更新带 submitted 条件，避免覆盖并发完成状态。新任务、鉴权/限流/网络/5xx 错误继续重试。无需数据库迁移，不修改 CLI 合同或发 npm。

uncertain 需人工核对供应商回执；确认后先按 owner/ID 条件恢复 submitted，再使用现有 settle RPC 幂等结算。它不会被现有只接受 submitted 的 settle RPC 自动处理。候选尚未合入、尚未部署，本次未修改这 3 条生产记录。

SIGKILL 仍缺少内存、平台退出原因的直接证据。只读发现 4 个 run 最终为 repeated_interruptions，不能把时间邻近等同确定因果，也不能把此 PR 当作 SIGKILL 修复。后续同类新异常继续在本聊天定位。
