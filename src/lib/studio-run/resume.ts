import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudioRun } from './contracts';
import type { StudioRunStore } from './workspace-store';

/** Checked against the trusted user turn, never a model-supplied tool flag. */
export function isStudioResumeRequest(prompt: string): boolean {
  if (/(?:从零|從零|重新(?:建立|创建)|不要.{0,12}(?:接管|继续|繼續|恢复|恢復)|不接管|from scratch|do not (?:resume|continue)|new studio)/i.test(prompt)) return false;
  return /^(?:(?:请|請|please)\s*)?(?:继续|繼續|接着|接著|恢复|恢復|重试|重試|续上|續上|确认|確認|批准|同意|続けて|再開|承認|continue\b|resume\b|retry\b|confirm(?:o|ed)?\b|approv(?:e|ed)\b|ok\b|yes\b)/i.test(prompt.trim());
}

export async function resumePersistedStudioRun(input: {
  store: StudioRunStore; supabase: SupabaseClient; run: StudioRun;
  agentRunId: string; projectId: string; userId: string; authorized: boolean;
}): Promise<StudioRun> {
  const { run } = input;
  if (run.projectId !== input.projectId) throw new Error('Studio resume project mismatch');
  if (run.agentRunId === input.agentRunId) return run;
  if (!input.authorized || !run.agentRunId) throw new Error('Studio resume requires an explicit user continuation request');
  const { data, error } = await input.supabase.from('agent_runs')
    .select('id,project_id,user_id,status').in('id',[run.agentRunId,input.agentRunId]);
  const previous = data?.find(row => row.id === run.agentRunId);
  const current = data?.find(row => row.id === input.agentRunId);
  if (error || !previous || !current
    || [previous,current].some(row => row.project_id !== input.projectId || row.user_id !== input.userId)
    || !['completed','failed','aborted'].includes(previous.status) || current.status !== 'running') {
    throw new Error('Studio resume requires the same owner and project, and a stopped previous Agent Run');
  }
  const { data: active, error: activeError } = await input.supabase.from('agent_runs')
    .select('id').eq('project_id',input.projectId).eq('user_id',input.userId).eq('status','running');
  if (activeError || active?.length !== 1 || active[0].id !== input.agentRunId) {
    throw new Error('Studio resume cannot overlap another active Agent Run');
  }
  // Reload before writing: keep every artifact version and previous approval.
  const latest = await input.store.loadRun(input.projectId,run.id);
  if (!latest || latest.agentRunId !== run.agentRunId) throw new Error('Studio ownership changed before resume');
  const now = new Date().toISOString();
  const next: StudioRun = {
    ...latest, agentRunId: input.agentRunId, updatedAt: now,
    decisions: [...latest.decisions, {id:crypto.randomUUID(),category:'selection',stage:latest.currentStage || 'delivery',summary:`Resumed from Agent Run ${latest.agentRunId} by ${input.agentRunId}`,automatic:false,createdAt:now}],
  };
  await input.store.saveRun(next);
  return next;
}
