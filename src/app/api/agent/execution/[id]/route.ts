import { after, NextRequest, NextResponse } from 'next/server';
import { runAgentExecutionAttempt } from '@/lib/agent-execution-runner';
import { verifyAgentExecutionDispatchToken } from '@/lib/agent-execution-dispatch';

export const maxDuration = 1800;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  if (!verifyAgentExecutionDispatchToken(runId, req.headers.get('x-agent-execution-token'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  after(async () => {
    try {
      await runAgentExecutionAttempt(runId);
    } catch (error) {
      console.error(`[agent-execution] dispatched attempt failed for ${runId}:`, error);
    }
  });
  return NextResponse.json({ runId, scheduled: true }, { status: 202 });
}
