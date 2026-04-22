import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadImage } from '@/lib/supabase/storage';

/**
 * POST /api/projects/create — Create a new project with an initial image.
 *
 * Accepts imageUrl (preferred) or imageBase64. Creates project + first snapshot.
 * Returns { projectId, snapshotId, imageUrl }.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { imageUrl, imageBase64, imageUrls, imageBase64s, title, _addToProject } = await req.json();

    // Support single or multiple images
    const urls: (string | undefined)[] = imageUrls || (imageUrl ? [imageUrl] : []);
    const base64s: (string | undefined)[] = imageBase64s || (imageBase64 ? [imageBase64] : []);
    const imageCount = Math.max(urls.length, base64s.length);

    // Add images to existing project (used by CLI chat --image)
    if (_addToProject && imageCount > 0) {
      const existingProjectId = _addToProject as string;
      // Get current max sort_order
      const { data: maxSnap } = await supabase.from('snapshots')
        .select('sort_order').eq('project_id', existingProjectId)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
      let sortOrder = (maxSnap?.sort_order ?? -1) + 1;

      const snapshots: { snapshotId: string; imageUrl: string }[] = [];
      for (let i = 0; i < imageCount; i++) {
        let finalUrl = urls[i];
        if (!finalUrl && base64s[i]) {
          const snapId = crypto.randomUUID();
          const filename = `snapshot-${snapId}.jpg`;
          finalUrl = await uploadImage(supabase, user.id, existingProjectId, filename, base64s[i]!) || undefined;
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
      return NextResponse.json({ projectId: existingProjectId, snapshots });
    }

    // Text-to-image: no images, just create empty project (agent will generate)
    if (imageCount === 0) {
      const projectId = crypto.randomUUID();
      await supabase.from('projects').insert({ id: projectId, user_id: user.id, title: title || 'Untitled' });
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
      user_id: user.id,
      title: title || 'Untitled',
    });
    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }

    // Create snapshots for each image
    const snapshots: { snapshotId: string; imageUrl: string }[] = [];
    for (let i = 0; i < imageCount; i++) {
      let finalUrl = urls[i];
      if (!finalUrl && base64s[i]) {
        const snapId = crypto.randomUUID();
        const filename = `snapshot-${snapId}.jpg`;
        finalUrl = await uploadImage(supabase, user.id, projectId, filename, base64s[i]!) || undefined;
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
        sort_order: i,
      });
      if (!snapError) {
        snapshots.push({ snapshotId, imageUrl: finalUrl });
      }
    }

    // Update project cover with first image
    if (snapshots.length > 0) {
      await supabase.from('projects').update({
        cover_url: snapshots[0].imageUrl,
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
