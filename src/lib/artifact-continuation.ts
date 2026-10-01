import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** A stable run identity lets CLI, CUI, and reconnects consume an action once. */
export function artifactContinuationId(snapshotId: string, actionIndex: number, prompt: string) {
  const hex = createHash('sha256').update(JSON.stringify([snapshotId, actionIndex, prompt])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function resolveArtifactContinuation(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  input: unknown,
): Promise<{ runId: string; prompt: string; snapshotId: string; actionIndex: number } | { error: string; status: number }> {
  const request = input as { snapshotId?: unknown; actionIndex?: unknown } | null;
  if (!request || typeof request.snapshotId !== 'string' ||
      !Number.isInteger(request.actionIndex) || Number(request.actionIndex) < 0 || Number(request.actionIndex) > 3) {
    return { error: 'Invalid artifact continuation', status: 400 };
  }
  // Public visibility does not grant execution permission.
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (!project) return { error: 'Project not found', status: 404 };
  const { data: snapshot } = await supabase.from('snapshots').select('video_meta').eq('id', request.snapshotId).eq('project_id', projectId).maybeSingle();
  const meta = snapshot?.video_meta;
  if (!meta || meta.status !== 'completed' || !meta.videoUrl) {
    return { error: 'Artifact is not complete', status: 409 };
  }
  const actionIndex = Number(request.actionIndex);
  const action = meta.completionActions?.[actionIndex];
  if (action?.policy !== 'auto' || typeof action.prompt !== 'string' || !action.prompt.trim()) {
    return { error: 'Artifact action requires confirmation', status: 400 };
  }
  return {
    runId: artifactContinuationId(request.snapshotId, actionIndex, action.prompt),
    prompt: `${action.prompt}\n\n[Completed artifact] Native video snapshot: ${request.snapshotId}; task: ${meta.taskId || 'completed'}; source and plan remain those specified above. Continue from this completed artifact, without submitting another video generation.`,
    snapshotId: request.snapshotId,
    actionIndex,
  };
}
