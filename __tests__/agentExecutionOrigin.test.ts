import { describe, expect, it } from 'vitest';
import { agentExecutionOriginFilter, agentExecutionRecoveryFilter, canRunAgentExecution, normalizeAgentExecutionOrigin, resolveAgentExecutionWorkerOrigin } from '@/lib/agent-execution-origin';

describe('Agent execution origin ownership', () => {
  it('recovers public-domain tasks when production cron arrives on its deployment host', () => {
    const origin = resolveAgentExecutionWorkerOrigin('https://current.vercel.app', {
      VERCEL_ENV: 'production', VERCEL_URL: 'current.vercel.app',
    });
    expect(origin).toBe('https://www.makaron.app');
    expect(canRunAgentExecution('https://www.makaron.app', origin)).toBe(true);
    expect(agentExecutionOriginFilter(origin!)).toContain('origin.is.null');
  });
  it('never promotes Preview or unrelated deployment origins to production', () => {
    expect(resolveAgentExecutionWorkerOrigin('https://current.vercel.app', {
      VERCEL_ENV: 'preview', VERCEL_URL: 'current.vercel.app',
    })).toBe('https://current.vercel.app');
    expect(resolveAgentExecutionWorkerOrigin('https://other.vercel.app', {
      VERCEL_ENV: 'production', VERCEL_URL: 'current.vercel.app',
    })).toBe('https://other.vercel.app');
    expect(resolveAgentExecutionWorkerOrigin('http://localhost:3000', {
      VERCEL_ENV: 'production', VERCEL_URL: 'current.vercel.app',
    })).toBe('http://localhost:3000');
  });
  it('keeps local and each Preview separate from production and one another', () => {
    const origins = ['http://localhost:3000', 'http://localhost:4395', 'https://preview-a.vercel.app', 'https://preview-b.vercel.app', 'https://www.makaron.app'];
    for (const task of origins) for (const worker of origins) expect(canRunAgentExecution(task, worker), `${task} on ${worker}`).toBe(task === worker);
  });
  it('allows the two production aliases and legacy production tasks', () => {
    expect(canRunAgentExecution('https://makaron.app', 'https://www.makaron.app')).toBe(true);
    expect(canRunAgentExecution('https://www.makaron.app', 'https://makaron.app')).toBe(true);
    expect(canRunAgentExecution(undefined, 'https://www.makaron.app')).toBe(true);
    expect(canRunAgentExecution(undefined, 'http://localhost:3000')).toBe(false);
  });
  it('fails closed without worker identity and rejects malformed origins', () => {
    expect(canRunAgentExecution('http://localhost:3000', undefined)).toBe(false);
    expect(canRunAgentExecution('garbage', 'https://www.makaron.app')).toBe(false);
    expect(normalizeAgentExecutionOrigin('file:///tmp')).toBeNull();
    expect(normalizeAgentExecutionOrigin('https://user:pass@example.com')).toBeNull();
    expect(normalizeAgentExecutionOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
  });
  it('filters candidates before pagination, including legacy tasks only for production', () => {
    expect(agentExecutionOriginFilter('http://localhost:3000')).toBe('metadata->executionRequest->>origin.eq."http://localhost:3000"');
    expect(agentExecutionOriginFilter('https://makaron.app')).toContain('origin.is.null');
    expect(agentExecutionOriginFilter('https://preview-a.vercel.app')).not.toContain('is.null');
    expect(() => agentExecutionOriginFilter('bad')).toThrow();
  });
  it('only automatically recovers recently interrupted work, before queue pagination', () => {
    const filter = agentExecutionRecoveryFilter('https://www.makaron.app', new Date('2026-10-10T12:00:00Z'));
    expect(filter).toContain('or(next_attempt_at.lte.2026-10-10T12:00:00.000Z,lease_expires_at.lte.2026-10-10T12:00:00.000Z)');
    expect(filter).toContain('or(next_attempt_at.gte.2026-10-09T12:00:00.000Z,lease_expires_at.gte.2026-10-09T12:00:00.000Z)');
    expect(filter).toContain('origin.eq."https://www.makaron.app"');
    expect(agentExecutionRecoveryFilter('https://preview-a.vercel.app')).not.toContain('origin.is.null');
  });
});
