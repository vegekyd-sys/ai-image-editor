/** Execution ownership, independent of the video model selected by the Agent. */
const PRODUCTION_ORIGINS = ['https://www.makaron.app', 'https://makaron.app'];

export function normalizeAgentExecutionOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return PRODUCTION_ORIGINS.includes(url.origin) ? PRODUCTION_ORIGINS[0] : url.origin;
  } catch { return null; }
}

export function canRunAgentExecution(taskOrigin: string | null | undefined, workerOrigin: string | null | undefined): boolean {
  const worker = normalizeAgentExecutionOrigin(workerOrigin);
  if (!worker) return false;
  // Only pre-origin production tasks retain legacy recovery behavior.
  if (!taskOrigin) return worker === PRODUCTION_ORIGINS[0];
  return normalizeAgentExecutionOrigin(taskOrigin) === worker;
}

/** PostgREST OR operands; callers combine these with the due/expired condition. */
export function agentExecutionOriginFilter(workerOrigin: string): string {
  const origin = normalizeAgentExecutionOrigin(workerOrigin);
  if (!origin) throw new Error('A valid worker origin is required');
  const path = 'metadata->executionRequest->>origin';
  const origins = origin === PRODUCTION_ORIGINS[0] ? PRODUCTION_ORIGINS : [origin];
  const filters = origins.map(value => `${path}.eq.${JSON.stringify(value)}`);
  if (origin === PRODUCTION_ORIGINS[0]) filters.push(`${path}.is.null`, `${path}.eq.""`);
  return filters.join(',');
}
