import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';
import { readLayerizeFonts, finishLayerizeFonts } from '@/lib/layerize-fonts-server';
export const maxDuration = 120;
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string; snapshotId: string }> }) {
  const { id, snapshotId } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: project } = await admin.from('projects').select('user_id,is_public').eq('id', id).maybeSingle();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!project.is_public) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== project.user_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const owner = { userId: project.user_id, projectId: id };
    const result = await readLayerizeFonts(owner, snapshotId);
    if (!result) after(() => finishLayerizeFonts(owner, snapshotId));
    return NextResponse.json(result || { version: 1, status: 'pending' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Font matching is temporarily unavailable' }, { status: 503 });
  }
}
