import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Where a billable request originated. Stored in usage_logs.source.
 * - app: browser session (Editor / Dashboard)
 * - cli: makaron-cli (identified by the X-Makaron-Client header)
 * - api: raw API key caller that is not the CLI (OpenClaw, scripts)
 * - mcp: MCP tool call through /api/mcp
 */
export type BillingSource = 'app' | 'cli' | 'api' | 'mcp'

export interface BillingAttribution {
  /** agent_runs.id that owns this charge. */
  runId?: string | null
  /** projects.id the charge belongs to. */
  projectId?: string | null
  source?: BillingSource
  /** api_keys.id used for the request, when authenticated with mk_live_… */
  apiKeyId?: string | null
}

export const MAKARON_CLIENT_HEADER = 'x-makaron-client'

const storage = new AsyncLocalStorage<BillingAttribution>()

/**
 * Run `fn` with `attribution` visible to every credit debit/refund performed
 * inside it (including fire-and-forget `import().then()` billing calls).
 */
export function runWithBillingAttribution<T>(attribution: BillingAttribution, fn: () => T): T {
  return storage.run({ ...currentBillingAttribution(), ...compact(attribution) }, fn)
}

/**
 * Attach `attribution` to the remainder of the current async execution
 * (the rest of the calling function and everything it awaits or spawns).
 * Use inside long-lived request handlers where wrapping is impractical.
 */
export function enterBillingAttribution(attribution: BillingAttribution): void {
  storage.enterWith({ ...currentBillingAttribution(), ...compact(attribution) })
}

export function currentBillingAttribution(): BillingAttribution | undefined {
  return storage.getStore()
}

/** Explicit values win over the ambient async context. */
export function resolveBillingAttribution(explicit?: BillingAttribution | null): BillingAttribution {
  return { ...currentBillingAttribution(), ...compact(explicit ?? {}) }
}

function compact(attribution: BillingAttribution): BillingAttribution {
  const out: BillingAttribution = {}
  if (attribution.runId != null) out.runId = attribution.runId
  if (attribution.projectId != null) out.projectId = attribution.projectId
  if (attribution.source != null) out.source = attribution.source
  if (attribution.apiKeyId != null) out.apiKeyId = attribution.apiKeyId
  return out
}

/**
 * Classify an incoming request. The CLI announces itself with
 * `X-Makaron-Client: makaron-cli/<version>`; any other API-key caller is `api`;
 * a browser session is `app`.
 */
export function resolveRequestBillingSource(
  req: { headers: { get(name: string): string | null } },
  auth: { apiKeyId?: string | null },
): BillingSource {
  const client = req.headers.get(MAKARON_CLIENT_HEADER)?.trim().toLowerCase() ?? ''
  if (client.startsWith('makaron-cli')) return 'cli'
  return auth.apiKeyId ? 'api' : 'app'
}

/** Read the attribution persisted in agent_runs.metadata.billing. */
export function billingAttributionFromRunMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallback: { runId: string; projectId?: string | null },
): BillingAttribution {
  const billing = metadata && typeof metadata.billing === 'object' && metadata.billing
    ? metadata.billing as Record<string, unknown>
    : {}
  const source = billing.source
  return {
    runId: fallback.runId,
    projectId: fallback.projectId ?? null,
    source: source === 'app' || source === 'cli' || source === 'api' || source === 'mcp' ? source : undefined,
    apiKeyId: typeof billing.apiKeyId === 'string' ? billing.apiKeyId : null,
  }
}
