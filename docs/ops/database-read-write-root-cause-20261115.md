# 数据库读写失败根因与修复（2026-11-15）

## 证据与结论

三个错误不能直接归为同一种故障。2026-11-14 16:00Z 至排查时，生产 Postgres 日志记录 231 次 SQLSTATE57014：workspace_files 查询115次、snapshots读写114次、messages upsert2次。后两次消息写入与先前告警时段一致。没有 token_rates 的57014。当前连接约18/90，未看到连接耗尽或死锁证据。

确定的查询根因：

- 工作区有564,400条记录，真正的 `skills/%/SKILL.md` 只有363条。大用户的技能目录查询返回55条，却执行全表扫描并过滤564,345条；一次冷读取约732ms。普通路径索引无法有效区分大量技能附件与少数目录入口。
- projects及其下游snapshots/messages/agent_events/agent_runs，以及workspace_files的RLS逐行调用JWT身份函数。真实快照查询仅返回7条，却先扫描22,255个项目并重复解析身份，约68ms。高频目录和读写请求会放大数据库工作量；增加超时时间或只加重试不能消除这些开销。
- snapshots还存在同一行tips更新的锁等待日志。查询和RLS工作量修复不能证明所有历史锁等待均由同一因果链引起；保留此区别，不把231次错误都宣称为同一根因。

Tips结算需分开判断：03:40–03:50Z的Gateway日志中，16个token_rates请求全部HTTP200，正常数据库上游耗时2–10ms；同窗口PostgREST有Warp timeout-manager记录，但没有与应用请求关联的ID。旧包装错误丢失了原始cause，不能从现有历史证据确定这六个具体请求的网络失败原因。PR28已改用Next.js after登记后台结算生命周期，保持前端流立即结束；它修复确定存在的悬空Promise缺陷，不宣称证明了历史全部错误的唯一原因。

## 实现

1. `idx_workspace_skill_catalog`仅索引两种目录入口路径，生产大小72KB；并发创建，不锁住正常写入。
2. `list_workspace_skill_entries`固定目录谓词，让generic prepared plan也能使用这个小索引。SQL为SECURITY INVOKER，保留调用者RLS和own/global范围，匿名无执行权限，不增加SECURITY DEFINER。
3. 六张关联表的原policy、角色、命令、USING/WITH CHECK逻辑保持一致；仅将auth.uid()/auth.role()包装为statement-level SELECT。迁移有100ms锁等待与5s语句上限，失败整体回滚，不放宽线上请求超时。
4. 应用只把两种目录查询切到RPC。其它pattern、文件内容、镜像路径、排序、缓存和失败保护不变。依赖PR26的目录完整性保护。

## 验证

生产相同用户权限、相同SQL、每项5次顺序采样，测数据库执行时间（不是网络或端到端时间）：

|查询|修复前中位数|修复后中位数|返回条数|
|---|---:|---:|---:|
|大工作区目录|861.593ms|0.774ms|55→55|
|另一工作区目录|87.819ms|0.306ms|9→9|
|真实项目快照|68.050ms|3.388ms|7→7|

同一事务中原查询与RPC执行EXCEPT ALL双向比较，两组用户结果差异均为0。生产表ACL与RLS开关逐项相同；安全advisor输出未变化；15条相关auth_rls_initplan告警消除。索引valid/ready均为true。

隔离Postgres/WASM回归覆盖：四种角色/用户的原有可见性一致、完整字段/内容/顺序、伪造owner不可读、anon不可执行、原表权限不变、generic prepared plan、本人可写、陌生人/公开项目不可写、不可转移所有权及小索引被选用。50,000条合成附件下，目录查询由约17ms降到0.03ms。测试不依赖远端数据库或用户内容。

- `PGLITE_MODULE=<installed module> node scripts/test-workspace-catalog-db.mjs`
- 6个相关测试文件30项通过；全量3175项通过、2项按原配置跳过；TypeScript通过。
- controlled Skill routing4/4通过，所有非read_file工具被拦截，实际媒体生成0次；skill-sync检查通过。

这些采样不能等同于高并发端到端P95或所有媒体质量验收。模型、提示词、媒体处理参数与生成内容合同没有改动。

## 应用与回滚

只应用本PR的两条迁移，禁止借本次任务执行所有历史pending migration。先单独执行并发索引语句，再执行policy/RPC事务；两条已在生产应用并登记schema_migrations。应用代码必须在RPC部署后发布；旧应用保留原查询，可兼容新表结构与权限。

生产证据、应用回执、原policy精确回滚SQL仅保存在本机私有artifact目录，不包含在仓库。应用回滚先退到原生产部署；必要时用该回滚SQL恢复policy。小索引和invoker RPC可保留，不需要删除用户数据。暂不改生产角色超时、连接数或实例套餐。
