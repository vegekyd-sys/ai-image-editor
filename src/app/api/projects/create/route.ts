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

    const { imageUrl, imageBase64, title } = await req.json();

    if (!imageUrl && !imageBase64) {
      return NextResponse.json(
        { error: 'imageUrl or imageBase64 is required' },
        { status: 400 },
      );
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

    // Upload image if base64 provided, otherwise use URL directly
    let finalImageUrl = imageUrl;
    if (!finalImageUrl && imageBase64) {
      const snapshotId = crypto.randomUUID();
      const filename = `snapshot-${snapshotId}.jpg`;
      finalImageUrl = await uploadImage(supabase, user.id, projectId, filename, imageBase64);
      if (!finalImageUrl) {
        return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
      }
    }

    // Create first snapshot
    const snapshotId = crypto.randomUUID();
    const { error: snapError } = await supabase.from('snapshots').insert({
      id: snapshotId,
      project_id: projectId,
      image_url: finalImageUrl,
      tips: [],
      message_id: '',
      sort_order: 0,
    });
    if (snapError) {
      return NextResponse.json({ error: snapError.message }, { status: 500 });
    }

    // Update project cover
    await supabase.from('projects').update({
      cover_url: finalImageUrl,
    }).eq('id', projectId);

    return NextResponse.json({
      projectId,
      snapshotId,
      imageUrl: finalImageUrl,
      projectUrl: `https://www.makaron.app/projects/${projectId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
