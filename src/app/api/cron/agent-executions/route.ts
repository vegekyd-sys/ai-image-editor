import { agentExecutionRecoveryFilter, resolveAgentExecutionWorkerOrigin } from '@/lib/agent-execution-origin';
import { after, NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { runAgentExecutionAttempt } from '@/lib/agent-execution-runner';

export const maxDuration = 1800;

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const origin = resolveAgentExecutionWorkerOrigin(req.nextUrl.origin);
  if (!origin) return NextResponse.json({ error: 'Invalid execution origin' }, { status: 500 });
  const now = new Date();
  const { data: runs, error } = await admin
    .from('agent_runs')
    .select('id')
    .eq('status', 'running')
    .or(agentExecutionRecoveryFilter(origin, now))
    .order('next_attempt_at', { ascending: true, nullsFirst: false })
    .limit(2);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const runIds = (runs || []).map(run => run.id as string);
  for (const runId of runIds) {
    after(async () => {
      try {
        await runAgentExecutionAttempt(runId, { admin, workerId: `cron-${crypto.randomUUID()}`, origin });
      } catch (attemptError) {
        console.error(`[cron/agent-executions] ${runId}:`, attemptError);
      }
    });
  }
  return NextResponse.json({ scheduled: runIds.length, runIds });
}
