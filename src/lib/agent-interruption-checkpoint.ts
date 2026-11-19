import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentStreamEvent } from './agent-tools';
import type { DurableExecutionSnapshot } from './agent-execution';

export type AgentInterruptionCheckpoint = NonNullable<
  Extract<AgentStreamEvent, { type: 'error' }>['checkpoint']
> & { exportJobId?: string; exportStatus?: 'queued' | 'rendering' | 'completed' };

const recoveryTools = ['materialize_media', 'publish_draft', 'run_code', 'write_file'];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function projectCompositionPath(value: unknown, projectId: string): string | undefined {
  if (typeof value !== 'string' || !value.endsWith('.json')) return undefined;
  const parts = value.split('/');
  if (parts[0] !== projectId || !['drafts', 'code'].includes(parts[1])) return undefined;
  if (parts.length < 3 || parts.some(part => !part || part === '.' || part === '..')) return undefined;
  return value;
}

export function recoverCompositionReceipt(
  projectId: string,
  row: { tool_name: string; input: unknown; output: unknown },
): { draftPath?: string; exportJobId?: string; lastTool: string } | undefined {
  const envelope = record(row.output);
  if (envelope.type === 'error-json' || envelope.type === 'error-text') return undefined;
  const output = record(envelope.value ?? row.output);
  if (output.success === false || output.error) return undefined;
  const input = record(row.input);
  let path: unknown;

  switch (row.tool_name) {
    case 'materialize_media': {
      if (output.success !== true || typeof output.jobId !== 'string') return undefined;
      return {
        draftPath: projectCompositionPath(input.design_path, projectId),
        exportJobId: output.jobId,
        lastTool: row.tool_name,
      };
    }
    case 'publish_draft':
      if (output.published !== true) return undefined;
      path = output.designPath;
      break;
    case 'run_code':
      path = output.code_path;
      break;
    case 'write_file':
      if (output.success !== true) return undefined;
      path = record(output.compositionWorkspace).designPath
        ?? (input.fromLastRunCode === true || output.path === `${projectId}/drafts/latest-composition.json`
          ? output.path : undefined);
      break;
    default:
      return undefined;
  }

  const draftPath = projectCompositionPath(path, projectId);
  return draftPath ? { draftPath, lastTool: row.tool_name } : undefined;
}

export async function loadInterruptedAgentCheckpoint(input: {
  supabase: SupabaseClient;
  runId: string;
  projectId: string;
  userId: string;
  snapshot?: DurableExecutionSnapshot | null;
}): Promise<AgentInterruptionCheckpoint | undefined> {
  const { supabase, runId, projectId, userId, snapshot } = input;
  const previous = snapshot?.checkpoint as AgentInterruptionCheckpoint | undefined;
  const { data: rows } = await supabase.from('agent_tool_history')
    .select('tool_name,input,output')
    .eq('run_id', runId)
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .in('tool_name', recoveryTools)
    .order('created_at', { ascending: false })
    .limit(24);

  for (const row of rows || []) {
    const receipt = recoverCompositionReceipt(projectId, row);
    if (!receipt) continue;
    let draftPath = receipt.draftPath;
    let exportJobId: string | undefined;
    let exportStatus: AgentInterruptionCheckpoint['exportStatus'];
    if (receipt.exportJobId) {
      const { data: job } = await supabase.from('remotion_export_jobs')
        .select('id,design_path,status')
        .eq('id', receipt.exportJobId)
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle();
      if (job && ['queued', 'rendering', 'completed'].includes(job.status)) {
        draftPath = projectCompositionPath(job.design_path, projectId) ?? draftPath;
        exportJobId = job.id;
        exportStatus = job.status;
      }
    }
    if (draftPath) {
      const { data: file } = await supabase.from('workspace_files')
        .select('path')
        .eq('user_id', userId)
        .eq('path', draftPath)
        .maybeSingle();
      if (!file) draftPath = undefined;
    }
    if (draftPath || exportJobId) {
      return {
        ...(previous?.draftPath === draftPath ? previous : {}),
        draftPath,
        exportJobId,
        exportStatus,
        lastTool: receipt.lastTool,
        studioRunId: previous?.studioRunId,
        studioRunStage: previous?.studioRunStage,
        studioRunStatePath: previous?.studioRunStatePath,
      };
    }
  }
  return previous;
}
