# GPT Native Web Search

Makaron 的 Azure OpenAI Responses API 与 Codex 个人订阅路径均使用正式 `web_search`。这不是 Tavily 自定义工具，也不需要额外搜索 API key。OpenRouter、DeepSeek 与 Grok 路径不注入此工具。

## 运行边界

- Azure 与 Codex 订阅路径获得 `web_search`。具备订阅资格的用户使用 Auto 时仍优先走订阅，不为了搜索切换到 Azure。
- 默认只在用户明确要求联网，或答案依赖新闻、价格、日程、规则等时效信息时搜索。
- 默认向 Responses API 发送 `max_tool_calls: 2`；同时按唯一 call ID 记录实际 provider actions，避免流事件重复计费。
- 搜索只读公开网页，不能登录、操作网页或代替完整浏览器自动化。
- 网页内容按不可信输入处理；页面中的指令不能覆盖系统与用户要求。

## 配置

功能默认开启。可通过以下环境变量调整：

```bash
# 设为 false 可紧急关闭
AGENT_WEB_SEARCH_ENABLED=true

# low（默认）/ medium / high
AZURE_OPENAI_WEB_SEARCH_CONTEXT_SIZE=low

# 默认 2，运行时限制在 1-5
AZURE_OPENAI_WEB_SEARCH_MAX_CALLS=2
```

Azure 搜索使用现有 `AZURE_OPENAI_API_KEY` 与 `AZURE_OPENAI_RESPONSES_URL`。

## 引用与恢复

Responses API 返回的 URL citation 会保留在正文 Markdown 中；`source` 流事件还会生成去重、可点击的来源标签。来源事件写入 `agent_events`，因此 durable execution、断线重连与历史事件回放都能恢复来源。

静态 `messages` 表保存完整正文；项目重进和缓存预热会同时读取 source 元数据，将 provider 引用编号恢复为可点击链接。未解析的内部引用标记不会展示给用户。

## 计费

Azure 模型输入输出继续按 token 计费，每次搜索事务另外记为 `web_search`。Codex 订阅搜索复用个人订阅用量记录，每次记入 `usage_logs`，`credits_charged=0`；不读取 Azure 搜索价格，也不扣 Makaron 积分。Azure 搜索初始价格：

- supplier cost: `$0.014`
- Makaron 初始配置价格: `3 credits`（以当前 Admin 数据库配置为准，不使用代码 fallback）
- 按唯一 provider call ID 的实际执行次数计费；计费函数最多接受 5 次，防止异常事件放大

迁移 `20260718000000_web_search_pricing.sql` 只补缺失的 Admin 定价行，不覆盖已有人工配置。

## 验证

```bash
npx vitest run __tests__/azureOpenAIResponses.test.ts __tests__/agentModels.test.ts __tests__/agentCallbacks.test.ts __tests__/agentDualWriter.test.ts
npx tsc --noEmit
npm run build
```

上线前建议分别用 Terra、Sol、Luna 提问一个当天可验证的问题，确认：触发 `web_search`、正文带引用、来源标签可打开、usage log 记录搜索事务。
