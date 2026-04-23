import { createClient } from '@/lib/supabase/client';

let supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!supabase) supabase = createClient();
  return supabase;
}

// Monotonically increasing sequence for ordering within a session
let seq = 0;

/**
 * Log a project event to agent_events table.
 * Used for user actions that aren't part of an agent run
 * but need to be captured for Replay (image upload, tip commit, etc.)
 *
 * Fire-and-forget — errors are silently ignored.
 */
export function logProjectEvent(
  projectId: string,
  type: string,
  data: Record<string, unknown>,
  runId?: string,
) {
  const sb = getSupabase();
  sb.from('agent_events').insert({
    ...(runId ? { run_id: runId } : {}),
    project_id: projectId,
    type,
    data,
    seq: seq++,
  }).then(({ error }) => {
    if (error) console.warn('[projectEvent] insert error:', error.message);
  });
}

/**
 * Pre-defined event types for type safety.
 */
export const ProjectEvents = {
  /** User uploaded original image(s) to start/extend project */
  imageUpload: (projectId: string, snapshotId: string, imageUrl: string, isOriginal: boolean) =>
    logProjectEvent(projectId, 'image_upload', { snapshotId, imageUrl, isOriginal }),

  /** User sent a message in CUI */
  userMessage: (projectId: string, messageId: string, content: string, hasImage: boolean) =>
    logProjectEvent(projectId, 'user_message', { messageId, content: content.slice(0, 2000), hasImage }),

  /** Tips generated for a snapshot */
  tipsGenerated: (projectId: string, snapshotId: string, tips: unknown[]) =>
    logProjectEvent(projectId, 'tips_generated', { snapshotId, tipCount: tips.length, tips }),

  /** User committed a tip (accepted preview) */
  tipCommitted: (projectId: string, snapshotId: string, tipIndex: number, newSnapshotId: string, imageUrl: string) =>
    logProjectEvent(projectId, 'tip_committed', { snapshotId, tipIndex, newSnapshotId, imageUrl }),

  /** Project title set/changed */
  projectNamed: (projectId: string, title: string) =>
    logProjectEvent(projectId, 'project_named', { title }),

  /** Video generation completed */
  videoCompleted: (projectId: string, animationId: string, videoUrl: string, prompt: string) =>
    logProjectEvent(projectId, 'video_completed', { animationId, videoUrl, prompt }),

  /** Snapshot description updated */
  descriptionSet: (projectId: string, snapshotId: string, description: string) =>
    logProjectEvent(projectId, 'description_set', { snapshotId, description }),
} as const;
