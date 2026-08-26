import type { SupabaseClient } from '@supabase/supabase-js';
import type { VideoMeta, VideoSourceRange } from '@/types';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import {
  normalizeExternalMediaInput,
  normalizeExternalVideoRange,
  sourceRangeFromVideoMeta,
  sourceRangeIdentity,
  type ExternalMediaType,
  type ExternalVideoRangeInput,
} from '@/lib/media-source-range';

export interface PublishedExternalVideoRange {
  snapshotId: string;
  mediaIndex: number;
  ref: string;
  url: string;
  type: ExternalMediaType;
  sourceRange?: VideoSourceRange;
  /** Persisted Media List understanding/description for later Agent turns. */
  description: string;
  created: boolean;
}

function mediaTypeFromBytes(bytes: Uint8Array): ExternalMediaType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG') return 'image';
  const ascii = String.fromCharCode(...bytes.slice(0, 16));
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image';
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12).toLowerCase();
    return ['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand) ? 'image' : 'video';
  }
  return undefined;
}

function mediaTypeFromContentType(contentType: string): ExternalMediaType | undefined {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  return undefined;
}

export async function detectExternalMediaType(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalMediaType> {
  try {
    const head = await fetchImpl(sourceUrl, { method: 'HEAD', redirect: 'follow' });
    if (head.ok) {
      const headType = mediaTypeFromContentType(head.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '');
      if (headType) return headType;
    }
  } catch {
    // Some asset servers reject HEAD. Fall back to a bounded byte request.
  }

  let response: Response;
  try {
    response = await fetchImpl(sourceUrl, {
      headers: { Range: 'bytes=0-4095' },
      redirect: 'follow',
    });
  } catch (error) {
    throw new Error(`Unable to inspect source_url media type: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Unable to inspect source_url media type: HTTP ${response.status}.`);

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  const responseType = mediaTypeFromContentType(contentType);
  if (responseType) return responseType;

  let bytes = new Uint8Array();
  if (response.body) {
    const reader = response.body.getReader();
    const first = await reader.read();
    await reader.cancel();
    bytes = first.value || bytes;
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const detected = mediaTypeFromBytes(bytes);
  if (detected) return detected;
  throw new Error(`source_url returned unsupported media type${contentType ? ` ${contentType}` : ''}.`);
}

export async function publishExternalVideoRanges(options: {
  supabase: SupabaseClient;
  projectId: string;
  ranges: ExternalVideoRangeInput[];
  fetchImpl?: typeof fetch;
}): Promise<PublishedExternalVideoRange[]> {
  const inputs = options.ranges.map(normalizeExternalMediaInput);
  if (!inputs.length) throw new Error('At least one source range is required.');
  if (inputs.length > 20) throw new Error('A maximum of 20 source ranges can be published at once.');
  const normalized = await Promise.all(inputs.map(async input => {
    const type = input.type || await detectExternalMediaType(input.source_url, options.fetchImpl);
    if (type === 'image') return { type, source_url: input.source_url, description: input.description } as const;
    return { type, ...normalizeExternalVideoRange(input) } as const;
  }));

  const { data: existingRows, error: existingError } = await options.supabase
    .from('snapshots')
    .select('id, type, image_url, design_path, video_meta, description, sort_order')
    .eq('project_id', options.projectId)
    .order('sort_order', { ascending: true });
  if (existingError) throw new Error(`Media List lookup failed: ${existingError.message}`);

  const existingByIdentity = new Map<string, { id: string; videoMeta: VideoMeta; description?: string }>();
  const existingImagesByUrl = new Map<string, { id: string; description?: string }>();
  for (const row of existingRows || []) {
    const typedRow = row as { id: string; type?: string; image_url?: string; design_path?: string; video_meta?: VideoMeta; description?: string };
    if (typedRow.type !== 'video') {
      if (typedRow.type !== 'reference' && !typedRow.design_path && typedRow.image_url) {
        existingImagesByUrl.set(typedRow.image_url, { id: typedRow.id, description: typedRow.description });
      }
      continue;
    }
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

  const snapshotIds: Array<{ id: string; type: ExternalMediaType; range?: VideoSourceRange; url: string; description: string; created: boolean }> = [];
  for (const item of normalized) {
    if (item.type === 'image') {
      const label = item.description || 'External image';
      const existing = existingImagesByUrl.get(item.source_url);
      if (existing) {
        if (existing.description !== label) {
          const { error: refreshError } = await options.supabase
            .from('snapshots')
            .update({ description: label })
            .eq('id', existing.id);
          if (refreshError) throw new Error(`External source metadata refresh failed: ${refreshError.message}`);
          existing.description = label;
        }
        snapshotIds.push({ id: existing.id, type: 'image', url: item.source_url, description: label, created: false });
        continue;
      }

      const snapshotId = crypto.randomUUID();
      const sortResult = await options.supabase.rpc('next_sort_order', { p_project_id: options.projectId });
      if (sortResult.error) throw new Error(`Media List ordering failed: ${sortResult.error.message}`);
      const { error: insertError } = await options.supabase.from('snapshots').insert({
        id: snapshotId,
        project_id: options.projectId,
        image_url: item.source_url,
        tips: [],
        message_id: '',
        sort_order: sortResult.data ?? Date.now(),
        description: label,
      });
      if (insertError) throw new Error(`External image publish failed: ${insertError.message}`);
      existingImagesByUrl.set(item.source_url, { id: snapshotId, description: label });
      snapshotIds.push({ id: snapshotId, type: 'image', url: item.source_url, description: label, created: true });
      continue;
    }

    const { type: _type, duration, description, ...sourceRange } = item;
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
      snapshotIds.push({ id: existing.id, type: 'video', range: sourceRange, url: sourceRange.source_url, description: label, created: false });
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
    snapshotIds.push({ id: snapshotId, type: 'video', range: sourceRange, url: sourceRange.source_url, description: label, created: true });
  }

  const { data: finalRows, error: finalError } = await options.supabase
    .from('snapshots')
    .select('id')
    .eq('project_id', options.projectId)
    .order('sort_order', { ascending: true });
  if (finalError) throw new Error(`Media List refresh failed: ${finalError.message}`);
  const mediaIndexById = new Map<string, number>((finalRows || []).map((row: { id: string }, index: number) => [row.id, index + 1]));

  return snapshotIds.map(item => {
    const mediaIndex = mediaIndexById.get(item.id);
    if (!mediaIndex) throw new Error(`Published source range ${item.id} is missing from Media List.`);
    return {
      snapshotId: item.id,
      mediaIndex,
      ref: `<<<media_${mediaIndex}>>>`,
      url: item.url,
      type: item.type,
      ...(item.range ? { sourceRange: item.range } : {}),
      description: item.description,
      created: item.created,
    };
  });
}
