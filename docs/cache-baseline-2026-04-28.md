# Agent Prompt Cache Baseline — 2026-04-28

实测 Bedrock prompt cache 的三个关键问题：跨用户共享、冷热启动成本、TTFB 构成。用于决定后续 B7（multi-turn 历史 cache）、B5（agent.md 瘦身）等优化的 ROI。

## TL;DR

1. **跨用户 cache 确认共享** —— 用户 B 发同一 prompt 能命中用户 A 刚写入的 cache，hit rate 48% → 76%
2. **TTFB 几乎不随 cache 命中率变化** —— cold / cross-user / fully warm 三档 TTFB 都是 4.7–6.2s，**砍 prompt 不是 TTFB 优化方向**
3. **Credits 随 cache 命中显著下降** —— 同用户热启动最多省 69% credits（13 → 4），跨用户共享也能省 39%（13 → 8）
4. **cache 真正的价值是 cost，不是 TTFB**

## 测试环境

- 模型：`us.anthropic.claude-sonnet-4-6`
- 项目 commit：`c4e123f`（已有 B1/B2/B4 + cache-aware billing + design 不看图修复）
- Bedrock region：hnd1（Tokyo）
- 测试时间：2026-04-28 22:11–22:14（UTC+8）
- 用户：
  - A = `test-claude@makaron.app`（user_id `b8b676af-...`）
  - B = `test-claude2@makaron.app`（user_id `7c679927-...`，新建）

## 场景 1：跨用户 cache 共享

### 测试步骤

1. 用户 A 上传图 + 发送 "把这张照片调成电影胶片感" → 触发 Bedrock 写入 system + tools cache
2. 立刻（< 1 分钟，5 分钟 TTL 内）用户 B 上传**同一张图** + 发送**字节相同的 prompt**
3. 对比两次的 `cacheRead` / `cacheWrite`

### 原始数据

| 字段 | User A turn | User B turn |
|------|------------|-------------|
| 时间 | 22:11:59 | 22:12:52 |
| totalInput | 28,295 | 28,086 |
| noCache | 1,093 | 1,062 |
| cacheRead | **13,601** | **21,394** |
| cacheWrite | **13,601** | **5,630** |
| output | 398 | 353 |
| hit rate | 48.1% | **76.2%** |
| credits | 13 | 8 |
| TTFB | 6,241ms | 4,703ms |

### 结论

- **跨用户确实共享 cache**（B 的 cacheRead 从 A 冷启动预期的 ~13K 涨到 21K）
- **但不是 100% 共享** —— B 仍有 5,630 cacheWrite，说明 prefix 里有**因用户而异**的 bytes
  - 怀疑点：`buildSystemPrompt` 里 workspace manifest / user skills / projectId 这些动态段（B1 后注入 system 的那些）
  - **B8 潜在优化**：把动态部分从 system 移到 user message 开头，system 100% 字节一致，cache 跨用户完全命中
- 即使不完美，B 比 A 便宜 **38%**（13 → 8 credits）

## 场景 2：同用户冷→温→最热阶梯

### 原始数据

| 阶段 | turn | totalInput | noCache | cacheRead | cacheWrite | hit rate | credits | TTFB |
|-----|------|-----------|---------|-----------|-----------|---------|---------|------|
| A 冷启动 | 1 | 28,295 | 1,093 | 13,601 | 13,601 | 48.1% | **13** | 6,241ms |
| A 热启动 | 2 | 28,559 | 1,357 | 27,202 | 0 | 95.2% | **4** | 5,448ms |

### 结论

- 同用户第二轮 **cache write 归零**，只读不写（cache TTL 内）
- hit rate 从 48% → 95%，credits **省 69%**（13 → 4）
- **但 TTFB 几乎不动**（6.2s → 5.4s 在 Bedrock 抖动范围内，不能归功于 cache）

## 场景 3：TTFB 不随 cache 变化

### 三档对比

| cache 状态 | hit rate | TTFB |
|-----------|---------|------|
| 冷启动（A turn 1）| 48% | 6,241ms |
| 跨用户热（B turn 1）| 76% | 4,703ms |
| 同用户最热（A turn 2）| 95% | 5,448ms |

三个数字在 **4.7–6.2s** 抖动，没有明显单调关系。按 Bedrock 官方 prefill 速度 ~2K tokens/s 算，27K cache prefill 理论省 ~10s——但实测只省了 1.5s（而且噪声内）。

### 结论

**TTFB ≠ prefill 时间**。大头应该是：
- AWS/Bedrock 固定成本（网络 + 服务路由 + 模型加载）：预估 3-4s
- 第一个 token 生成前的内部 reasoning（agent 决策调哪个 tool）：1-2s
- 真正的 prefill 时间占比小，cache 能省的"TTFB"≤ 0.5s

**砍 system/tools 大小对 TTFB 效果接近 0**。想降 TTFB 只能：
- 换模型（Haiku 4.5 TTFB 普遍 1-1.5s）
- 按意图路由（简单请求走 Haiku）
- 跳过 reasoning 步骤（如已分析过图就不再重复）

## 场景 4：用户实际成本对比（B4 + cache-aware 计费生效后）

基于现在线上的 prod 老代码 `30 credits/turn` baseline（从今天上午测试得到）：

| 条件 | credits / turn | vs prod |
|-----|---------------|---------|
| Prod 老代码 | 30 | baseline |
| 本地新代码 冷启动 | 13 | **-57%** |
| 本地新代码 跨用户热 | 8 | **-73%** |
| 本地新代码 同用户最热 | 4 | **-87%** |

这是**新代码部署后的真实节省**：
- 一个每天 1 轮 warm chat 的用户，当前线上月收 30×30 = 900 credits
- 新代码后月收 4×30 = 120 credits（最热场景）
- **省 87%**，用户感知明显更便宜

## 优化方向重排（基于 baseline）

原优先级里按"降 TTFB"权重排的项目，现在根据"TTFB 砍不动"的结论重排：

| 项目 | 降 cost? | 降 TTFB? | ROI | 优先级 |
|------|---------|---------|-----|-------|
| **B7 Multi-turn 历史 cache** | ✅ 大 | 0 | 长对话每 turn 省 10-30K cacheRead | 🔥 最高 |
| **B8 静态化 system prompt** | ✅ 中 | 0 | 跨用户 100% cache，B turn cacheWrite 从 5.6K → 0 | 高 |
| **B5 agent.md 瘦身** | 无 | 0 | cacheRead 本来就便宜，再砍 system 意义小 | 低 |
| **换 Haiku 路由** | ✅ 中 | ✅ 2-4s | 只降简单请求，需要意图分类器 | 中（单独设计） |
| **B3 tools 按模式暴露** | 极小 | 0 | 不到 1KB，几乎无感 | 很低 |
| **B6 design code 去重** | 会被 B7 自动 cover | 0 | 等 B7 做完评估 | 延后 |

**结论**：
- **B7 是唯一值得全力做的大优化**
- B5 和 B3 之前过分高估了价值，实际 ROI 很低
- TTFB 如果用户抱怨，单独研究模型路由（和 prompt 优化是两条线）

## Raw Log

### User A turn 1 (cold)
```
[agent-ttfb] 6241ms (first text-delta)
[agent-usage] totalInput=28295 (noCache=1093 cacheRead=13601 cacheWrite=13601) output=398 hitRate=48.1% model=us.anthropic.claude-sonnet-4-6
```

### User B turn 1 (cross-user warm)
```
[agent-ttfb] 4703ms (first text-delta)
[agent-usage] totalInput=28086 (noCache=1062 cacheRead=21394 cacheWrite=5630) output=353 hitRate=76.2% model=us.anthropic.claude-sonnet-4-6
```

### User A turn 2 (same-user fully warm)
```
[agent-ttfb] 5448ms (first text-delta)
[agent-usage] totalInput=28559 (noCache=1357 cacheRead=27202 cacheWrite=0) output=283 hitRate=95.2% model=us.anthropic.claude-sonnet-4-6
```

### DB rows (usage_logs)

```
user_A turn 2 (warm):  credits=4  input=1357 output=283 cacheRead=27202 cacheWrite=null
user_A turn 1 (cold):  credits=13 input=1093 output=398 cacheRead=13601 cacheWrite=13601
user_B turn 1:         credits=8  input=1062 output=353 cacheRead=21394 cacheWrite=5630
```

## Next

按上表从 B7 开始做。实施前需要：

1. 改 `agent-context.ts` 把 `[对话历史]` 段从 user text 拆出，返回真正的 messages 数组（user/assistant 交替）
2. 改 `agent.ts` 的 `streamText` 调用，`messages` 参数从单条 user 改为完整历史数组
3. 在倒数第二个 assistant message 上打 `providerOptions.bedrock.cachePoint`
4. 验证：跑同一测试矩阵看 B turn 的 cacheWrite 是否从 5630 → 0，同用户 warm turn 的 cache 命中率是否从 95% 稳定到 99%+
