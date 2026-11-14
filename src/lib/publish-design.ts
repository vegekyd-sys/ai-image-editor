import type { SupabaseClient } from '@supabase/supabase-js';
import * as workspace from './workspace';

/** Shared publication path for Agent drafts and deterministic design producers. */
export async function publishDesignSnapshot(input: {
  supabase: SupabaseClient; userId: string; projectId: string; snapshotId: string;
  design: { code: string; width: number; height: number } & Record<string, unknown>; description?: string; messageId?: string;
  posterUrl?: string; preserveExisting?: boolean;
}): Promise<{ snapshotId: string; designPath: string; posterUrl: string }> {
  const { supabase, userId, projectId, snapshotId, design } = input;
  const { data: existing, error: readError } = await supabase.from('snapshots')
    .select('project_id,design_path,image_url,message_id,sort_order').eq('id', snapshotId).maybeSingle();
  if (readError) throw new Error('Cannot verify existing design snapshot');
  if (existing && existing.project_id !== projectId) throw new Error('Design snapshot belongs to another project');
  if (input.preserveExisting && existing?.design_path) {
    if (!existing.message_id && input.messageId) {
      const linked = await supabase.from('snapshots').update({ message_id: input.messageId }).eq('id', snapshotId).eq('message_id', '');
      if (linked.error) throw new Error('Design message linkage persistence failed');
    }
    return { snapshotId, designPath: existing.design_path, posterUrl: existing.image_url || '' };
  }
  const designPath = `code/${snapshotId}.json`;
  const saved = await workspace.writeFile(designPath, JSON.stringify(design), supabase, userId, 'application/json');
  if (!saved.success) throw new Error('Editable design persistence failed');
  const sortOrder = existing?.sort_order ?? (await supabase.rpc('next_sort_order', { p_project_id: projectId })).data ?? 0;
  const posterUrl = input.posterUrl || existing?.image_url || '';
  const { error } = await supabase.from('snapshots').upsert({
    id: snapshotId, project_id: projectId, design_path: designPath, image_url: posterUrl, tips: [],
    // A replay must not move an established snapshot into a later message.
    message_id: existing?.message_id || input.messageId || '', sort_order: sortOrder,
    description: input.description || '[composition]',
  }, { onConflict: 'id' });
  if (error) throw new Error('Published design snapshot persistence failed');
  const touched = await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId);
  if (touched.error) throw new Error('Design project update failed');
  return { snapshotId, designPath, posterUrl };
}
