import { createHmac, timingSafeEqual } from 'node:crypto';

function dispatchSecret(): string {
  return (process.env.AGENT_EXECUTION_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

export function createAgentExecutionDispatchToken(runId: string): string {
  const secret = dispatchSecret();
  if (!secret) throw new Error('Agent execution dispatch secret is unavailable');
  return createHmac('sha256', secret).update(runId).digest('hex');
}

export function verifyAgentExecutionDispatchToken(runId: string, token: string | null): boolean {
  if (!token) return false;
  try {
    const expected = Buffer.from(createAgentExecutionDispatchToken(runId));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function dispatchAgentExecutionAttempt(runId: string, origin?: string): Promise<boolean> {
  if (!origin) return false;
  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/agent/execution/${runId}`, {
      method: 'POST',
      headers: { 'x-agent-execution-token': createAgentExecutionDispatchToken(runId) },
    });
    return response.ok;
  } catch (error) {
    console.warn(`[agent-execution] immediate dispatch failed for ${runId}; cron will retry`, error);
    return false;
  }
}
