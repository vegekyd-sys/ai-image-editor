/**
 * Owner-funded OpenAI API key (monthly prepaid budget, ~$200).
 *
 * GPT Agent models and GPT Image 2.6 use this key first while the current UTC
 * month is under budget, then fall back to the existing providers (Azure /
 * OpenRouter for Agent models, fal for images). OpenAI does not expose the
 * remaining credit to a project key (no api.usage.read scope), so Makaron keeps
 * its own supplier-cost ledger in `openai_direct_spend` and also treats an
 * OpenAI quota refusal as "exhausted for this month".
 *
 * Users are billed exactly as before: credits come from the same token rates
 * and markup. This module only decides which supplier pays.
 */
import { getSupabaseAdmin } from '@/lib/supabase/service';
import {
  addOpenAIDirectPendingSpend,
  getCachedOpenAIDirectState,
  isOpenAIDirectConfigured,
  isOpenAIQuotaExhausted,
  openAIDirectMonth,
  setCachedOpenAIDirectState,
  type OpenAIDirectMonthState,
} from './openai-direct-state';

export * from './openai-direct-state';

export const OPENAI_DIRECT_PROVIDER = 'openai' as const;
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

/** Supplier list prices (USD per 1M tokens) for GPT Image 2.6 on the OpenAI API. */
export const OPENAI_IMAGE26_PRICES = { textInput: 5, imageInput: 8, imageOutput: 30 } as const;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAIDirectSpend {
  kind: 'agent' | 'image';
  model: string;
  usd: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  detail?: string;
}

const STATE_TTL_MS = 30_000;
let inflightRefresh: Promise<OpenAIDirectMonthState | null> | null = null;

/** Refresh the month ledger state; cheap when fresh. Never throws. */
export async function refreshOpenAIDirectBudget(force = false): Promise<OpenAIDirectMonthState | null> {
  if (!isOpenAIDirectConfigured()) return null;
  const month = openAIDirectMonth();
  const current = getCachedOpenAIDirectState();
  if (!force && current?.month === month && Date.now() - current.fetchedAt < STATE_TTL_MS) return current;
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const { data, error } = await getSupabaseAdmin().rpc('openai_direct_month_state', { p_month: month });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const next: OpenAIDirectMonthState = {
        month,
        spentUsd: Number(row?.spent_usd ?? 0),
        exhausted: Boolean(row?.exhausted),
        calls: Number(row?.calls ?? 0),
        fetchedAt: Date.now(),
      };
      setCachedOpenAIDirectState(next, 0);
      return next;
    } catch (error) {
      console.warn(`[openai-direct] budget state unavailable; routing to fallback providers: ${error instanceof Error ? error.message : String(error)}`);
      const stale = getCachedOpenAIDirectState();
      if (stale && stale.month !== month) setCachedOpenAIDirectState(null, 0);
      return getCachedOpenAIDirectState();
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export async function recordOpenAIDirectSpend(spend: OpenAIDirectSpend): Promise<void> {
  const usd = Number.isFinite(spend.usd) && spend.usd > 0 ? Math.round(spend.usd * 1e6) / 1e6 : 0;
  addOpenAIDirectPendingSpend(usd);
  try {
    const { error } = await getSupabaseAdmin().from('openai_direct_spend').insert({
      month: openAIDirectMonth(),
      kind: spend.kind,
      model: spend.model.slice(0, 120),
      usd,
      input_tokens: Math.max(0, Math.round(spend.inputTokens ?? 0)),
      cached_input_tokens: Math.max(0, Math.round(spend.cachedInputTokens ?? 0)),
      output_tokens: Math.max(0, Math.round(spend.outputTokens ?? 0)),
      request_id: spend.requestId?.slice(0, 200) ?? null,
      detail: spend.detail?.slice(0, 500) ?? null,
    });
    if (error) throw error;
  } catch (error) {
    console.warn(`[openai-direct] spend ledger write failed (usd=${usd}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function markOpenAIDirectExhausted(detail: string): Promise<void> {
  const current = getCachedOpenAIDirectState();
  const month = openAIDirectMonth();
  if (current?.month === month && current.exhausted) return;
  setCachedOpenAIDirectState({ month, spentUsd: current?.spentUsd ?? 0, exhausted: true, calls: current?.calls ?? 0, fetchedAt: Date.now() });
  console.warn(`[openai-direct] quota exhausted for ${month}; routing to fallback providers`);
  try {
    const { error } = await getSupabaseAdmin().from('openai_direct_spend').insert({
      month, kind: 'quota_exhausted', model: 'openai', usd: 0, detail: detail.slice(0, 500),
    });
    if (error) throw error;
  } catch (error) {
    console.warn(`[openai-direct] could not persist quota exhaustion: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface ResponsesUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
}

export interface TokenPrice {
  input_per_1m: number;
  output_per_1m: number;
  cache_read_per_1m?: number | null;
}

export function responsesUsageCostUsd(usage: ResponsesUsage, rate: TokenPrice): number {
  const input = Math.max(0, usage.input_tokens ?? 0);
  const cached = Math.min(input, Math.max(0, usage.input_tokens_details?.cached_tokens ?? 0));
  const output = Math.max(0, usage.output_tokens ?? 0);
  const cacheRate = rate.cache_read_per_1m ?? rate.input_per_1m;
  return ((input - cached) * rate.input_per_1m + cached * cacheRate + output * rate.output_per_1m) / 1e6;
}

export interface ImagesUsage {
  input_tokens?: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
  output_tokens?: number;
}

/** GPT Image 2.6 supplier cost from the Images API usage block (SVG tracing is added separately). */
export function image26UsageCostUsd(usage: ImagesUsage | undefined): number {
  if (!usage) return 0;
  const imageIn = Math.max(0, usage.input_tokens_details?.image_tokens ?? 0);
  const textIn = Math.max(0, usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageIn));
  const out = Math.max(0, usage.output_tokens ?? 0);
  const p = OPENAI_IMAGE26_PRICES;
  return (textIn * p.textInput + imageIn * p.imageInput + out * p.imageOutput) / 1e6;
}

async function lookupRate(model: string): Promise<TokenPrice | null> {
  const { getTokenRate } = await import('@/lib/billing/token-rates');
  return getTokenRate(model.replace(/-\d{4}-\d{2}-\d{2}$/, ''));
}

async function recordResponsesUsage(model: string, usage: ResponsesUsage, requestId?: string): Promise<void> {
  const rate = await lookupRate(model).catch(() => null);
  if (!rate) {
    console.warn(`[openai-direct] no token rate for ${model}; recording zero-cost usage`);
  }
  await recordOpenAIDirectSpend({
    kind: 'agent',
    model,
    usd: rate ? responsesUsageCostUsd(usage, rate) : 0,
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens,
    outputTokens: usage.output_tokens,
    requestId,
  });
}

function requestModel(init?: RequestInit): string | undefined {
  if (typeof init?.body !== 'string') return undefined;
  try { return JSON.parse(init.body)?.model; } catch { return undefined; }
}

/** Scan an SSE Responses stream for the terminal usage without delaying the consumer. */
function tapStreamUsage(body: ReadableStream<Uint8Array>, onUsage: (usage: ResponsesUsage, id?: string) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let reported = false;
  const scan = (final: boolean) => {
    const events = buffer.split(/\n\n/);
    buffer = final ? '' : events.pop() ?? '';
    for (const event of events) {
      if (reported || !/response\.(?:completed|incomplete)/.test(event)) continue;
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
      try {
        const parsed = JSON.parse(data);
        const usage = parsed?.response?.usage;
        if (usage) { reported = true; onUsage(usage, parsed.response.id); }
      } catch { /* not a JSON data event */ }
    }
  };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 1_000_000) buffer = buffer.slice(-200_000);
      scan(false);
    },
    flush() { buffer += decoder.decode(); scan(true); },
  }));
}

/**
 * Fetch wrapper for the OpenAI Responses transport: records supplier cost from
 * the terminal usage event and marks the month exhausted on quota refusals.
 */
export function createOpenAIDirectFetch(fetchImpl: FetchLike = globalThis.fetch): FetchLike {
  return async (input, init) => {
    const model = requestModel(init) ?? 'unknown';
    const response = await fetchImpl(input, init);
    if (!response.ok) {
      const text = await response.clone().text().catch(() => '');
      if (isOpenAIQuotaExhausted(text)) void markOpenAIDirectExhausted(`${response.status} ${text.slice(0, 300)}`);
      return response;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && response.body) {
      const tapped = tapStreamUsage(response.body, (usage, id) => { void recordResponsesUsage(model, usage, id); });
      return new Response(tapped, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    if (contentType.includes('application/json')) {
      response.clone().json().then((data: { usage?: ResponsesUsage; id?: string }) => {
        if (data?.usage) void recordResponsesUsage(model, data.usage, data.id);
      }).catch(() => {});
    }
    return response;
  };
}
