# Makaron 订阅功能设计讨论

## 现有 Credit 系统总结

| 层级 | 实现 |
|------|------|
| **计费单位** | Credits（每个工具在 `credit_pricing` 表有独立定价） |
| **购买** | Stripe 一次性购买 3 档（$5/500cr, $20/2200cr, $50/6000cr） |
| **扣费** | MCP 工具调用前 `checkBalance` → 执行后 `deductCredits` |
| **记录** | `usage_logs` 审计 + `credit_purchases` 购买历史 |
| **前端** | Dashboard 页（余额、充值、API Key 管理） |

---

## 计费模型：混合制（Token + 按次）

### 核心定义：1 Credit = $0.01

Credit 本质是货币抽象。所有消耗最终换算成 Credit，统一扣减。

### 两类计费方式

**按 Token 计费** — 供应商返回 token 用量，实时计算

适用于：OpenRouter / Bedrock / Google 的所有调用（LLM 对话 + 图片生成）

```
credit = ceil((input_tokens × input_price + output_tokens × output_price) × markup / 0.01)
```

**按次/按秒计费** — 供应商不返回 token，固定价格查表

适用于：视频、音乐、自托管 GPU、3D 等

---

### 按 Token 计费（实时计算）

| 消耗点 | 供应商 | 模型 | 代码位置 | 备注 |
|--------|--------|------|---------|------|
| **Agent 对话** | Bedrock | Opus 4.6 | `agent.ts` → `streamText()` | 最贵，input $15/M + output $75/M，不限次 |
| **Tips 生成** | Bedrock / OpenRouter / Google | Sonnet / Gemini Flash | `gemini.ts` → `streamTipsByCategory*()` | 很便宜，~$0.001/次 |
| **生图 (Gemini)** | Google / OpenRouter | gemini-3.1-flash-image-preview | `models/gemini.ts` | img2img + txt2img |
| **视频脚本** | Bedrock | Claude Sonnet/Opus | `skills/write-video-script.ts` | 分析多图 + 生成脚本 |
| **Pony/WAI prompt 翻译** | OpenRouter | Grok-3 | `comfyui-sdxl.ts` | 自然语言 → danbooru tags |

**实现要点**：`streamText` 返回值已有 `usage.promptTokens` + `completionTokens`，当前代码没读。只需在调用结束后捞出来算 credit。

**Token Rate 表**（需要维护）：

| 模型 | Input $/1M tokens | Output $/1M tokens | 备注 |
|------|-------------------|---------------------|------|
| claude-opus-4-6 | $15 | $75 | Agent 对话 |
| claude-sonnet-4-5 | $3 | $15 | Tips (Bedrock) / 视频脚本 |
| gemini-3.1-flash | $0.15 | $0.60 | Tips (Google/OR) + 生图 |
| gemini-3-pro | $1.25 | $5.00 | 备用生图 |
| grok-3 | ~$3 | ~$15 | Pony/WAI tag 翻译（量极小） |

> 注：图片 token 按模型各自规则折算（Gemini 图片约 258 tokens，Bedrock 图片按像素算）。
> Gemini 生图的 output 含图片 token，价格可能不同于纯文本 output，需确认。

---

### 按次/按秒计费（查表）

| 消耗点 | 供应商 | 计费单位 | 供应商成本 | 建议 Credit（2x markup） | 代码位置 |
|--------|--------|---------|-----------|------------------------|---------|
| **视频生成** | Kling 直连 | 按任务 | $0.112/s（5s=$0.56, 10s=$1.12） | 112 cr/5s, 224 cr/10s | `kling.ts` |
| **视频生成** | PiAPI (Kling代理) | 按任务 | $0.168/s | 168 cr/5s（备用，更贵） | `piapi.ts` |
| **视频生成** | Foldin (SeeDance) | 按任务 | 待确认 | 待定 | `foldin.ts` |
| **音乐生成** | Suno V5.5 | 按任务（出 2 首） | $0.05 | 10 cr | `sunoapi.ts` |
| **生图 (Qwen)** | ComfyUI 自托管 | 按次 | ~$0.02（GPU 分摊） | 4 cr | `comfyui-qwen.ts` |
| **生图 (Pony)** | ComfyUI 自托管 | 按次 | ~$0.02（GPU 分摊） | 4 cr | `comfyui-sdxl.ts` |
| **生图 (WAI)** | ComfyUI 自托管 | 按次 | ~$0.02（GPU 分摊） | 4 cr | `comfyui-sdxl.ts` |
| **相机旋转** | ComfyUI Qwen | 按次 | ~$0.02 | 4 cr | `comfyui-qwen.ts` |
| **相机旋转** | HuggingFace/fal-ai | 按次 | 待确认 | 待定 | `api/rotate/route.ts` |
| **3D 模型生成** | Meshy AI | 按任务 | 待确认 | 待定 | `meshy.ts` |

> ComfyUI 成本 = vast.ai GPU 租金分摊到每次推理，实际取决于用量。$0.02 是保守估算。
> Kling 按秒计费（$0.112/s），duration 由用户选择（5s/10s/智能），credit 应按实际时长算。

---

## MCP 计费兼容

现有 MCP 的 `credit_pricing` 表是按次定价的。改造方案：

- **Token 类工具**（edit_image_gemini 等）：MCP 调用也改成读 token 用量计费（和 App 内逻辑统一）
- **按次类工具**（create_video 等）：保持现有 `credit_pricing` 查表逻辑

`pricing.ts` 增加 `pricing_mode` 字段：
```
credit_pricing 表新增列：
  pricing_mode: 'per_action' | 'per_token'
  -- per_action: 查 credits 列（现有逻辑）
  -- per_token: 调用结束后按 token rate 实时算
```

---

## 订阅 + Credit 的设计思路

核心理念：**订阅 = 每月自动充值 Credits + 订阅身份权益**

### 订阅计划定义

```
Free       — 0 credits/月, 注册送 100cr 体验
Basic      — $9.9/月, 1,200 credits（≈$0.008/cr）
Pro        — $19.9/月, 3,000 credits（≈$0.007/cr）
Business   — $49.9/月, 10,000 credits（≈$0.005/cr）
```

对比现有一次性购买（$0.008~$0.01/cr），订阅用户拿到更好的单价，形成订阅动力。

### 订阅 ↔ Credit 关系

```
订阅续费成功 → 自动往 credit_balances 充入月度额度
用户继续通过 credit 消费（和现在完全一样）
月度额度用完 → 可以按现有方式额外购买 credit（加油包）
```

### 需要新增的东西

**数据库：**

- `subscription_plans` — 计划定义（name, stripe_price_id, monthly_credits, price_usd）
- `user_subscriptions` — 用户订阅状态（plan_id, stripe_subscription_id, status, current_period_start/end, credits_granted_at）

**Stripe：**

- 从 `checkout.session.completed`（一次性）扩展到 `invoice.paid`（周期性续费触发充值）
- `customer.subscription.updated` / `deleted`（处理升降级、取消）

**逻辑：**

- Webhook 收到 `invoice.paid` → 查 subscription → 充入对应 credits
- `credits_granted_at` 防重复充值（同一周期只充一次）

### 可选的订阅权益（不仅仅是 Credit）

| 权益 | Free | Basic | Pro | Business |
|------|------|-------|-----|----------|
| 月度 Credits | 100(一次性) | 1,200 | 3,000 | 10,000 |
| 额外购买折扣 | 无 | 5% | 10% | 20% |
| 并发请求 | 1 | 3 | 5 | 10 |
| 优先模型 | - | - | Opus | Opus |
| API Key 数 | 1 | 3 | 10 | 无限 |

### Credit 过期策略（需要讨论）

- **A. 不过期** — 简单，用户友好，但可能导致囤积
- **B. 订阅 Credit 月底过期，购买的不过期** — 需要区分两种 Credit 来源，复杂度高
- **C. 订阅 Credit 可累积但有上限**（如 3 个月额度） — 平衡方案

---

## 实现优先级建议

### Phase 1：Token 追踪 + App 内计费（不涉及订阅）

1. `billing/token-rates.ts` — 模型 token 价格表
2. `billing/credits.ts` — 新增 `deductByTokens(userId, model, inputTokens, outputTokens)`
3. `agent.ts` — Agent 对话结束读 `usage`，调 `deductByTokens`
4. `gemini.ts` — Tips / 生图结束读 `usage`，调 `deductByTokens`
5. App 内所有 AI 调用接入 credit 扣减（目前全免费）
6. `usage_logs` 新增 `input_tokens` + `output_tokens` 列

### Phase 2：订阅

1. Stripe 创建 Product + Price（月付）
2. `subscription_plans` + `user_subscriptions` 表
3. Webhook 处理 `invoice.paid` → 充值 credits
4. Dashboard 增加订阅管理 UI

### Phase 3：完善

1. 年付折扣
2. 升降级 proration
3. 用量报表 / 消费明细页

---

## 已确认的决定

1. **markup 倍率** → 2x
2. **订阅档位** → $9.9 / $19.9 / $49.9（Basic / Pro / Business）
3. **Credit 过期** → 不过期（方案 A）
4. **一次性购买** → 保留，作为"加油包"与订阅共存，用户可独立购买 credit
5. **免费层** → 新用户赠送体验 credit
6. **年付折扣** → 做
7. **App 内计费** → 是的，App 内用户全部接入计费（Tips、Agent、生图、视频等）。这是订阅功能的核心目标
8. **ComfyUI 成本** → 按次收费，后台可配
9. **Meshy / Foldin** → 不考虑，不纳入计费范围
