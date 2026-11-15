# Agent 消息写库超时恢复

2026-11-15 线上异常事件读取了 Vercel 完整 request logs，而非 CLI 映射的第一条代表消息：两个 `/api/agent/run` 请求命中了 DualWriter message upsert 的 PostgreSQL `57014`（statement timeout）。同批 Tips preview 的 503 另对应 OpenRouter HTTP 402，不与数据库错误合并归因。

此前 agent_events 有有界重试，messages upsert 只有一次尝试；`new_turn` 的消息保存为 best effort，失败后仍清空文本、切换 ID。最终 done/error 已要求保存成功，但轮次切换可能先丢失 canonical message 内容。审计事件存在不代表 messages 已正确持久化。

候选改动：messages 和 agent_events 共用四次上限、0/75/250/750ms 的重试节奏；瞬时 SQL 错误 57014/40001/40P01/55P03 与网络错误可重试，权限/格式错误不重试。同一次 messages 保存捕获固定 ID、正文和图片标志，结果不确定也只重复同一 upsert，不生成新内容、不发起供应商调用。new_turn 必须保存成功才清空正文并切换 ID，失败时保留当前轮次并抛错；done 仍不会在保存失败时发布完成事件。

此改动提供写入故障恢复和丢失保护，不证明数据库超时的底层资源/争用原因已修复。长时间不可用仍会在四次后失败，不无限重试、不调整数据库超时或配置，也不修改既有生产消息。

回归覆盖：暂时 SQL 失败后的相同消息重试；耗尽重试后保留正文/ID、恢复后再切轮次；失败不发布 done；权限错误不重试；网络结果不确定时沿用相同 upsert。无需数据库迁移、UI 文案或 CLI/npm 合同变更。尚未合入、尚未部署，不用本地测试代替上线验收。
