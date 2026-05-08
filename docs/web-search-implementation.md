# Web Search Implementation Guide (Option B: Tavily Custom Tool)

This guide walks through adding web search to your Makaron Agent via Tavily.

## Step 1: Tavily API Setup

1. Sign up at https://tavily.com
2. Get your API key from dashboard (free tier: 1000 searches/month)
3. Add to Vercel environment:
   ```bash
   npx vercel env add TAVILY_API_KEY
   # Paste your API key when prompted
   # Mark as: Preview + Production
   ```

## Step 2: Create Web Search Tool

Create `src/lib/agents/tools/web_search_tool.ts`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

/**
 * Tavily API search — returns LLM-optimized summaries
 */
async function tavily_search(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not configured');
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: 'basic',
        include_answer: true,
        // topic: 'general', // Can be 'general' or 'news'
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = await response.json();

    // Format results for Claude
    let formatted = '';
    if (data.answer) {
      formatted += `Summary: ${data.answer}\n\n`;
    }

    if (data.results && Array.isArray(data.results)) {
      formatted += 'Sources:\n';
      data.results.forEach((result: any, i: number) => {
        formatted += `${i + 1}. ${result.title}\n`;
        formatted += `   URL: ${result.url}\n`;
        formatted += `   ${result.content}\n\n`;
      });
    }

    return formatted || 'No results found';
  } catch (error) {
    console.error('[web_search] Error:', error);
    throw error;
  }
}

/**
 * Web search tool for Makaron Agent
 * Use when user asks about recent events, current info, or live data
 */
export const webSearchTool = tool({
  description:
    'Search the internet for current information. Use this when the user asks about recent events, current prices, latest news, or any information that requires real-time data beyond your training set. The results include both a summary and detailed sources.',
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'The search query (natural language). Examples: "latest AI models 2025", "current weather in Tokyo", "Apple iPhone 16 price"'
      ),
  }),
  execute: async ({ query }) => {
    console.log(`[web_search] Query: "${query}"`);
    const results = await tavily_search(query);
    return results;
  },
});
```

## Step 3: Add Tool to Agent

In `src/lib/agent.ts`, import and add the tool:

```typescript
// At the top with other imports
import { webSearchTool } from './agents/tools/web_search_tool';

// Inside createTools() function, add it to the returned object:
function createTools(ctx: AgentContext) {
  return {
    web_search: webSearchTool,
    generate_image: tool({
      // ... existing implementation
    }),
    // ... other tools
  };
}
```

## Step 4: Update Agent System Prompt

In `src/lib/prompts/agent.md`, add web search guidance:

```markdown
## Tools

- **analyze_image** — See the current photo with your own vision.
- **web_search** — Search for current information (real-time events, prices, news). Use when the user mentions "latest", "current", "recent", or asks about time-sensitive data.
- **preview_frame** — Capture a screenshot of your design.
- **generate_image** — Edit the photo. See tool description for details.
- **rotate_camera** — Rotate the virtual camera.

[... rest of tools ...]
```

## Step 5: Testing

### Local Test

Create `src/lib/agents/test-web_search.ts`:

```typescript
import { webSearchTool } from './tools/web_search_tool';

// Run: npx ts-node src/lib/agents/test-web_search.ts
async function test() {
  try {
    const result = await webSearchTool.execute({ query: 'Claude 3.5 Sonnet release date' });
    console.log('Search result:');
    console.log(result);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
```

```bash
TAVILY_API_KEY=your_key_here npx ts-node src/lib/agents/test-web_search.ts
```

### In Agent

Ask agent: "What are the latest Claude model releases?" and it will search.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `TAVILY_API_KEY not configured` | Check Vercel env vars. Redeploy after adding. |
| `401 Unauthorized` | API key is invalid — regenerate from Tavily dashboard |
| No results | Query might be too specific; try more general terms |
| Slow response (>2s) | Normal for web search; Tavily takes 400-600ms |

## Cost Analysis

- **Free tier:** 1000 searches/month
- **Paid:** $0.005 per search after free tier
- **Your usage:** If users ask 10 searches/month on average → negligible cost
- **Billing:** Separate from Makaron's token billing; check Tavily dashboard monthly

## Future: Switch to Native (When Bedrock Supports)

When AWS Bedrock adds native web_search (Q2-Q3 2025):

```typescript
// Replace webSearchTool with native Anthropic tool
function createTools(ctx: AgentContext) {
  return {
    web_search: tool({}), // Bedrock native, no implementation needed
    // ... rest unchanged
  };
}
```

Just delete `web_search_tool.ts` — no other changes needed.

---

## Alternative Providers (If Tavily Doesn't Work)

### Brave Search (Free)

```typescript
async function brave_search(query: string): Promise<string> {
  const response = await fetch('https://api.search.brave.com/res/v1/web/search', {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': process.env.BRAVE_API_KEY!,
    },
    body: new URLSearchParams({ q: query }).toString(),
  });
  // ... format results
}
```

**Setup:** Sign up https://api.search.brave.com, get key, free tier unlimited

### Serper (Paid)

```typescript
async function serper_search(query: string): Promise<string> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
  });
  // ... format results
}
```

**Setup:** Sign up https://serper.dev, $5 credit to start, $0.005 per query

## Edge Cases & Best Practices

1. **Rate limiting:** Don't let same user spam searches — add 1s debounce in agent.ts
2. **Cost control:** Set max 5 searches per conversation
3. **Relevance:** Tavily auto-filters to top results; you don't need post-processing
4. **Privacy:** Tavily doesn't log search queries by default (check their privacy policy)

