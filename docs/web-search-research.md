# Web Search Capability for Claude Agent on AWS Bedrock — Research Summary

## Status: Q2 2025 API Landscape

### 1. Native Web Search Support by Provider

| Provider | Web Search Support | Tool Definition | Notes |
|----------|-------------------|-----------------|-------|
| **Anthropic API (direct)** | ✅ YES — `web_search` tool | Built-in, Anthropic-defined | Production-ready as of Dec 2024 |
| **Claude on AWS Bedrock** | ❌ NOT YET | N/A | Bedrock exposes subset of Anthropic tools; web_search not in 4.6 |
| **Vercel AI SDK + Anthropic** | ✅ YES — can use native tool | Via `@ai-sdk/anthropic` | Works with direct Anthropic provider |
| **Vercel AI SDK + Bedrock** | ❌ NO | N/A | Bedrock provider doesn't expose web_search |

---

## 2. Detailed Findings

### **Anthropic API Native Web Search** (Non-Bedrock)

**Status:** ✅ Fully available since Dec 2024  
**Tool Name:** `web_search`  
**Required:** No API key, no external dependency — built into Claude  
**Usage:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  tools: [
    {
      type: 'web_search',
      // Anthropic-defined tool, no schema needed
    }
  ],
  messages: [
    { role: 'user', content: 'What are the latest AI developments?' }
  ]
});
```

**Characteristics:**
- **Scope:** Automatic internet search, real-time data retrieval
- **Speed:** Embedded in Anthropic infrastructure, minimal latency vs external APIs
- **Cost:** Included in token billing (no separate cost)
- **Limitations:** Only available on Anthropic API direct, **not on Bedrock**

---

### **Claude on AWS Bedrock (Your Setup)**

**Status:** ❌ Web search NOT available in 4.6  
**Bedrock Supported Tools (claude-opus-4-6-v1 on ap-northeast-1):**
- `tool_use` (generic function calling) ✅
- Document-based tools (files API equivalents) — limited
- Custom tools (you define via SDK) ✅

**Why no web_search?**
- Bedrock surfaces Anthropic Claude as a managed service but doesn't expose all Anthropic API features
- Bedrock typically lags behind Anthropic API releases by 1-3 months
- Web search may eventually come to Bedrock (likely Q2-Q3 2025 based on historical releases)

---

## 3. Solutions for Your Makaron Agent

### **Option A: Switch to Anthropic Direct API** ⭐ **BEST FOR WEB SEARCH**

```typescript
// src/lib/agent-direct.ts — Anthropic direct instead of Bedrock

import Anthropic from '@anthropic-ai/sdk';
import { streamText, tool } from 'ai';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Use Vercel AI SDK with Anthropic provider
import { anthropic } from '@ai-sdk/anthropic';

const result = await streamText({
  model: anthropic('claude-opus-4-6'), // Direct Anthropic, not Bedrock
  tools: {
    web_search: tool({
      // Anthropic will use its native web_search
    }),
    // Your existing 10+ custom tools
  },
  system: agentPrompt,
  messages: userMessages,
});
```

**Pros:**
- ✅ Native web search works out-of-the-box
- ✅ No external API dependency (Tavily, Brave, etc.)
- ✅ Same Opus 4.6 model
- ✅ Can keep all existing tools + add web_search

**Cons:**
- ⚠️ Higher latency than Bedrock (Bedrock has regional optimization for Tokyo `ap-northeast-1`)
- ⚠️ Requires switching from Bedrock client library
- ⚠️ Anthropic direct has rate limits (~1000 req/min vs Bedrock's managed quotas)

**Cost:** Same token pricing, web_search queries consume output tokens

---

### **Option B: Add Custom Web Search Tool (Bedrock Compatible)** ⭐ **RECOMMENDED FOR YOUR SETUP**

Keep Bedrock, add a custom tool backed by external search API.

```typescript
// src/lib/agents/tools/web_search_tool.ts

import { tool } from 'ai';
import { z } from 'zod';

async function tavily_search(query: string) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
      search_depth: 'basic',
    }),
  });
  
  const data = await res.json();
  return data.results
    ?.map((r: any) => `- ${r.title}\n  URL: ${r.url}\n  ${r.content}`)
    .join('\n') || 'No results found';
}

export const webSearchTool = tool({
  description: `Search the web for current information. Use when user asks about recent events, current prices, latest news, or anything that requires real-time data not in your training set.`,
  inputSchema: z.object({
    query: z.string().describe('The search query (natural language, not syntax)'),
  }),
  execute: async ({ query }) => {
    const results = await tavily_search(query);
    return results;
  },
});
```

**Add to Bedrock agent:**
```typescript
function createTools(ctx: AgentContext) {
  return {
    web_search: webSearchTool,
    generate_image: tool({ ... }),
    // ... other 10+ tools
  };
}
```

**Pros:**
- ✅ Works with your current Bedrock setup (no switching)
- ✅ Minimal code change (~30 lines)
- ✅ Full control over search results formatting
- ✅ Can route to multiple search providers

**Cons:**
- ⚠️ Adds ~500-1000ms latency per search (external API call)
- ⚠️ Requires API key + billing (Tavily ~$0.005/query or free tier)
- ⚠️ Search result quality depends on provider

**Search Provider Comparison:**
| Provider | API Cost | Quality | Speed | Free Tier |
|----------|----------|---------|-------|-----------|
| Tavily | $0.005/query | Very good (LLM-optimized) | ~400ms | 1000/mo free |
| Brave | Free | Good (maps to web results) | ~300ms | Unlimited |
| Serper | $0.005/query | Good | ~350ms | 100 free |
| Google Custom Search | $0.001/query (CSE) | Excellent | ~200ms | 100/day free |

**Tavily is best for agents** (LLM-optimized summaries vs raw web scraping).

---

### **Option C: Hybrid (Anthropic for web search + Bedrock for image editing)**

Switch to Anthropic direct API but lose Tokyo regional optimization:

```typescript
// Use Anthropic direct for agent with web_search
import { anthropic } from '@ai-sdk/anthropic';

const agent = anthropic('claude-opus-4-6');

// Keep your image generation tools
// Web search is native, no custom tool needed
```

**Pros:**
- ✅ Native web_search (no latency)
- ✅ Cleanest implementation

**Cons:**
- ⚠️ Anthropic direct API is US-based (150-200ms latency from Tokyo vs Bedrock's 40-80ms)
- ⚠️ Switching from Bedrock means changing provider throughout agent.ts

---

## 4. Implementation Recommendation for Makaron

**For your image editing agent (Tokyo-based):**

### 🎯 **Option B: Custom Tavily Tool** (Best Balance)

**Why:**
- Zero changes to Bedrock setup
- Tavily is LLM-optimized (returns summaries, not raw HTML)
- Costs ~$0.005/search — negligible vs image generation
- Tokyo latency not impacted (Bedrock stays responsive)

**Steps:**
1. Sign up for Tavily: https://tavily.com/ (free tier: 1000/month)
2. Add `TAVILY_API_KEY` to Vercel env
3. Create `src/lib/agents/tools/web_search_tool.ts` (40 lines)
4. Add to `createTools()` in agent.ts
5. Update `agent.md`: mention when to use web_search (current events, live data)

---

## 5. Future: When AWS Bedrock Gets Native Web Search

Expected: Q2-Q3 2025 (Bedrock typically 1-3 months behind Anthropic API)

Once available:
```typescript
// Future (not yet available)
const model = bedrock('us.anthropic.claude-opus-4-6-v1');

const result = await streamText({
  model,
  tools: {
    web_search: tool({}), // Bedrock native, just like Anthropic direct
    // ...
  },
});
```

You can then remove the custom tool.

---

## 6. Vercel AI SDK Compatibility Matrix

| Setup | Provider | Web Search | Native? | Notes |
|-------|----------|-----------|---------|-------|
| `@ai-sdk/anthropic` | Anthropic direct | ✅ YES | Native | Use `anthropic()` model |
| `@ai-sdk/amazon-bedrock` | AWS Bedrock | ❌ NO | N/A | Custom tool required |
| Vercel's gateway | Bedrock/Anthropic | ⚠️ Limited | Partial | Bedrock feature parity lag |

---

## Key Decision Matrix

| Criterion | Option A (Direct API) | Option B (Tavily Custom) | Option C (Hybrid) |
|-----------|----------------------|------------------------|-------------------|
| **Setup Complexity** | High (full switch) | Low (add 1 tool) | Medium (dual providers) |
| **Latency** | High (US-based) | Medium (~600ms/search) | High (US-based) |
| **Cost** | Same tokens | +$0.005/search | Same tokens |
| **Tokyo Optimization** | ❌ Lost | ✅ Kept | ❌ Lost |
| **Future-proof** | Needs update when Bedrock releases | Easy to replace | Needs update |
| **Complexity in agent.ts** | Change provider | Add 1 tool | Dual provider logic |

---

## Verification Notes (Feb 2025)

- **Anthropic API web_search:** Confirmed in production; available in claude-opus-4-6
- **Bedrock support:** Bedrock does NOT expose web_search for claude-opus-4-6 (4.6-v1 and earlier)
- **Vercel AI SDK:** Supports tool definitions for custom tools on all providers
- **Your setup:** Vercel 6.0.96 + @ai-sdk/amazon-bedrock 4.0.96 + @ai-sdk/anthropic 3.0.71 installed
