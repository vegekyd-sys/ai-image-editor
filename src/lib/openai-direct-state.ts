/**
 * Client-safe routing state for the owner's direct OpenAI key. No server
 * imports: Agent model routing (also bundled in UI code) reads this cache;
 * `openai-direct.ts` refreshes it from the ledger on the server.
 */
export interface OpenAIDirectMonthState {
  month: string;
  spentUsd: number;
  exhausted: boolean;
  calls: number;
  fetchedAt: number;
}

const shared = globalThis as typeof globalThis & {
  __makaronOpenAIDirect?: { state: OpenAIDirectMonthState | null; pendingUsd: number };
};
function store() {
  shared.__makaronOpenAIDirect ??= { state: null, pendingUsd: 0 };
  return shared.__makaronOpenAIDirect;
}

export function openAIDirectMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function getOpenAIDirectApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

export function isOpenAIDirectConfigured(): boolean {
  return Boolean(getOpenAIDirectApiKey()) && process.env.OPENAI_DIRECT_ENABLED?.trim().toLowerCase() !== 'false';
}

function nonNegative(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return value?.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Monthly budget and the reserve kept for in-flight runs and price drift. */
export function getOpenAIDirectBudget(): { budgetUsd: number; reserveUsd: number; limitUsd: number } {
  const budgetUsd = nonNegative(process.env.OPENAI_MONTHLY_BUDGET_USD, 200);
  const reserveUsd = Math.min(budgetUsd, nonNegative(process.env.OPENAI_BUDGET_RESERVE_USD, 5));
  return { budgetUsd, reserveUsd, limitUsd: Math.max(0, budgetUsd - reserveUsd) };
}

/** Pure decision used by routing and tests. */
export function isOpenAIDirectBudgetAvailable(
  state: Pick<OpenAIDirectMonthState, 'month' | 'spentUsd' | 'exhausted'> | null,
  options: { configured?: boolean; month?: string; limitUsd?: number; pendingUsd?: number } = {},
): boolean {
  const configured = options.configured ?? isOpenAIDirectConfigured();
  if (!configured || !state) return false;
  if (state.month !== (options.month ?? openAIDirectMonth())) return false;
  if (state.exhausted) return false;
  const limit = options.limitUsd ?? getOpenAIDirectBudget().limitUsd;
  return state.spentUsd + (options.pendingUsd ?? 0) < limit;
}

/** Synchronous routing check. Unknown state (never refreshed / DB unavailable) routes elsewhere. */
export function isOpenAIDirectAvailable(): boolean {
  const s = store();
  return isOpenAIDirectBudgetAvailable(s.state, { pendingUsd: s.pendingUsd });
}

export function getCachedOpenAIDirectState(): OpenAIDirectMonthState | null {
  return store().state;
}

export function setCachedOpenAIDirectState(state: OpenAIDirectMonthState | null, pendingUsd = 0): void {
  const s = store();
  s.state = state;
  s.pendingUsd = pendingUsd;
}

export function addOpenAIDirectPendingSpend(usd: number): void {
  store().pendingUsd += usd;
}

/** Test hook. */
export function setOpenAIDirectStateForTests(state: OpenAIDirectMonthState | null): void {
  setCachedOpenAIDirectState(state, 0);
}

/** OpenAI refused usage because the key/org is out of credit or over its hard limit. */
export function isOpenAIQuotaExhausted(detail: unknown): boolean {
  if (typeof detail !== 'string' || !detail) return false;
  return /insufficient_quota|billing_hard_limit_reached|exceeded your current quota|billing_not_active|account_deactivated/i.test(detail);
}

/** Errors that should move this request to the fallback provider instead of failing the user. */
export function isOpenAIDirectFallbackError(detail: unknown): boolean {
  if (typeof detail !== 'string' || !detail) return false;
  return isOpenAIQuotaExhausted(detail)
    || /OPENAI_DIRECT_UNAVAILABLE|invalid_api_key|incorrect api key|\b(?:401|403|429|500|502|503|504)\b|rate.?limit|server_error|overloaded|ECONNRESET|fetch failed/i.test(detail);
}

