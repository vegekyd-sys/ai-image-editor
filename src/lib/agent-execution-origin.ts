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

/** Vercel invokes production cron routes on the immutable deployment host. */
export function resolveAgentExecutionWorkerOrigin(
  value?: string | null,
  env: { VERCEL_ENV?: string; VERCEL_URL?: string } = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
  },
): string | null {
  const origin = normalizeAgentExecutionOrigin(value);
  const deployment = env.VERCEL_URL
    ? normalizeAgentExecutionOrigin(`https://${env.VERCEL_URL}`)
    : null;
  if (env.VERCEL_ENV === 'production' && origin && origin === deployment) {
    return PRODUCTION_ORIGINS[0];
  }
  return origin;
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

/** Automatic recovery must not wake abandoned jobs from weeks-old queues. */
export function agentExecutionRecoveryFilter(workerOrigin: string, now = new Date()): string {
  const at = now.toISOString();
  const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return `and(or(next_attempt_at.lte.${at},lease_expires_at.lte.${at}),or(next_attempt_at.gte.${recent},lease_expires_at.gte.${recent}),or(${agentExecutionOriginFilter(workerOrigin)}))`;
}
