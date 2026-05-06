import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';

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
    const { error } = await supabase
      .from('agent_runs')
      .update({ status: 'aborted', ended_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('user_id', userId)
      .eq('status', 'running');

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }));
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
