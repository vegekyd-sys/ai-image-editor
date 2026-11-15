# Tips 定价读取失败候选

2026-11-15 11:43–11:45（Asia/Shanghai），监控发现 6 次 `/api/tips` 报错。抽取两个请求的完整日志，均为 HTTP 200，实际错误为 `[billing] tips deduct error` / `PricingUnavailableError: Token pricing unavailable. Please retry.`。它来自 `token_rates` 查询失败，并非缺失模型行的另一条 `Token pricing is not configured` 错误。原代码未保留数据库错误码，不能断言是 statement timeout、网络或权限问题。

11:48 的只读复核成功（634ms、48 条 active rows），Tips 对应 `google/gemini-nano-banana-2.1:text` 行存在。当前恢复不能证明所有请求已恢复，也不能证明历史扣费完成。没有读取或修改用户余额、补扣历史费用。

## 候选行为

- token rate 查询遇到可识别临时错误时，间隔 250ms 重建相同 active / order 查询，最多 2 次；成功后仍使用数据库当前价格。
- 权限、表/列缺失、鉴权错误直接失败；空目录/缺失模型也不使用缓存、固定价或猜测价格。
- 最终失败保留安全的数据库错误码与 attempts，不携带原始 details、用户数据或连接 URL。历史日志没有这些字段，无法追补根因。
- Tips 仍立即流出建议与 `[DONE]`，但在关闭响应流前等待既有扣费 Promise，防止生命周期结束时仍有悬空扣费操作。
- 重试只发生在价格读取阶段；扣费 RPC、usage 写入和模型生成均不重试。持续失败仍记录错误，不报告已结算。

## 验证与边界

回归覆盖一次 timeout 后只扣一次、持续失败不扣费、永久错误不重试、网络异常、无跨请求旧价缓存、扣费结果不确定时不重试，以及建议/DONE 提前送达而流关闭等待结算。没有触发真实付费生成或生产写入。

候选不是数据库根因修复，也不是失败扣费的持久化补偿队列。单次慢查询仍受数据库与函数超时限制。合入上线后需观察新诊断码与真实 Tips 请求；生产发布和历史账务处理需要单独授权。
