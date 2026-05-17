import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { uploadImage, uploadVideo } from '@/lib/supabase/storage';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VideoMeta } from '@/types';

async function resolveImageUrl(
  url: string,
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<string> {
  if (url.includes('makaron.app/storage/') || url.includes('supabase.co/storage/')) {
    return url;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const jpeg = await sharp(buffer)
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  const base64 = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const filename = `snapshot-${crypto.randomUUID()}.jpg`;
  const storageUrl = await uploadImage(supabase, userId, projectId, filename, base64);
  return storageUrl || url;
}

/**
 * POST /api/projects/create — Create a new project with an initial image.
 *
 * Accepts imageUrl (preferred) or imageBase64. Creates project + first snapshot.
 * Returns { projectId, snapshotId, imageUrl }.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest(req);
    if ('error' in authResult) return authResult.error;
    const { userId, supabase } = authResult.auth;

    const { imageUrl, imageBase64, imageUrls, imageBase64s, videoUrls, title, _addToProject } = await req.json();

    // Support single or multiple images
    const urls: (string | undefined)[] = imageUrls || (imageUrl ? [imageUrl] : []);
    const base64s: (string | undefined)[] = imageBase64s || (imageBase64 ? [imageBase64] : []);
    const imageCount = Math.max(urls.length, base64s.length);
    const videos: string[] = videoUrls || [];

    // Add images/videos to existing project (used by CLI chat --image / --video)
    if (_addToProject && (imageCount > 0 || videos.length > 0)) {
      const existingProjectId = _addToProject as string;
      // Atomic sort_order allocation
      const { data: startSort } = await supabase.rpc('next_sort_order', { p_project_id: existingProjectId });
      let sortOrder = startSort ?? 0;

      const snapshots: { snapshotId: string; imageUrl: string; type?: string }[] = [];
      for (let i = 0; i < imageCount; i++) {
        let finalUrl = urls[i] ? await resolveImageUrl(urls[i]!, supabase, userId, existingProjectId) : undefined;
        if (!finalUrl && base64s[i]) {
          const snapId = crypto.randomUUID();
          const filename = `snapshot-${snapId}.jpg`;
          finalUrl = await uploadImage(supabase, userId, existingProjectId, filename, base64s[i]!) || undefined;
          if (!finalUrl) continue;
        }
        if (!finalUrl) continue;
        const snapshotId = crypto.randomUUID();
        await supabase.from('snapshots').insert({
          id: snapshotId, project_id: existingProjectId, image_url: finalUrl,
          tips: [], message_id: '', sort_order: sortOrder++,
        });
        snapshots.push({ snapshotId, imageUrl: finalUrl });
      }

      // Add video snapshots
      for (const videoUrl of videos) {
        const snapshotId = crypto.randomUUID();
        let permanentUrl = videoUrl;
        let width: number | undefined;
        let height: number | undefined;

        // Fetch + upload to our Storage if external URL
        if (!videoUrl.includes('supabase.co/storage/')) {
          try {
            const res = await fetch(videoUrl);
            if (res.ok) {
              const buffer = new Uint8Array(await res.arrayBuffer());
              try {
                const { probeMP4Dimensions } = await import('@/lib/mp4-probe');
                const dims = probeMP4Dimensions(buffer);
                if (dims) { width = dims.width; height = dims.height; }
              } catch { /* non-fatal */ }
              const uploaded = await uploadVideo(supabase, userId, existingProjectId, snapshotId, buffer);
              if (uploaded) permanentUrl = uploaded;
            }
          } catch { /* use original URL */ }
        }

        // Extract poster frame from video
        let posterUrl = '';
        try {
          const { extractVideoPoster } = await import('@/lib/video-poster');
          const posterBuffer = await extractVideoPoster(permanentUrl);
          const posterPath = `${userId}/${existingProjectId}/posters/${snapshotId}.jpg`;
          const { error: posterErr } = await supabase.storage.from('images').upload(posterPath, posterBuffer, { contentType: 'image/jpeg', upsert: true });
          if (!posterErr) {
            const { data: urlData } = supabase.storage.from('images').getPublicUrl(posterPath);
            posterUrl = urlData?.publicUrl || '';
          }
        } catch (e) {
          console.warn('Video poster extraction failed:', e);
        }

        const videoMeta: VideoMeta = {
          taskId: null, videoUrl: permanentUrl, prompt: '',
          sourceSnapshotIds: [], sourceUrls: [],
          status: 'completed', duration: null, model: 'upload',
          createdAt: new Date().toISOString(), width, height,
        };
        await supabase.from('snapshots').insert({
          id: snapshotId, project_id: existingProjectId, image_url: posterUrl,
          tips: [], message_id: '', sort_order: sortOrder++,
          type: 'video', video_meta: videoMeta,
        });
        snapshots.push({ snapshotId, imageUrl: posterUrl || permanentUrl, type: 'video' });
      }

      return NextResponse.json({ projectId: existingProjectId, snapshots });
    }

    // Text-to-image: no images/videos, just create empty project (agent will generate)
    if (imageCount === 0 && videos.length === 0) {
      const projectId = crypto.randomUUID();
      await supabase.from('projects').insert({ id: projectId, user_id: userId, title: title || 'Untitled', timeline_version: 2 });
      return NextResponse.json({
        projectId,
        snapshots: [],
        projectUrl: `https://www.makaron.app/projects/${projectId}`,
      });
    }

    // Create project
    const projectId = crypto.randomUUID();
    const { error: projectError } = await supabase.from('projects').insert({
      id: projectId,
      user_id: userId,
      title: title || 'Untitled',
      timeline_version: 2,
    });
    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }

    // Create snapshots for each image
    let sortOrder = 0;
    const snapshots: { snapshotId: string; imageUrl: string; type?: string }[] = [];
    for (let i = 0; i < imageCount; i++) {
      let finalUrl = urls[i] ? await resolveImageUrl(urls[i]!, supabase, userId, projectId) : undefined;
      if (!finalUrl && base64s[i]) {
        const snapId = crypto.randomUUID();
        const filename = `snapshot-${snapId}.jpg`;
        finalUrl = await uploadImage(supabase, userId, projectId, filename, base64s[i]!) || undefined;
        if (!finalUrl) continue;
      }
      if (!finalUrl) continue;

      const snapshotId = crypto.randomUUID();
      const { error: snapError } = await supabase.from('snapshots').insert({
        id: snapshotId,
        project_id: projectId,
        image_url: finalUrl,
        tips: [],
        message_id: '',
        sort_order: sortOrder++,
      });
      if (!snapError) {
        snapshots.push({ snapshotId, imageUrl: finalUrl });
      }
    }

    // Create video snapshots
    for (const videoUrl of videos) {
      const snapshotId = crypto.randomUUID();
      let permanentUrl = videoUrl;
      let width: number | undefined;
      let height: number | undefined;

      if (!videoUrl.includes('supabase.co/storage/')) {
        try {
          const res = await fetch(videoUrl);
          if (res.ok) {
            const buffer = new Uint8Array(await res.arrayBuffer());
            try {
              const { probeMP4Dimensions } = await import('@/lib/mp4-probe');
              const dims = probeMP4Dimensions(buffer);
              if (dims) { width = dims.width; height = dims.height; }
            } catch { /* non-fatal */ }
            const uploaded = await uploadVideo(supabase, userId, projectId, snapshotId, buffer);
            if (uploaded) permanentUrl = uploaded;
          }
        } catch { /* use original URL */ }
      }

      // Extract poster frame
      let posterUrl = '';
      try {
        const { extractVideoPoster } = await import('@/lib/video-poster');
        const posterBuffer = await extractVideoPoster(permanentUrl);
        const posterPath = `${userId}/${projectId}/posters/${snapshotId}.jpg`;
        const { error: posterErr } = await supabase.storage.from('images').upload(posterPath, posterBuffer, { contentType: 'image/jpeg', upsert: true });
        if (!posterErr) {
          const { data: urlData } = supabase.storage.from('images').getPublicUrl(posterPath);
          posterUrl = urlData?.publicUrl || '';
        }
      } catch (e) {
        console.warn('Video poster extraction failed:', e);
      }

      const videoMeta: VideoMeta = {
        taskId: null, videoUrl: permanentUrl, prompt: '',
        sourceSnapshotIds: [], sourceUrls: [],
        status: 'completed', duration: null, model: 'upload',
        createdAt: new Date().toISOString(), width, height,
      };
      const { error: snapError } = await supabase.from('snapshots').insert({
        id: snapshotId, project_id: projectId, image_url: posterUrl,
        tips: [], message_id: '', sort_order: sortOrder++,
        type: 'video', video_meta: videoMeta,
      });
      if (!snapError) {
        snapshots.push({ snapshotId, imageUrl: posterUrl || permanentUrl, type: 'video' });
      }
    }

    // Update project cover with first image (prefer non-video)
    const coverSnap = snapshots.find(s => !s.type) || snapshots[0];
    if (coverSnap) {
      await supabase.from('projects').update({
        cover_url: coverSnap.imageUrl,
      }).eq('id', projectId);
    }

    return NextResponse.json({
      projectId,
      snapshots,
      projectUrl: `https://www.makaron.app/projects/${projectId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
