import type { SupabaseClient } from '@supabase/supabase-js';

export async function stopAgentRun(supabase: SupabaseClient, runId: string, userId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('agent_runs').update({
    status:'aborted',ended_at:now,current_work_unit:'aborted',
    lease_token:null,lease_owner:null,lease_expires_at:null,next_attempt_at:null,
  }).eq('id',runId).eq('user_id',userId).eq('status','running').select('id').maybeSingle();
  if (error) throw new Error(`Failed to stop Agent Run: ${error.message}`);
  if (!data) {
    // Retry cleanup after a partial failure, without touching completed runs
    // or a run owned by someone else.
    const { data: stopped, error: readError } = await supabase.from('agent_runs')
      .select('id').eq('id', runId).eq('user_id', userId).eq('status', 'aborted').maybeSingle();
    if (readError) throw new Error(`Failed to verify stopped Agent Run: ${readError.message}`);
    if (!stopped) return false;
  }
  const { error: attemptError } = await supabase.from('agent_attempts').update({
    status:'aborted',ended_at:now,terminal_code:'user_aborted',
  }).eq('run_id',runId).eq('user_id',userId).eq('status','running');
  if (attemptError) throw new Error(`Agent Run stopped, but attempt cleanup failed: ${attemptError.message}`);
  return true;
}
