import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { stopAgentRun } from '@/lib/agent-run-stop';

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req);
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    const { runId } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: 'runId required' }), { status: 400 });
    }

    // Only abort runs owned by this user that are still running
    await stopAgentRun(supabase, runId, userId);

    return new Response(JSON.stringify({ ok: true }));
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
