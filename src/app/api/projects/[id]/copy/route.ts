import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { createPersistedEditableDesign } from '@/lib/editor/editable-persistence';
import { normalizeLoadedDesignManifest } from '@/lib/editor/loaded-design-manifest';
import * as workspace from '@/lib/workspace';
import type { DesignPayload } from '@/types';

export const maxDuration = 60;
class CopyError extends Error { constructor(message: string, public status: number) { super(message); } }

// Copy only published project artifacts. No history, running jobs, billing or
// workspace paths supplied by a visitor can become writes to the author.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const admin = getSupabaseAdmin();
  const { data: source, error: sourceError } = await admin.from('projects')
    .select('user_id, is_public, title, timeline_version').eq('id', id).maybeSingle();
  if (sourceError) return NextResponse.json({ error: 'Could not load project' }, { status: 500 });
  if (!source?.user_id || (!source.is_public && source.user_id !== user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let projectCreated = false;
  const copyId = crypto.randomUUID();
  const uploadedPaths: string[] = [];
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return NextResponse.json({ error: 'Draft too large' }, { status: 413 });
    const body = JSON.parse(raw) as { designs?: Record<string, DesignPayload> };
    if (!body.designs || typeof body.designs !== 'object' || Array.isArray(body.designs)) {
      return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
    }
    const { data: snapshots, error } = await admin.from('snapshots')
      .select('id, image_url, sort_order, type, design_path, video_meta, description, metadata')
      .eq('project_id', id).order('sort_order', { ascending: true });
    if (error) throw error;
    if (!snapshots?.length) return NextResponse.json({ error: 'No published artifacts' }, { status: 400 });
    const sourceIds = new Set(snapshots.map(s => s.id));
    if (Object.keys(body.designs).some(key => !sourceIds.has(key))) {
      return NextResponse.json({ error: 'Invalid draft snapshot' }, { status: 400 });
    }
    const copied = [];
    for (const snapshot of snapshots) {
      if (snapshot.type === 'video' && snapshot.video_meta?.status !== 'completed') continue;
      const snapshotId = crypto.randomUUID();
      let designPath: string | null = null;
      if (snapshot.design_path) {
        const file = await workspace.readFile(snapshot.design_path, admin, source.user_id, { fresh: true });
        if (!file) throw new Error('Missing source composition');
        const design = normalizeLoadedDesignManifest(JSON.parse(file.content));
        if (!design) throw new Error('Invalid source composition');
        const edited = body.designs[snapshot.id];
        if (edited && edited.code !== design.code) throw new CopyError('Source changed. Reload before copying.', 409);
        const persisted = createPersistedEditableDesign(edited ? { ...design, props: edited.props, height: design.height } : design);
        designPath = `code/${snapshotId}.json`;
        const storagePath = `${user.id}/workspace/${designPath}`;
        const { error: uploadError } = await supabase.storage.from('images').upload(storagePath, JSON.stringify(persisted), { contentType: 'application/json', upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
      }
      copied.push({ ...snapshot, id: snapshotId, project_id: copyId, design_path: designPath, tips: [], message_id: null });
    }
    const { error: createError } = await supabase.from('projects').insert({
      id: copyId, user_id: user.id, title: source.title, is_public: false, timeline_version: source.timeline_version || 2,
      cover_url: snapshots[0]?.image_url || null,
    });
    if (createError) throw createError;
    projectCreated = true;
    const { error: copyError } = await supabase.from('snapshots').insert(copied);
    if (copyError) throw copyError;
    return NextResponse.json({ projectId: copyId });
  } catch (error) {
    // Roll back only resources created by this request. Never remove source data.
    if (projectCreated) await supabase.from('projects').delete().eq('id', copyId).eq('user_id', user.id);
    if (uploadedPaths.length) await supabase.storage.from('images').remove(uploadedPaths);
    console.error('[project-copy] failed', error instanceof Error ? error.message : 'copy failed');
    return NextResponse.json({ error: error instanceof CopyError ? error.message : 'Could not save project copy' }, { status: error instanceof CopyError ? error.status : 500 });
  }
}
