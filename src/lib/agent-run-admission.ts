import type { SupabaseClient } from '@supabase/supabase-js';

export interface ActiveAgentRunAdmissionRecord {
  id: string;
  status: string;
  execution_policy?: Record<string, unknown> | null;
}

export type AgentRunAdmission =
  | { kind: 'create' }
  | { kind: 'append'; runId: string }
  | { kind: 'conflict'; runId: string };

export interface PendingAgentInput {
  id: string;
  content: string;
  created_at?: string;
}

export function decideAgentRunAdmission(
  activeRun: ActiveAgentRunAdmissionRecord | null | undefined,
): AgentRunAdmission {
  if (!activeRun || activeRun.status !== 'running') return { kind: 'create' };
  if (activeRun.execution_policy?.durable === true) {
    return { kind: 'append', runId: activeRun.id };
  }
  return { kind: 'conflict', runId: activeRun.id };
}

export function formatPendingAgentInputs(inputs: PendingAgentInput[]): string {
  if (!inputs.length) return '';
  return [
    '[New instructions received during this Agent Run]',
    ...inputs.map((input, index) => `${index + 1}. ${input.content.trim()}`),
    'Treat these as new inputs to the same objective and workflow invocation. The newest instruction has precedence when it changes or pauses an earlier delivery target. Preserve completed work and artifacts; do not start or adopt another Studio workflow.',
  ].join('\n');
}

export async function findActiveAgentRun(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<ActiveAgentRunAdmissionRecord | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, status, execution_policy')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to inspect active Agent Run: ${error.message}`);
  return data as ActiveAgentRunAdmissionRecord | null;
}

export async function appendAgentRunInput(input: {
  supabase: SupabaseClient;
  runId: string;
  projectId: string;
  userId: string;
  content: string;
  source: 'cli' | 'cui' | 'agent' | 'api';
}): Promise<string> {
  const { data, error } = await input.supabase.rpc('append_agent_run_input', {
    p_run_id: input.runId,
    p_project_id: input.projectId,
    p_user_id: input.userId,
    p_content: input.content,
    p_source: input.source,
  });
  if (error) throw new Error(`Failed to append Agent Run input: ${error.message}`);
  if (typeof data !== 'string' || !data) throw new Error('Failed to append Agent Run input: missing input id');
  return data;
}

export async function loadPendingAgentInputs(
  supabase: SupabaseClient,
  runId: string,
): Promise<PendingAgentInput[]> {
  const { data, error } = await supabase
    .from('agent_run_inputs')
    .select('id, content, created_at')
    .eq('run_id', runId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load Agent Run inputs: ${error.message}`);
  return (data || []) as PendingAgentInput[];
}

export async function markAgentRunInputsApplied(input: {
  supabase: SupabaseClient;
  runId: string;
  inputIds: string[];
  attemptId: string;
}): Promise<void> {
  if (!input.inputIds.length) return;
  const { error } = await input.supabase
    .from('agent_run_inputs')
    .update({
      status: 'applied',
      applied_attempt_id: input.attemptId,
      applied_at: new Date().toISOString(),
    })
    .eq('run_id', input.runId)
    .eq('status', 'pending')
    .in('id', input.inputIds);
  if (error) throw new Error(`Failed to mark Agent Run inputs applied: ${error.message}`);
}
