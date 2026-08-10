import type { SupabaseClient } from '@supabase/supabase-js';
import type { VideoMeta, VideoSourceRange } from '@/types';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import {
  normalizeExternalVideoRange,
  sourceRangeFromVideoMeta,
  sourceRangeIdentity,
  type ExternalVideoRangeInput,
} from '@/lib/media-source-range';

export interface PublishedExternalVideoRange {
  snapshotId: string;
  mediaIndex: number;
  ref: string;
  url: string;
  sourceRange: VideoSourceRange;
  /** Persisted Media List understanding/description for later Agent turns. */
  description: string;
  created: boolean;
}

export async function publishExternalVideoRanges(options: {
  supabase: SupabaseClient;
  projectId: string;
  ranges: ExternalVideoRangeInput[];
}): Promise<PublishedExternalVideoRange[]> {
  const normalized = options.ranges.map(normalizeExternalVideoRange);
  if (!normalized.length) throw new Error('At least one source range is required.');
  if (normalized.length > 20) throw new Error('A maximum of 20 source ranges can be published at once.');

  const { data: existingRows, error: existingError } = await options.supabase
    .from('snapshots')
    .select('id, type, video_meta, description, sort_order')
    .eq('project_id', options.projectId)
    .order('sort_order', { ascending: true });
  if (existingError) throw new Error(`Media List lookup failed: ${existingError.message}`);

  const existingByIdentity = new Map<string, { id: string; videoMeta: VideoMeta; description?: string }>();
  for (const row of existingRows || []) {
    if ((row as { type?: string }).type !== 'video') continue;
    const videoMeta = (row as { video_meta?: VideoMeta }).video_meta;
    const sourceRange = sourceRangeFromVideoMeta(videoMeta);
    if (sourceRange && videoMeta) {
      existingByIdentity.set(sourceRangeIdentity(sourceRange), {
        id: (row as { id: string }).id,
        videoMeta,
        description: (row as { description?: string }).description,
      });
    }
  }

  const snapshotIds: Array<{ id: string; range: VideoSourceRange; url: string; description: string; created: boolean }> = [];
  for (const item of normalized) {
    const { duration, description, ...sourceRange } = item;
    const identity = sourceRangeIdentity(sourceRange);
    const existing = existingByIdentity.get(identity);
    const label = description || `External video ${sourceRange.start_sec}-${sourceRange.end_sec}s`;
    if (existing) {
      const refreshedMeta: VideoMeta = {
        ...existing.videoMeta,
        videoUrl: sourceRange.source_url,
        providerUrl: sourceRange.source_url,
        prompt: label,
        sourceUrls: [sourceRange.source_url],
        sourceRange,
        duration,
      };
      const metadataChanged = JSON.stringify(refreshedMeta) !== JSON.stringify(existing.videoMeta);
      if (metadataChanged || existing.description !== label) {
        const { error: refreshError } = await options.supabase
          .from('snapshots')
          .update({ video_meta: refreshedMeta, description: label })
          .eq('id', existing.id);
        if (refreshError) throw new Error(`External source metadata refresh failed: ${refreshError.message}`);
        existing.videoMeta = refreshedMeta;
        existing.description = label;
      }
      snapshotIds.push({ id: existing.id, range: sourceRange, url: sourceRange.source_url, description: label, created: false });
      continue;
    }

    const snapshotId = crypto.randomUUID();
    const sortResult = await options.supabase.rpc('next_sort_order', { p_project_id: options.projectId });
    if (sortResult.error) throw new Error(`Media List ordering failed: ${sortResult.error.message}`);
    const videoMeta: VideoMeta = {
      origin: 'external-range',
      taskId: null,
      videoUrl: sourceRange.source_url,
      providerUrl: sourceRange.source_url,
      prompt: label,
      sourceSnapshotIds: [],
      sourceUrls: [sourceRange.source_url],
      sourceRange,
      status: 'completed',
      duration,
      model: 'external-range',
      createdAt: new Date().toISOString(),
    };
    const { error: insertError } = await options.supabase.from('snapshots').insert({
      id: snapshotId,
      project_id: options.projectId,
      image_url: VIDEO_PLACEHOLDER_IMAGE,
      tips: [],
      message_id: '',
      sort_order: sortResult.data ?? Date.now(),
      type: 'video',
      video_meta: videoMeta,
      description: label,
    });
    if (insertError) throw new Error(`External source range publish failed: ${insertError.message}`);
    existingByIdentity.set(identity, { id: snapshotId, videoMeta, description: label });
    snapshotIds.push({ id: snapshotId, range: sourceRange, url: sourceRange.source_url, description: label, created: true });
  }

  const { data: finalRows, error: finalError } = await options.supabase
    .from('snapshots')
    .select('id')
    .eq('project_id', options.projectId)
    .order('sort_order', { ascending: true });
  if (finalError) throw new Error(`Media List refresh failed: ${finalError.message}`);
  const mediaIndexById = new Map((finalRows || []).map((row: { id: string }, index: number) => [row.id, index + 1]));

  return snapshotIds.map(item => {
    const mediaIndex = mediaIndexById.get(item.id);
    if (!mediaIndex) throw new Error(`Published source range ${item.id} is missing from Media List.`);
    return {
      snapshotId: item.id,
      mediaIndex,
      ref: `<<<media_${mediaIndex}>>>`,
      url: item.url,
      sourceRange: item.range,
      description: item.description,
      created: item.created,
    };
  });
}
