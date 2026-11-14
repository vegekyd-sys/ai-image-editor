import type { SupabaseClient } from '@supabase/supabase-js';
import { translate, type Locale } from './locales';

/** Media-only chat is a real turn. Trust persisted project media, not a count
 * supplied by a client, before synthesizing its internal analysis instruction. */
export async function resolveAgentTurnInput(input: {
  prompt: unknown; projectId: unknown; turnMediaSnapshotIds?: unknown;
  image?: unknown; locale: Locale; supabase: SupabaseClient;
}): Promise<{ prompt: string; mediaOnly: boolean; imageUrls: string[] }> {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (prompt.trim()) return { prompt, mediaOnly: false, imageUrls: [] };
  const imageUrls: string[] = [];
  if (typeof input.image === 'string' && /^(?:https?:\/\/|data:image\/)/i.test(input.image)) imageUrls.push(input.image);
  if (!imageUrls.length && typeof input.projectId === 'string' && Array.isArray(input.turnMediaSnapshotIds)) {
    const ids = [...new Set(input.turnMediaSnapshotIds.filter((id): id is string => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)))].slice(0, 10);
    if (ids.length) {
      const { data, error } = await input.supabase.from('snapshots').select('id,image_url')
        .eq('project_id', input.projectId).in('id', ids).limit(ids.length);
      if (!error) for (const row of data || []) if (typeof row.image_url === 'string' && /^https?:\/\//i.test(row.image_url)) imageUrls.push(row.image_url);
    }
  }
  return imageUrls.length
    ? { prompt: translate(input.locale, 'agent.mediaOnlyPrompt'), mediaOnly: true, imageUrls }
    : { prompt: '', mediaOnly: false, imageUrls: [] };
}
