import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { runId } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: 'runId required' }), { status: 400 });
    }

    // Only abort runs owned by this user that are still running
    const { error } = await supabase
      .from('agent_runs')
      .update({ status: 'aborted', ended_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('user_id', user.id)
      .eq('status', 'running');

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }));
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
