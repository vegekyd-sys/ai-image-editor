import { getSupabaseAdmin } from './supabase/service';
import { normalizeImageFilename, parseImageDataUrl, uploadImage } from './supabase/storage';

/** Preserve the project, cover and first timeline image that Voice previously created via the CLI. */
export async function saveVoiceImageProject(userId: string, image: string): Promise<string> {
  const parsed = parseImageDataUrl(image);
  if (!parsed) throw new Error('Expected an inline image');
  const db = getSupabaseAdmin();
  const projectId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const filename = normalizeImageFilename(`snapshot-${snapshotId}`, parsed.mimeType);
  try {
    const url = await uploadImage(db, userId, projectId, filename, image);
    if (!url) throw new Error('Image upload failed');
    const project = await db.from('projects').insert({
      id: projectId, user_id: userId, title: 'Voice 图片', timeline_version: 2, cover_url: url,
    });
    if (project.error) throw project.error;
    const snapshot = await db.from('snapshots').insert({
      id: snapshotId, project_id: projectId, image_url: url, tips: [], message_id: '', sort_order: 0,
    });
    if (snapshot.error) throw snapshot.error;
    return url;
  } catch (error) {
    // A lost write response may have committed. Clean up only this operation's new IDs.
    const cleanup = await Promise.allSettled([
      db.from('projects').delete().eq('id', projectId).eq('user_id', userId),
      db.storage.from('images').remove([`${userId}/${projectId}/${filename}`]),
    ]);
    if (cleanup.some(result => result.status === 'rejected' || result.value.error)) {
      console.warn('[voice-image] Incomplete project cleanup', projectId);
    }
    throw error;
  }
}
