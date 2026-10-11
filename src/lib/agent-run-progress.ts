export interface RunProgressInput {
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  lastActivityAt?: string | null;
  terminalCode?: string;
  outputs?: Array<{ type?: string; status?: string; url?: unknown }>;
  now?: number;
}

/** Additive reporting: Agent completion and media delivery are distinct. */
export function deriveAgentRunProgress(input: RunProgressInput) {
  const now = input.now ?? Date.now();
  const outputs = input.outputs ?? [];
  const studio = outputs.filter(item => item.type === 'studio_run').at(-1);
  const media = outputs.filter(item => ['video','music','image','design'].includes(item.type || ''));
  const deliveryStatus = media.some(item => ['queued','rendering','processing','pending'].includes(item.status || ''))
    ? 'rendering'
    : media.some(item => item.status === 'failed') ? 'failed'
    : media.some(item => item.status === 'completed' && Boolean(item.url)) ? 'ready' : 'none';
  const lastActivity = Date.parse(input.lastActivityAt || '');
  const recovering = input.status === 'running' && Number.isFinite(lastActivity) && now-lastActivity > 90_000;
  const executionPhase = input.status === 'aborted' ? 'stopped'
    : input.status === 'failed' || studio?.status === 'failed' ? 'blocked'
    : studio?.status === 'awaiting_approval' && input.status !== 'running' ? 'awaiting_approval'
    : recovering ? 'recovery_wait'
    : input.status === 'running' ? 'working' : 'idle';
  const start = Date.parse(input.started_at || '');
  const end = input.ended_at ? Date.parse(input.ended_at) : now;
  return {
    execution_phase: executionPhase,
    delivery_status: deliveryStatus,
    run_wall_seconds: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0,Math.floor((end-start)/1000)) : null,
    ...(input.lastActivityAt ? {last_activity_at:input.lastActivityAt} : {}),
    ...(recovering ? {recovery_wait_seconds:Math.floor((now-lastActivity)/1000)} : {}),
    ...(input.terminalCode ? {terminal_code:input.terminalCode} : {}),
  };
}
