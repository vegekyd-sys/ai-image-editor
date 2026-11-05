// Server-side timeline persistence: the design JSON in the user's workspace is
// the durable copy. Both the timeline API (user edits) and the Agent's
// edit_timeline tool go through applyTimelineTxToFile so they share one reducer.
import type { SupabaseClient } from '@supabase/supabase-js';
import * as workspace from '@/lib/workspace';
import { getTimelineDoc, timelineToDesign } from './design';
import { applyTx, type ApplyResult } from './reducer';
import type { TimelineDoc, TimelineOp } from './types';

export interface LoadedTimeline {
  file: Record<string, unknown>;
  doc: TimelineDoc;
}

export async function loadTimelineFile(admin: SupabaseClient, userId: string, designPath: string): Promise<LoadedTimeline | null> {
  const current = await workspace.readFile(designPath, admin, userId);
  if (!current) return null;
  const file = JSON.parse(current.content) as Record<string, unknown>;
  const doc = getTimelineDoc(file as { code: string; props?: Record<string, unknown> });
  return doc ? { file, doc } : null;
}

export async function writeTimelineFile(
  admin: SupabaseClient,
  userId: string,
  designPath: string,
  doc: TimelineDoc,
  previous?: Record<string, unknown>,
): Promise<void> {
  const design = timelineToDesign(doc, previous as { code?: unknown; fontSubstitutions?: Record<string, string> } | undefined);
  const next = { ...(previous || {}), ...design };
  const result = await workspace.writeFile(designPath, JSON.stringify(next), admin, userId, 'application/json');
  if (!result.success) throw new Error(result.error || 'Workspace write failed');
}

export async function applyTimelineTxToFile(
  admin: SupabaseClient,
  userId: string,
  designPath: string,
  tx: { baseRevision: number; ops: TimelineOp[] },
): Promise<ApplyResult> {
  const loaded = await loadTimelineFile(admin, userId, designPath);
  if (!loaded) throw new Error('Timeline video not found');
  const result = applyTx(loaded.doc, tx);
  await writeTimelineFile(admin, userId, designPath, result.doc, loaded.file);
  return result;
}
